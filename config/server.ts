import { createConfig } from './schema.ts';
if (typeof window !== 'undefined') throw new Error('Server configuration must not be imported by browser code');
export const config = createConfig(process.env);
