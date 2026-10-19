import { appendFileSync } from 'node:fs';
import { config } from '../config/server.ts';
// Only these non-secret values enter GitHub step outputs. The bypass secret stays in Actions.
const values = { url: config.automation.healthUrl, retrySeconds: config.automation.retryDelayMs / 1000, timeoutSeconds: config.automation.timeoutMs / 1000 };
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
} else console.log(JSON.stringify(values));
