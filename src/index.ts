/**
 * @dszp/cipp-lib — read-only client for the CIPP API.
 *
 * The raw transport (`CippHttp`) is intentionally not exported; see `http.ts`.
 */
export { CippReadClient, licenseCounts } from './readClient.js';
export type { CippReadClientConfig } from './readClient.js';
export { parseRetryAfter } from './http.js';
export type { RetryOptions } from './http.js';
export { CippApiError } from './errors.js';
export { requestToken, entraTokenUrl, jwtExpiryMs, REFRESH_SKEW_MS } from './auth.js';
export type { CippAuth, IssuedToken, TokenRequestOptions } from './auth.js';
export type * from './model.js';
