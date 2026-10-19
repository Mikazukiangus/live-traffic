import { createPublicConfig } from './schema';
// Vite exposes only public VITE_* settings. Tests without Vite use the same validated defaults.
export const config = createPublicConfig(import.meta.env || {});
