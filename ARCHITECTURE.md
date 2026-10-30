# Architecture

This library is a small, dependency-free client that other code builds on. It follows the same
layout as its siblings (`@dszp/pax8-lib`, `@dszp/flexpoint-lib`).

## Module boundaries

| Module | Responsibility | Exported |
|--------|----------------|----------|
| `auth.ts` | The Entra client-credentials exchange, token expiry, `TokenSource` (cache, refresh, one shared request) | the exchange helpers; `TokenSource` is internal |
| `errors.ts` | `CippApiError` | yes |
| `http.ts` | URL building, bearer auth, retry after `401`, backoff on `429`/`502`/`503`/`504`, error normalisation | `parseRetryAfter`, `RetryOptions`; `CippHttp` is private |
| `readClient.ts` | One method per route this library reads; tenant checks | yes |
| `model.ts` | Response and option types | types only |

## Read-only is enforced by what's reachable

`CippHttp` has only a `get` method, the read client holds it in an ES `#private` field, and the
barrel doesn't export it. A test pins the read client's exact method list, and another checks
that every request it sends is a GET.

Some CIPP GET routes do more than read. `ListTenants` with `TriggerRefresh` queues a tenant
refresh, for example. The client never sends those parameters. CIPP's `ListGraphRequest` takes
any Graph path as `Endpoint`; the client only ever passes a literal from its own source, so a
caller can't widen what it reads.

Writes, if added, go in a separate `CippWriteClient` with its own transport module. It reuses
`TokenSource`, `errorFromResponse`, `backoffDelayMs` and `parseRetryAfter`, but not the read
transport's retry loop: a GET can be repeated safely, and a write that timed out may already
have happened.

## Authentication

A CIPP API client is an Entra app registration in the CIPP tenant. The client posts a
form-encoded client-credentials request to
`https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token` with the scope
`api://<clientId>/.default`. The token observed in testing expires after one hour and carries no
role claims; CIPP checks the client's role itself on every request. `TokenSource` refreshes two
minutes before `exp` and shares one in-flight request among concurrent callers.

## Tenant values

`tenantFilter` accepts a domain name or a tenant GUID. Both are checked by pattern before a
request is made. Without the check, a value such as `contoso.com&Endpoint=users` would add a
parameter to the request.

## Responses

CIPP returns bare arrays from its own routes and `{ Results, Metadata }` from `ListGraphRequest`,
which follows Graph's paging itself. An empty body is an empty list. Errors arrive as a JSON
string, for example `"Access to this tenant is not allowed"` with a `403`.
