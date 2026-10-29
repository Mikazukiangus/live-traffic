import { InvalidPayloadError } from '../../shared/diagnostics.ts';

/** A 5 MiB ceiling leaves headroom for official 1920px JPEGs without unbounded buffering. */
export const MAX_CAMERA_IMAGE_BYTES = 5 * 1024 * 1024;
/** A caller-selected resource failing image policy is not an outage of the entire allowed host. */
export class ImagePolicyError extends InvalidPayloadError {}

export async function readCameraJpeg(response: Response): Promise<Buffer<ArrayBuffer>> {
  const invalid = async (): Promise<never> => {
    await response.body?.cancel().catch(() => undefined);
    throw new ImagePolicyError();
  };
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type && !['image/jpeg', 'image/jpg', 'application/octet-stream'].includes(type)) return invalid();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_CAMERA_IMAGE_BYTES)) return invalid();
  const reader = response.body?.getReader();
  if (!reader) throw new ImagePolicyError();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_CAMERA_IMAGE_BYTES) throw new ImagePolicyError();
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks, total);
    // LTA's upstream often labels valid JPEGs as octet-stream. Check the bytes, not just MIME.
    if (total < 5 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[total - 2] !== 0xff || bytes[total - 1] !== 0xd9) throw new ImagePolicyError();
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
