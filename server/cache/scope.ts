import { createHash } from 'node:crypto';
/** Server-memory key component only; never emit this digest in responses or diagnostics. */
export const credentialScope = (key: string) => createHash('sha256').update(key).digest('hex');
