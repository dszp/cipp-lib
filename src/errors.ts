/** Errors the client throws. Kept in their own module so auth and transport can share them. */

/** An HTTP-level failure from the CIPP API or the Entra token endpoint. */
export class CippApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    /** Path relative to the API URL (or the token URL's path), without the query string. */
    public readonly path: string,
    /** Parsed error body when one was sent, else the raw text. */
    public readonly body: unknown,
    /** Seconds the server asked the caller to wait, from `Retry-After`, after the retries ran out. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'CippApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** CIPP answers 403 for a tenant the credential may not see, and for an endpoint its role lacks. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
