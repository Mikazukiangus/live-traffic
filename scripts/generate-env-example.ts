import { writeFileSync } from 'node:fs';
import { environmentExample } from '../config/schema.ts';
import { logger } from '../shared/logging.ts';
writeFileSync(new URL('../.env.example', import.meta.url), environmentExample());
logger.info({ event: 'configuration_generated', code: 'ENV_EXAMPLE_GENERATED' });
