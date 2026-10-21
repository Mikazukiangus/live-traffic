/** Encoding belongs to this quoted HTML-attribute sink, never to API/React input state. */
export function escapeHtmlAttribute(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function renderSiteMetadata(html: string, siteUrl: string): string {
  const encoded = escapeHtmlAttribute(siteUrl);
  // Callback replacement preserves literal dollar tokens rather than interpreting them.
  return html.replaceAll('__TRAFFICPULSE_SITE_URL__', () => encoded);
}
