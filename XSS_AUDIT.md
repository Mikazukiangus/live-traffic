# XSS audit — TrafficPulse

Reviewed 21 October 2026, main at `288043387f65d0aad9216fb818ed3bf6aca822a1`.

Implementation status: metadata encoding/canonical-host validation and fixed notification navigation were released through [PR #14](https://github.com/Mikazukiangus/live-traffic/pull/14), merge `c0dd11c`. Script-source tightening followed through [PR #15](https://github.com/Mikazukiangus/live-traffic/pull/15), merge `f3a9494`. Both are on main as of 21 October 2026; see Turn 116 for production verification. The findings below describe the original audited baseline, and the implementation records are in Turns 114–115.

## Conclusion

No confirmed visitor-reachable reflected, stored or DOM XSS was found in the reviewed first-party code. Incident/VMS/weather text, saved commute names, search results and dispatch details use React text/attribute rendering. Searches found no application use of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, HTML parsers, `eval`, `new Function` or string-based timers as an injection sink.

There is one confirmed unescaped HTML output path at build time, plus two hardening gaps. The build issue requires control of a deployment setting; the notification issue has no untrusted URL producer in the current app. Neither is evidence that a visitor can presently execute script in another visitor's browser. No application fix is included in this audit.

## 1. Build-time metadata bypasses HTML attribute encoding

**Classification:** confirmed HTML attribute injection; privileged build input; browser script execution not demonstrated.

**Path:** `VITE_SITE_URL` → URL configuration parser → `config.siteUrl` → `transformIndexHtml` string replacement → three quoted metadata `content` attributes.

**Locations:** [raw substitution in vite.config.ts:66](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/vite.config.ts#L66), [URL parser in config/schema.ts:18](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/config/schema.ts#L18), [origin check at schema.ts:65](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/config/schema.ts#L65), [metadata placeholders in index.html:30](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/index.html#L30).

An absolute HTTPS URL/origin check does not guarantee an HTML-safe string. The URL parser accepts some quote-containing hostname strings. A synthetic quote-bearing site setting passed the existing production config and a real Vite build. Parsing the emitted HTML found additional `tabindex`, `autofocus` and `onfocus` attributes on three meta elements. No event was fired and no browser execution was claimed. A visitor's query/form/provider message cannot currently set this environment value; an attacker would need a separate path to alter build settings.

**Fix:** encode the value for its quoted HTML attribute context at serialization, and reject malformed DNS/IP hostnames/HTML delimiters in the canonical-origin setting. Keep both controls. A replacement callback also avoids interpreting dollar replacement tokens from a supplied string. Proposed pattern, not applied:

```ts
const escapeHtmlAttribute = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

transformIndexHtml(html) {
  const siteUrl = escapeHtmlAttribute(config.siteUrl);
  return html.replaceAll('__TRAFFICPULSE_SITE_URL__', () => siteUrl);
}
```

**Regression gate:** a real production build rejects the malformed origin without printing it; HTML attribute serialization tests cover quotes, ampersands and replacement tokens. Normal social metadata must remain correct. Do not apply HTML escaping globally to JSON, signed camera URLs or React state.

## 2. Current CSP permits injected scripts if another injection becomes reachable

**Classification:** defense-in-depth gap, not an independent XSS exploit.

**Location:** [vercel.json:14](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/vercel.json#L14). An authenticated production homepage check returned HTTP 200 and confirmed the deployed policy contains `script-src 'self' https: 'unsafe-inline' 'wasm-unsafe-eval'`.

`'unsafe-inline'` permits inline script/event-handler execution without a nonce/hash restriction. `https:` permits script loading from any HTTPS origin. Consequently, this policy is a transport control and offers limited containment if a future HTML injection is introduced. HTTPS/HSTS and the request-schema guard do not replace contextual output encoding. `'wasm-unsafe-eval'` is the narrower WebAssembly allowance; its presence does not mean ordinary JavaScript `eval` is enabled.

**Fix:** move the [early theme bootstrap in index.html:8](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/index.html#L8) to a same-origin script or authorize that exact static script with a build-maintained hash. Then remove script `'unsafe-inline'` and broad `https:`; retain the required WASM permission and blob-worker policy. Give any necessary deployment-toolbar script a narrow, reviewed preview policy rather than opening all production script origins. Narrow other resource directives separately according to observed camera/font/fallback requirements.

**Regression gate:** verify first-paint theme, normal page switches, lazy chunks, offline shell, ONNX/WASM workers, fonts and protected preview access under the proposed policy. Refresh the HTML shell cache when changing its policy. Existing inline React styles may require a separate style policy; removing script `'unsafe-inline'` does not require removing inline styles in the same change. This should be a dedicated preview change, not an untested header edit.

## 3. Notification destination is passed to navigation without a URL policy

**Classification:** latent arbitrary navigation risk; not confirmed reachable XSS.

**Path:** `event.notification.data.url` → [public/sw.js:107](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/public/sw.js#L107) → `WindowClient.navigate` / `clients.openWindow`.

A sandboxed execution of the actual worker with captured browser APIs showed that external HTTPS and `javascript:` strings reach `openWindow` unchanged. The test did not open a browser window or execute script. Browser scheme/origin restrictions may reject some strings. Critically, the app's only current notification producer uses the fixed [incident destination at src/utils/commutes.ts:45](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/utils/commutes.ts#L45); commute/provider text only supplies the notification title/body. No remote visitor-controlled destination producer was found.

**Fix:** since all current notifications have one destination, use that fixed same-origin incident route in the worker and stop consuming `notification.data.url`. If multiple destinations are needed later, parse against `self.location.origin`, require the same HTTPS origin, allow only known application paths/query values and fall back safely. A simple leading-slash check is insufficient because `//other-host` is an external destination.

**Regression gate:** current incident alerts still open/focus the right view. External, scheme-relative, credential-bearing, `javascript:`, `data:` and malformed destination strings cannot become navigation targets; cover both existing-window and new-window branches.

## Where input already reaches the page safely

- **Incident/provider text:** [IncidentsPanel.tsx:148](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/features/radar/IncidentsPanel.tsx#L148), advice at line 152, and notification cards render JSX string children. Synthetic incident values rendered as escaped text.
- **VMS messages:** [LiveVmsBoards.tsx:104](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/components/LiveVmsBoards.tsx#L104) renders each message line as a string child. Splitting/deduplication does not turn it into HTML.
- **Saved commute names:** storage/model validation permits text containing angle brackets, which is appropriate for a text field. [CommuteCard.tsx:53](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/features/commutes/CommuteCard.tsx#L53) displays it as JSX text; the editor uses a controlled input. A synthetic tag-like name passed storage decoding and remained escaped in the actual editor render. Stored text is not automatically stored XSS.
- **Booking/dispatch fields:** [BookingModal.tsx:38](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/components/BookingModal.tsx#L38) copies form strings into demo state; [ActiveDispatchTracker.tsx:98](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/components/ActiveDispatchTracker.tsx#L98) renders the plate as text. Synthetic dispatch fields remained escaped. Required/form-format validation is a separate concern.
- **Telephone links:** [CallModal.tsx:77](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/components/CallModal.tsx#L77) has a fixed `tel:` prefix and React attribute encoding; quotes did not create another attribute in a synthetic render. Current call targets are app/workshop/driver fixtures. A telephone-format allowlist would improve data quality without fixing a demonstrated XSS path.
- **Gantry map links:** [GantryLocations.tsx:4](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/features/cameras/GantryLocations.tsx#L4) uses a fixed HTTPS Google Maps URL and coordinate values, with `noopener noreferrer`. Synthetic ID/label/title strings remained escaped. Invalid coordinate types could cause other errors, not an HTML injection through these JSX attributes.
- **Camera URLs:** [cameraClient.ts:20](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/features/cameras/cameraClient.ts#L20) validates provider snapshots; [isImageUrl](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/shared/traffic/validation.ts#L35) requires HTTPS without userinfo. [CameraImage.tsx:11](https://github.com/Mikazukiangus/live-traffic/blob/288043387f65d0aad9216fb818ed3bf6aca822a1/src/features/cameras/CameraImage.tsx#L11) and the inference engine use image contexts, not HTML/script embedding. The proxy constrains hosts/redirects, returns `image/jpeg`, and deployment headers add `nosniff`. This is not evidence that arbitrary upstream bytes are JPEG-validated, nor a demonstrated HTML execution sink.
- **Search and shared URL state:** controlled input values, enum/membership checks, `URLSearchParams`, equality checks and `getElementById` are used. No query/hash path to raw HTML/eval was found. Sharing/copying the current URL uses clipboard/share APIs, not HTML insertion.
- **Weather, car parks, tooltips, SVG labels and preferences:** JSX text/attribute rendering, numeric calculations or fixed style maps are used. Theme/text-size startup values are checked against fixed choices. No untrusted property spread from an API response into DOM event props was found.
- **API response text:** JSON responses use `application/json`; deployment headers add `nosniff`. Provider strings being present in JSON does not mean they execute as page HTML. No JSONP callback or HTML error-template path was found in the reviewed first-party handlers.

## Recommended implementation order

1. On one preview branch: fix metadata encoding/origin validation, make notification navigation fixed/same-origin, and add focused regression coverage.
2. On a separate preview: tighten script CSP with the necessary bootstrap/runtime/offline verification.
3. Add an XSS-specific source-review gate for new raw HTML/code/navigation sinks. The current `security:audit` script checks transport/cookie patterns only; it is not an XSS audit. A literal gate also does not replace taint analysis or manual review.

Keep normal text in JSX. Do not pre-escape all user input or strip angle brackets as a universal solution. If a future feature genuinely needs rich HTML, use a maintained HTML sanitizer immediately before that explicit HTML sink and review its URL policy. [OWASP distinguishes output contexts and safe sinks](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html); [React documents the danger of bypassing its normal rendering with untrusted HTML](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html).

## Evidence and limits

- Source-to-sink review covered `src`, `shared`, `api`, `server`, `public`, root HTML, Vite config and the deployed policy at the pinned main revision.
- Actual React static renders covered incident output, dispatch output, call text/telephone attribute, VMS location text/link title and saved-commute editing. These verify serialization, not every interactive browser lifecycle.
- A real temporary production build with a synthetic key/origin confirmed the metadata attribute issue; the build directory was removed. No production settings were edited.
- Actual service worker code ran in an isolated VM with captured client APIs. No external navigation/script execution occurred and no real notification permission or saved browser state was changed.
- The production homepage header check used existing protected access. No tokens, cookies, private keys or signed camera links were printed.
- This is a first-party XSS review, not proof of absence, an exhaustive dependency CVE audit or a browser exploit demonstration. No permanent tests or application behavior were changed during this audit; proposed fixes need preview approval.
