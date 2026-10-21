import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

/** Fixed diagnostics only: never retain the URL, DNS answer, resolver error or credentials. */
export class SsrfError extends Error {
  constructor(readonly code: 'SSRF_URL_BLOCKED' | 'SSRF_ADDRESS_BLOCKED' | 'SSRF_DNS_FAILED') {
    super('Outbound destination blocked');
    this.name = 'SsrfError';
  }
}

/** Conservative public-unicast policy, including mapped/transition and metadata exclusions. */
export function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes('%')) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  if (parsed.kind() === 'ipv6') return parsed.match(ipaddr.parse('2000::'), 3);
  // Azure's platform virtual IP is public-shaped but exposes host services, not an Internet origin.
  return address !== '168.63.129.16';
}

/** URL normalization catches integer/octal/hex IPv4 spellings before classifying literals. */
export function validateOutboundUrl(input: string | URL): URL {
  const raw = String(input);
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError('SSRF_URL_BLOCKED'); }
  if (raw.length > 16384 || /[\x00-\x20\x7f\\]/.test(raw) || url.protocol !== 'https:' ||
      url.username || url.password || url.hash || (url.port && url.port !== '443'))
    throw new SsrfError('SSRF_URL_BLOCKED');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new SsrfError('SSRF_ADDRESS_BLOCKED');
  } else {
    const dns = hostname.replace(/\.$/, '');
    if (!dns || dns.length > 253 || dns === 'localhost' || dns.endsWith('.localhost') ||
        dns.endsWith('.local') || !dns.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
      throw new SsrfError('SSRF_URL_BLOCKED');
  }
  return url;
}

export type ResolvedAddress = { address: string; family: number };
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;
const resolveAll: AddressResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

/** This IS the socket's lookup, not a pre-check followed by a second unrestricted lookup. */
export function createPublicLookup(resolve: AddressResolver = resolveAll): LookupFunction {
  return (hostname, options, callback) => {
    void Promise.resolve().then(() => resolve(hostname)).then((answers) => {
      if (!Array.isArray(answers) || !answers.length || answers.some((answer) =>
        !answer || (answer.family !== 4 && answer.family !== 6) ||
        typeof answer.address !== 'string' || isIP(answer.address) !== answer.family || !isPublicAddress(answer.address)))
        throw new SsrfError('SSRF_ADDRESS_BLOCKED');
      // Validate the entire mixed A/AAAA set BEFORE honoring a requested connection family.
      const family = options.family;
      const eligible = family === 4 || family === 6 ? answers.filter((answer) => answer.family === family) : answers;
      if (!eligible.length) throw new SsrfError('SSRF_DNS_FAILED');
      return eligible.map(({ address, family }) => ({ address, family }));
    }, () => { throw new SsrfError('SSRF_DNS_FAILED'); }).then((answers) => {
      if (options.all) callback(null, answers);
      else callback(null, answers[0].address, answers[0].family);
    }, (error: unknown) => callback(error instanceof SsrfError ? error : new SsrfError('SSRF_DNS_FAILED'), ''));
  };
}

/** Each new socket uses checked DNS results; pooled sockets retain their validated peer. */
export function createSsrfAgent(resolve?: AddressResolver) {
  return new Agent({ connect: { lookup: createPublicLookup(resolve), rejectUnauthorized: true }, allowH2: false });
}

export const providerDispatcher = createSsrfAgent();
