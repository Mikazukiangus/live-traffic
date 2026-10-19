import { writeFileSync } from 'node:fs';
import { environmentExample } from '../config/schema.ts';
writeFileSync(new URL('../.env.example', import.meta.url), environmentExample());
console.log('Generated .env.example from the validated configuration schema (no local secrets read).');
