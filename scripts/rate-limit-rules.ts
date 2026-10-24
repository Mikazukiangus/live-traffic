import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { API_RATE_LIMITS } from '../config/rateLimitPolicy.ts';

/** Emit reviewable CLI arguments only. This script cannot publish or mutate Firewall state. */
export function rateLimitRuleCommands() {
  const scope = ['vercel', '--scope', 'carbon-bc04', 'firewall', 'rules', 'add'];
  const condition = (type: string, value: string) => ['--condition', JSON.stringify({ type, op: type === 'path' ? 'pre' : 'eq', value })];
  const limit = (requests: number) => ['--action', 'rate_limit', '--rate-limit-window', String(API_RATE_LIMITS.windowSeconds),
    '--rate-limit-requests', String(requests), '--rate-limit-keys', 'ip', '--rate-limit-action', 'log', '--yes'];
  // One rule fits Hobby. OR groups match physical API traffic and SDK checks;
  // custom SDK keys create independent buckets within the same rule/window.
  return [[...scope, API_RATE_LIMITS.name, ...condition('path', '/api/'), '--or',
    ...condition('rate_limit_api_id', API_RATE_LIMITS.id), ...limit(API_RATE_LIMITS.requests)]];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify({ project: 'live-traffic', stage: 'log-only draft; review before publishing', commands: rateLimitRuleCommands() }, null, 2));
