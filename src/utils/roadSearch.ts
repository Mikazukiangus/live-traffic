import { CAMERA_DIRECTORY } from '../data/cameras';
import { EXPRESSWAY_CORRIDORS } from '../data/mockData';

export type RoadSearchResult =
  | { kind: 'road'; id: string; label: string; detail: string; code: string }
  | { kind: 'camera'; id: string; label: string; detail: string; cameraId: string; tab: 'woodlands' | 'tuas' | 'all' };

const RESULTS: RoadSearchResult[] = [
  ...EXPRESSWAY_CORRIDORS.map((road): RoadSearchResult => ({
    kind: 'road', id: road.code, label: `${road.code} · ${road.name}`, detail: 'Expressway traffic', code: road.code,
  })),
  ...Object.entries(CAMERA_DIRECTORY).map(([cameraId, camera]): RoadSearchResult => ({
    kind: 'camera', id: cameraId, label: camera.short,
    detail: `${camera.place === 'woodlands' ? 'Woodlands' : camera.place === 'tuas' ? 'Tuas' : 'Sentosa'} · ${camera.corridor} · Camera ${cameraId}`,
    cameraId, tab: camera.place === 'sentosa' ? 'all' : camera.place,
  })),
];

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Match codes, full road names, checkpoint names and camera IDs without requesting live feeds. */
export function searchRoadsAndCameras(query: string): RoadSearchResult[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  return RESULTS.filter((r) => {
    const camera = r.kind === 'camera' ? CAMERA_DIRECTORY[r.cameraId] : null;
    const text = normalise(`${r.label} ${r.detail} ${camera ? `${camera.name} ${camera.locationDesc}` : ''}`);
    return words.every((word) => text.includes(word));
  }).sort((a, b) => {
    // An exact expressway code or camera ID is the most useful first match.
    const exact = normalise(query);
    return Number(b.id.toLowerCase() === exact) - Number(a.id.toLowerCase() === exact);
  });
}

export function searchDestination(result: RoadSearchResult): Record<string, string | null> {
  return {
    page: result.kind === 'road' ? 'radar' : 'cameras',
    tab: result.kind === 'road' ? 'expressways' : result.tab,
    road: result.kind === 'road' ? result.code : null,
    cam: result.kind === 'camera' ? result.cameraId : null,
    cams: null,
    incident: null,
  };
}
