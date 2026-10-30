/**
 * Shared test helpers: a recording mock `fetch` that speaks Entra's token exchange and CIPP's
 * response shapes.
 *
 * Build-excluded and never exported from the barrel, but type-checked by `tsconfig.test.json`.
 * Node-free like the rest of the source. Every value here is fictional.
 */

export interface RecordedCall {
  method: string;
  url: string;
  /** Path + query relative to the API URL, for terse assertions. */
  target: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface MockFetchOptions {
  handler?: (call: RecordedCall) => MockResponse | undefined;
  tokens?: string[];
  validTokens?: () => string[];
  /** `expires_in` the token endpoint reports. Default 3599. */
  expiresIn?: number;
}

export interface MockFetch {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
  apiCalls: () => RecordedCall[];
  tokenRequests: () => number;
}

export const TEST_TENANT_ID = '00000000-0000-4000-8000-00000000aaaa';
export const TEST_CLIENT_ID = '00000000-0000-4000-8000-00000000bbbb';
export const TEST_CLIENT_SECRET = 'test-client-secret-not-real';
export const TEST_API = 'https://cipp-test.example.com';
export const TEST_TOKEN_URL = `https://login.microsoftonline.com/${TEST_TENANT_ID}/oauth2/v2.0/token`;

export function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function toResponse(spec: MockResponse): Response {
  const status = spec.status ?? 200;
  const text = spec.rawBody ?? (spec.body === undefined ? '' : JSON.stringify(spec.body));
  return new Response(status === 204 ? null : text, { status, headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) } });
}

export function mockFetch(opts: MockFetchOptions = {}): MockFetch {
  const calls: RecordedCall[] = [];
  const tokens = [...(opts.tokens ?? ['tok-1'])];
  const issued: string[] = [];
  const valid = opts.validTokens ?? (() => opts.tokens ?? ['tok-1']);

  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = String(input);
    const u = new URL(url);
    const call: RecordedCall = {
      method: init.method ?? 'GET',
      url,
      target: u.origin === TEST_API ? u.pathname + u.search : url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body,
    };
    calls.push(call);

    if (url === TEST_TOKEN_URL) {
      const b = new URLSearchParams(call.body ?? '');
      if (b.get('client_id') !== TEST_CLIENT_ID || b.get('client_secret') !== TEST_CLIENT_SECRET) {
        return toResponse({ status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' } });
      }
      const token = tokens.shift() ?? issued[issued.length - 1] ?? 'tok-1';
      issued.push(token);
      return toResponse({ body: { token_type: 'Bearer', expires_in: opts.expiresIn ?? 3599, access_token: token } });
    }

    const auth = call.headers.Authorization ?? '';
    if (!valid().includes(auth.replace(/^Bearer /, ''))) return toResponse({ status: 401, rawBody: '' });
    return toResponse(opts.handler?.(call) ?? { status: 404, rawBody: '' });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    apiCalls: () => calls.filter((c) => c.url !== TEST_TOKEN_URL),
    tokenRequests: () => calls.filter((c) => c.url === TEST_TOKEN_URL).length,
  };
}
