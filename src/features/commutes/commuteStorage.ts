import { EXPRESSWAY_CORRIDORS } from '../../data/expressways';
import { createCommuteRepository } from './commuteRepository';

let repository: ReturnType<typeof createCommuteRepository> | undefined;
/** Lazy browser adapter; tests can construct the same repository with isolated storage and a clock. */
export function getCommuteRepository() {
  return (repository ??= createCommuteRepository(() => localStorage, new Set(EXPRESSWAY_CORRIDORS.map((c) => c.code))));
}
