import { config } from '../../../config/client';
import { withRequestDeadline } from '../../../shared/requestDeadline';
import { UpstreamHttpError } from '../../../shared/diagnostics';
import { fetchWithTimeout } from '../../utils/request';
import { loadImage } from './loadImage';
/**
 * Counts vehicles in a traffic camera photo on the viewer's device with YOLOX-Nano
 * (Megvii, Apache-2.0; see public/models/YOLOX-LICENSE.txt) running in ONNX Runtime Web (MIT).
 * Nothing is sent to an AI service. The runtime (~3.7 MB) and model (~3.4 MB, both compressed)
 * are served from this site and load on first use.
 *
 * LTA cameras are high, wide and often hazy, so vehicles are tiny: the photo is split into
 * overlapping tiles that are each scaled up to the model's 416x416 input. Tested on the
 * Woodlands cameras, this finds most cars and lorries but undercounts motorcycles.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web';

const MODEL_URL = '/models/yolox_nano.onnx';
const SIZE = 416;
const STRIDES = [8, 16, 32];
const COCO_VEHICLES = [2, 3, 5, 7]; // car, motorcycle, bus, truck
const TILE_COLS = 6;
const TILE_ROWS = 4;
const TILE_OVERLAP = 0.15;
const MIN_SCORE = 0.12;
const NMS_IOU = 0.45;
// Boxes wider than this share of the photo are merged groups of vehicles, not one vehicle.
const MAX_BOX_WIDTH = 0.25;

type Ort = typeof import('onnxruntime-web');
type Box = [number, number, number, number]; // x, y, width, height

let runtime: Promise<{ ort: Ort; session: InferenceSession }> | null = null;

function loadRuntime() {
  runtime ??= withRequestDeadline(config.timeouts.assets, async (signal) => {
    const [ort, { wasmUrl }] = await Promise.all([
      import('onnxruntime-web/wasm'), import('./runtimeAssets'),
    ]);
    signal.throwIfAborted();
    ort.env.wasm.proxy = true; // run inference in a worker so the page stays responsive
    const binary = (url: string) => fetchWithTimeout(url, async (response) => {
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpstreamHttpError(response.status);
      }
      return response.arrayBuffer();
    }, { signal }, config.timeouts.assets);
    // Fetch explicitly: the runtime's internal model/WASM downloads have no abort signal.
    const [model, wasm] = await Promise.all([binary(MODEL_URL), binary(wasmUrl)]);
    signal.throwIfAborted();
    ort.env.wasm.wasmBinary = wasm;
    ort.env.wasm.initTimeout = config.timeouts.assets;
    const creating = ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    void creating.then((session) => {
      if (signal.aborted) return session.release();
    }).catch(() => undefined);
    const session = await creating;
    signal.throwIfAborted();
    return { ort: ort as unknown as Ort, session };
  }).catch((err) => {
    runtime = null; // allow a later retry
    throw err;
  });
  return runtime;
}

/** Skip the ~7 MB download when the viewer has asked their browser to save data. */
export function vehicleCountingAllowed(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return config.vehicleCountingEnabled && !connection?.saveData;
}

function toTensor(ort: Ort, tile: HTMLCanvasElement): { tensor: Tensor; scale: number } {
  // YOLOX expects the image top-left aligned in a grey (114) square, BGR, 0-255.
  const scale = Math.min(SIZE / tile.width, SIZE / tile.height);
  const square = document.createElement('canvas');
  square.width = SIZE;
  square.height = SIZE;
  const ctx = square.getContext('2d')!;
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(tile, 0, 0, tile.width * scale, tile.height * scale);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const plane = SIZE * SIZE;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 4 + 2];
    chw[plane + i] = data[i * 4 + 1];
    chw[2 * plane + i] = data[i * 4];
  }
  return { tensor: new ort.Tensor('float32', chw, [1, 3, SIZE, SIZE]), scale };
}

async function detectTile(ort: Ort, session: InferenceSession, tile: HTMLCanvasElement) {
  const { tensor, scale } = toTensor(ort, tile);
  const result = await session.run({ [session.inputNames[0]]: tensor });
  const out = result[session.outputNames[0]].data as Float32Array;
  const found: { box: Box; score: number }[] = [];
  // Rows are grid cells for strides 8, 16 and 32: [dx, dy, log w, log h, objectness, 80 class scores].
  let row = 0;
  for (const stride of STRIDES) {
    const cells = SIZE / stride;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++, row++) {
        const o = row * 85;
        const objectness = out[o + 4];
        if (objectness < MIN_SCORE) continue;
        const score = objectness * Math.max(...COCO_VEHICLES.map((k) => out[o + 5 + k]));
        if (score < MIN_SCORE) continue;
        const w = Math.exp(out[o + 2]) * stride;
        const h = Math.exp(out[o + 3]) * stride;
        const cx = (out[o] + x) * stride;
        const cy = (out[o + 1] + y) * stride;
        found.push({ box: [(cx - w / 2) / scale, (cy - h / 2) / scale, w / scale, h / scale], score });
      }
    }
  }
  return found;
}

function iou(a: Box, b: Box) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

/** Number of vehicles found in the photo at `url` (must be same-origin or CORS-enabled). */
export async function countVehicles(url: string, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const [{ ort, session }, img] = await Promise.all([loadRuntime(), loadImage(url, config.timeouts.request, undefined, signal)]);
  signal?.throwIfAborted();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const tileW = Math.round((W / TILE_COLS) * (1 + TILE_OVERLAP));
  const tileH = Math.round((H / TILE_ROWS) * (1 + TILE_OVERLAP));
  const tile = document.createElement('canvas');
  tile.width = tileW;
  tile.height = tileH;
  const ctx = tile.getContext('2d')!;

  const found: { box: Box; score: number }[] = [];
  for (let r = 0; r < TILE_ROWS; r++) {
    for (let c = 0; c < TILE_COLS; c++) {
      signal?.throwIfAborted();
      const x0 = Math.min(Math.round((c * W) / TILE_COLS), W - tileW);
      const y0 = Math.min(Math.round((r * H) / TILE_ROWS), H - tileH);
      ctx.drawImage(img, x0, y0, tileW, tileH, 0, 0, tileW, tileH);
      const detected = await detectTile(ort, session, tile);
      signal?.throwIfAborted();
      for (const f of detected) {
        if (f.box[2] > W * MAX_BOX_WIDTH) continue;
        found.push({ box: [f.box[0] + x0, f.box[1] + y0, f.box[2], f.box[3]], score: f.score });
      }
    }
  }

  // Tiles overlap, so keep only the most confident of any duplicate boxes.
  found.sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const f of found) {
    if (!kept.some((k) => iou(k, f.box) > NMS_IOU)) kept.push(f.box);
  }
  return kept.length;
}
