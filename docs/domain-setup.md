# Connect a custom domain to TrafficPulse on Vercel

The host is the existing `carbon-bc04/live-traffic` Vercel project. Its attached project domain is currently Vercel-provided; no user custom domain was attached at inspection on 29 October 2026. The user's intended domain and authoritative DNS provider are still needed to obtain exact records. This guide changes no domain, DNS, nameservers, certificate, environment or access settings.

## 1. Identify the domain and DNS provider

Use a domain you own, for example `example.com`. DNS may be managed at the registrar or somewhere else, such as Cloudflare. Records must be edited at the authoritative DNS provider—the service identified by the domain's active nameservers. Buying or transferring the domain to Vercel is not required.

Keeping the current DNS provider and changing only the website records is usually the least disruptive approach. A nameserver migration requires preserving the whole required zone, including mail records.

## 2. Add the hostname to the existing project

Open [TrafficPulse domain settings](https://vercel.com/carbon-bc04/live-traffic/settings/domains). Add the intended production hostname. If both `example.com` and `www.example.com` should work, add both, select one canonical hostname and configure the other as a redirect in Vercel. DNS points a hostname at a host; the redirect chooses the address shown in the browser.

Vercel recommends using `www` as the primary address and redirecting the apex to it. A bare-domain primary is also a deliberate choice; use the same primary consistently in the app settings below. Do not attach it to a Preview branch or a different project.

## 3. Copy Vercel's actual recommended records

The following is a template, not a set of ready-to-paste values. Inspect Vercel's Domain Settings for the specific hostname/project and copy its exact record names and targets. Do not assume a universal Vercel IP or point a CNAME at a guessed deployment URL.

| Type | Name/host | Value to copy | Why |
| --- | --- | --- | --- |
| A | `@` (or the provider's root/blank field) | The recommended IPv4 address Vercel gives for the apex | Sends the bare domain to Vercel's network. |
| CNAME | `www` (or the selected subdomain) | Vercel's recommended DNS hostname for that project | Maps the subdomain to a hostname Vercel manages. This is a hostname, without `https://` or a path. |
| TXT, if requested | The exact verification name Vercel displays | The exact ownership-verification value | Proves control of the domain; it does not route web traffic. |

Use the provider's default TTL, or 300 seconds during a planned switch if supported. TTL controls how long resolvers cache a record; it is not a guaranteed propagation time. Only replace records that conflict at the website hostname being moved. For example, an old root A/AAAA record can send some visitors to the old host, and a CNAME cannot coexist with other ordinary records at the same name. Do not add an IPv6/AAAA record unless Vercel specifically supplies one.

Preserve MX records, mail hosts, SPF/DKIM/DMARC TXT records and unrelated subdomains. If the domain already serves a website, record its current values before changing them. If the DNS provider offers a proxy/CDN layer, review its Vercel-specific setup before enabling it; no provider-specific toggle is assumed here.

## 4. Verify DNS and HTTPS

Return to Vercel's domain settings and check that the hostname reaches **Valid Configuration** and its TLS certificate is ready. Vercel normally provisions the certificate automatically after DNS verification succeeds. Cached old DNS records may take time to expire.

Open both hostnames over HTTPS. Confirm the expected primary-domain redirect, a valid certificate and the TrafficPulse site. A DNS save alone does not prove propagation, certificate issuance or correct app behavior. If issuance fails, check the exact DNS/verification error and any existing restrictive CAA policy before changing additional records.

## 5. Align TrafficPulse's own settings

These are planned changes once the actual hostname is selected; none have been made by this guide:

- Set production `VITE_SITE_URL` to the chosen HTTPS origin, such as `https://www.example.com`, with no path. This config drives public site metadata and server-side canonical-origin defaults. Rebuild after changing a `VITE_` setting.
- Review `API_CORS_ORIGINS` for any additional frontend origins intentionally retained. The configured canonical site and supported Vercel deployment metadata are included automatically; do not use `*`. Prefer redirecting visitors to the primary address instead of allowing every alias unnecessarily.
- If login is enabled later, align `BETTER_AUTH_URL` with the chosen primary origin or let its documented production default derive from `VITE_SITE_URL`. Changing domains is not authorization to enable login or move the authentication database. Existing cookies belong to their old hostname; verify the login/session flow on the new one when applicable.
- The daily GitHub health job uses GitHub Actions variables, separately from Vercel environment settings. Update its `VITE_SITE_URL`/`PRODUCTION_HEALTH_URL` only if moving the health-check target, and keep any existing bypass credential directed solely at the verified owned host.
- Keep existing Deployment Protection unless changing it is separately authorized. A valid custom domain does not itself remove Vercel Authentication.

The existing green-build pipeline continues deploying to the same project and production domains. After approved settings changes, use the normal gated deployment and check camera/incident/weather requests, redirects and HTTPS. No project transfer, new deployment pipeline or purchased service is required just to connect a domain.

Sources: [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [custom-domain verification and SSL](https://vercel.com/docs/domains/set-up-custom-domain), and this repository's `config/schema.ts`/`.env.example` for application settings.
