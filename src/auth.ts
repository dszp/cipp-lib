/**
 * Authentication: exchange a CIPP API client's Entra credentials for a bearer token and keep one
 * fresh.
 *
 * A CIPP API client is an Entra app registration in the CIPP tenant. Tokens come from that
 * tenant's v2.0 token endpoint by the OAuth 2.0 client-credentials grant, with the scope
 * `api://<clientId>/.default`. Observed lifetime is one hour. The token's own `exp` claim drives
 * refresh, falling back to `expires_in`.
 *
 * What the token may do is decided inside CIPP by the role assigned to the API client, not by
 * claims in the token.
 */
import { CippApiError } from './errors.js';

/** Refresh this long before expiry, so a request never leaves with a token that expires in flight. */
export const REFRESH_SKEW_MS = 2 * 60_000;

/**
 * How the client authenticates.
 *
 * - `{ tenantId, clientId, clientSecret }` — the CIPP API client's Entra credentials. `tenantId` is
 *   the tenant CIPP's app registration lives in. The client requests a token on first use, caches
 *   it, and requests a new one before it expires or when a request comes back 401. Use this.
 *   `tokenUrl` overrides the endpoint built from `tenantId` (for a sovereign cloud).
 * - `{ token }` — a bearer token obtained elsewhere. Used as-is and never refreshed.
 */
export type CippAuth =
  | { tenantId: string; clientId: string; clientSecret: string; tokenUrl?: string; token?: undefined }
  | { token: string; tenantId?: undefined; clientId?: undefined; clientSecret?: undefined; tokenUrl?: undefined };

export interface TokenRequestOptions {
  fetchImpl: typeof fetch;
  /** Injectable clock in epoch ms. Defaults to `Date.now`. */
  nowMs?: () => number;
}

/** A token plus its expiry in epoch ms, when one is known. */
export interface IssuedToken {
  token: string;
  expiresAtMs?: number;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Entra v2.0 token endpoint for a tenant. */
export function entraTokenUrl(tenantId: string): string {
  if (!GUID.test(tenantId)) throw new TypeError(`CIPP auth: tenantId must be a GUID, got ${JSON.stringify(tenantId)}`);
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

/** Perform the token exchange once. Most callers want the client, which does this for them. */
export async function requestToken(
  creds: { tenantId: string; clientId: string; clientSecret: string; tokenUrl?: string },
  opts: TokenRequestOptions,
): Promise<IssuedToken> {
  if (!creds.clientId || !creds.clientSecret) throw new Error('CIPP token request: clientId and clientSecret are both required.');
  const tokenUrl = creds.tokenUrl ?? entraTokenUrl(creds.tenantId);
  if (!/^https:\/\//i.test(tokenUrl)) throw new Error(`CIPP tokenUrl must be HTTPS, got: ${tokenUrl}`);
  const path = new URL(tokenUrl).pathname;
  const res = await opts.fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: `api://${creds.clientId}/.default`,
      grant_type: 'client_credentials',
    }).toString(),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    // Entra answers `{ error, error_description, error_codes, ... }`. None of it carries the secret.
    const b = (body ?? {}) as { error?: unknown; error_description?: unknown };
    const desc = typeof b.error_description === 'string' ? b.error_description.split('\r\n')[0] : undefined;
    const detail = [b.error, desc].filter((x) => typeof x === 'string').join(': ') || res.statusText || 'token request failed';
    const hint =
      b.error === 'invalid_client'
        ? ' The client id or secret was rejected. A new secret can take a few minutes to start working.'
        : '';
    throw new CippApiError(`CIPP POST ${path} -> ${res.status}: ${detail}.${hint}`, res.status, 'POST', path, body);
  }
  const r = (body ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof r.access_token !== 'string' || !r.access_token) {
    throw new CippApiError(`CIPP POST ${path} -> ${res.status} but no access_token in the response.`, res.status, 'POST', path, undefined);
  }
  const now = (opts.nowMs ?? Date.now)();
  const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : Number(r.expires_in);
  const expiresAtMs = jwtExpiryMs(r.access_token) ?? (Number.isFinite(expiresIn) ? now + expiresIn * 1000 : undefined);
  return { token: r.access_token, expiresAtMs };
}

/** The `exp` claim of a JWT in epoch ms, or `undefined` when it is absent or unreadable. */
export function jwtExpiryMs(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hands out a valid token. Concurrent callers during a token request share one in-flight request,
 * so a burst of parallel reads costs one exchange, not one each.
 */
export class TokenSource {
  #current?: IssuedToken;
  #pending?: Promise<IssuedToken>;
  readonly #nowMs: () => number;

  constructor(
    private readonly auth: CippAuth,
    private readonly request: TokenRequestOptions,
  ) {
    if (!(auth.clientId && auth.clientSecret && (auth.tenantId || auth.tokenUrl)) && !auth.token) {
      throw new Error('CIPP auth: provide { tenantId, clientId, clientSecret } or { token }.');
    }
    if (auth.tenantId && !auth.tokenUrl) entraTokenUrl(auth.tenantId); // validate early
    this.#nowMs = request.nowMs ?? Date.now;
    if (auth.token) this.#current = { token: auth.token };
  }

  /** True when a 401 can be recovered by requesting a new token. */
  get canRefresh(): boolean {
    return Boolean(this.auth.clientId);
  }

  /** A token that is not within {@link REFRESH_SKEW_MS} of expiry. `force` discards the cached one. */
  async get(force = false): Promise<string> {
    const a = this.auth;
    if (!a.clientId) return a.token!;
    const cur = this.#current;
    const fresh = cur && (cur.expiresAtMs === undefined || cur.expiresAtMs - REFRESH_SKEW_MS > this.#nowMs());
    if (!force && fresh) return cur.token;
    this.#pending ??= requestToken(
      { tenantId: a.tenantId, clientId: a.clientId, clientSecret: a.clientSecret, tokenUrl: a.tokenUrl },
      this.request,
    ).finally(() => {
      this.#pending = undefined;
    });
    this.#current = await this.#pending;
    return this.#current.token;
  }
}
