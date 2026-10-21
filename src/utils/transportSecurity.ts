const DIRECTIVES = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'style-src',
  'style-src-elem',
  'img-src',
  'font-src',
  'connect-src',
  'worker-src',
  'frame-src',
  'media-src',
  'object-src',
  'form-action',
]);
type Violation = Pick<SecurityPolicyViolationEvent, 'blockedURI' | 'effectiveDirective'>;

/** Never log resource URLs: camera signatures and query parameters can contain secrets. */
export function transportNotice(event: Violation) {
  const scheme = /^http:/i.test(event.blockedURI) ? 'http' : /^ws:/i.test(event.blockedURI) ? 'ws' : null;
  if (!scheme) return null;
  return {
    event: 'transport_policy_violation',
    code: 'INSECURE_RESOURCE',
    scheme,
    directive: DIRECTIVES.has(event.effectiveDirective) ? event.effectiveDirective : 'resource',
  };
}

/** App-lifetime listener; suppress repeats and report only closed, non-sensitive metadata. */
export function installTransportDiagnostics(
  target: EventTarget,
  warn = (notice: NonNullable<ReturnType<typeof transportNotice>>) => console.warn(JSON.stringify(notice)),
) {
  const seen = new Set<string>();
  const onViolation = (event: Event) => {
    const notice = transportNotice(event as SecurityPolicyViolationEvent);
    if (!notice) return;
    const key = `${notice.scheme}:${notice.directive}`;
    if (!seen.has(key)) {
      seen.add(key);
      warn(notice);
    }
  };
  target.addEventListener('securitypolicyviolation', onViolation);
  return () => target.removeEventListener('securitypolicyviolation', onViolation);
}
