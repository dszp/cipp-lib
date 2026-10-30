# @dszp/cipp-lib

A read-only TypeScript client for the [CIPP](https://cipp.app) API, the CyberDrain Improved Partner
Portal. It reads the tenants a CIPP instance manages and each tenant's Microsoft 365 licensing:
purchased and assigned counts per SKU, and the subscriptions behind them with their renewal
dates. It has no runtime dependencies and no Node APIs, so the same code runs in a Cloudflare
Worker, Node 20+, and the browser.

The client handles three things you'd otherwise have to handle yourself:

- **Token lifecycle.** You pass the CIPP API client's Entra credentials. The client requests a
  token from your tenant's Entra endpoint, caches the one-hour token, refreshes it before it
  expires, and retries a `401` once with a new token.
- **Throttling.** CIPP runs on Azure Functions and calls Microsoft Graph, and either can answer
  `429` or `503` under load. The client waits for the time the server asks for in `Retry-After`,
  or backs off exponentially when it doesn't say, and retries. It also retries `502` and `504`.
- **Safe tenant values.** Every tenant is checked as a domain name or a tenant GUID before a
  request is made, so a caller's value can't add parameters or change the route. `AllTenants` is
  refused; see [Licenses](#licenses).

This version reads only, and it calls only the routes listed below.

## Install

```sh
pnpm add @dszp/cipp-lib
```

## Set up a CIPP API client

In CIPP, open the CIPP-API integration and create an API client. Assign it a role
that can read tenants and licenses, and nothing more. CIPP shows the client id and secret once;
store them in a secret manager or a Worker secret, and never commit them. A new secret can take a
few minutes to start working.

You need four values:

| Value | Where it comes from |
|---|---|
| `apiUrl` | The CIPP API's URL, for example `https://cipp-xxxxx.azurewebsites.net`. This is the Function app, not the web front end. |
| `tenantId` | The tenant your CIPP instance's app registration lives in. |
| `clientId`, `clientSecret` | The API client. |

What the client may read is decided inside CIPP by its role. The token itself carries no roles.

## Use it

```ts
import { CippReadClient, licenseCounts } from '@dszp/cipp-lib';

const cipp = new CippReadClient({
  auth: { tenantId: env.CIPP_TENANT_ID, clientId: env.CIPP_CLIENT_ID, clientSecret: env.CIPP_CLIENT_SECRET },
  apiUrl: env.CIPP_API_URL,
});

const tenants = await cipp.listTenants();
const licenses = await cipp.listLicenses(tenants[0].defaultDomainName);
const { total, used, available } = licenseCounts(licenses[0]);
```

### Methods

| Method | CIPP route | Returns |
|---|---|---|
| `listTenants({ search? })` | `ListTenants` | Every tenant the client may see, with its tenant id, domains and GDAP relationship dates. |
| `listLicenses(tenant)` | `ListLicenses` | One row per SKU: counts, the subscriptions behind it (`TermInfo`), assigned users and groups, and service plans. |
| `listDirectorySubscriptions(tenant)` | `ListGraphRequest`, Graph `directory/subscriptions` | Each Microsoft subscription with its status, seat count and next lifecycle date. |
| `listSubscribedSkus(tenant)` | `ListGraphRequest`, Graph `subscribedSkus` | Each SKU's prepaid units (enabled, warning, suspended) and consumed units. |

`tenant` is a tenant's default domain name or its tenant id.

## Licenses

`listLicenses` reads live from Microsoft Graph, so expect several seconds per tenant. It takes one
tenant at a time. CIPP's `AllTenants` form answers from a cache that can return a "check back in 1
minute" placeholder instead of data, so the client refuses it.

`CountUsed` and `TotalLicenses` arrive as strings and `CountAvailable` as a number. Use
`licenseCounts(row)` to read all three as numbers.

License rows list the users who hold each license. Handle them as personal data.

## Who sold a license

Graph's subscription records don't say which reseller sold a subscription: `ownerType` was empty
for every subscription in testing. To tell your own licenses from ones bought elsewhere, match
these records against your distributor's data, by tenant and Graph `skuId`.

## Errors

A failed request throws `CippApiError` with `status`, `method`, `path` and the parsed `body`. CIPP
answers `403` for a tenant the client may not see (`isForbidden`) and for a route its role
doesn't allow.

## Options

```ts
new CippReadClient({
  auth,       // { tenantId, clientId, clientSecret, tokenUrl? } or { token }
  apiUrl,     // required
  retry: { maxRetries: 6, baseDelayMs: 1000, maxDelayMs: 60_000 },  // the defaults
  fetchImpl,  // a fetch-compatible function; defaults to the global fetch
});
```

`tokenUrl` overrides the Entra endpoint built from `tenantId`, for a sovereign cloud.

## License

MIT
