import { describe, it, expect } from 'vitest';
import { CippReadClient, licenseCounts } from './readClient.js';
import { CippApiError } from './errors.js';
import { requestToken, TokenSource, REFRESH_SKEW_MS } from './auth.js';
import { fakeJwt, mockFetch, TEST_API, TEST_CLIENT_ID, TEST_CLIENT_SECRET, TEST_TENANT_ID, TEST_TOKEN_URL, type MockFetch } from './testkit.js';
import * as barrel from './index.js';

const creds = { tenantId: TEST_TENANT_ID, clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET };

function client(f: MockFetch, sleeps: number[] = [], maxRetries?: number) {
  return new CippReadClient({
    auth: creds,
    apiUrl: TEST_API,
    fetchImpl: f.fetchImpl,
    retry: maxRetries === undefined ? undefined : { maxRetries },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
}

describe('auth', () => {
  it('requests a token from the tenant endpoint with the api://<clientId>/.default scope, form-encoded', async () => {
    const f = mockFetch();
    await requestToken(creds, { fetchImpl: f.fetchImpl });
    const call = f.calls[0]!;
    expect(call.url).toBe(TEST_TOKEN_URL);
    expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(call.body!);
    const keys = ['client_id', 'client_secret', 'scope', 'grant_type'];
    expect(Object.fromEntries(keys.map((k) => [k, form.get(k)]))).toEqual({
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      scope: `api://${TEST_CLIENT_ID}/.default`,
      grant_type: 'client_credentials',
    });
  });

  it('explains a rejected secret, including that new secrets take a few minutes, without echoing it', async () => {
    const f = mockFetch();
    const err = await requestToken({ ...creds, clientSecret: 'wrong-secret' }, { fetchImpl: f.fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(CippApiError);
    expect(err.message).toMatch(/invalid_client: AADSTS7000215: Invalid client secret provided\.\. .*few minutes/);
    expect(err.message).not.toMatch(/wrong-secret|Trace ID/);
  });

  it('refuses a tenant id that is not a GUID before any request', () => {
    const f = mockFetch();
    expect(() => new CippReadClient({ auth: { ...creds, tenantId: 'contoso.com' }, apiUrl: TEST_API, fetchImpl: f.fetchImpl })).toThrow(/GUID/);
    expect(f.calls).toHaveLength(0);
  });

  it('caches the token, shares one request, and refreshes inside the skew window', async () => {
    let now = 0;
    const f = mockFetch({ tokens: [fakeJwt({ exp: 3600 }), fakeJwt({ exp: 7200 })] });
    const src = new TokenSource(creds, { fetchImpl: f.fetchImpl, nowMs: () => now });
    await Promise.all([src.get(), src.get()]);
    expect(f.tokenRequests()).toBe(1);
    now = 3600_000 - REFRESH_SKEW_MS + 1;
    await src.get();
    expect(f.tokenRequests()).toBe(2);
  });
});

describe('CippReadClient', () => {
  it('lists tenants, passing search through', async () => {
    const f = mockFetch({ handler: (c) => (c.target.startsWith('/api/ListTenants') ? { body: [{ customerId: TEST_TENANT_ID, defaultDomainName: 'contoso.example', displayName: 'Contoso' }] } : undefined) });
    const c = client(f);
    expect(await c.listTenants({ search: 'con' })).toHaveLength(1);
    expect(f.apiCalls()[0]!.target).toBe('/api/ListTenants?Search=con');
  });

  it('reads one tenant\'s licenses and its Graph subscriptions with fixed endpoints', async () => {
    const f = mockFetch({
      handler: (c) =>
        c.target === '/api/ListLicenses?tenantFilter=contoso.example'
          ? { body: [{ skuId: 'sku-1', TotalLicenses: '5', CountUsed: '3', CountAvailable: 2, TermInfo: [] }] }
          : c.target.startsWith('/api/ListGraphRequest')
            ? { body: { Results: [{ id: 'sub-1', skuId: 'sku-1' }], Metadata: {} } }
            : undefined,
    });
    const c = client(f);
    const [lic] = await c.listLicenses('contoso.example');
    expect(licenseCounts(lic!)).toEqual({ total: 5, used: 3, available: 2 });
    expect(await c.listDirectorySubscriptions(TEST_TENANT_ID)).toEqual([{ id: 'sub-1', skuId: 'sku-1' }]);
    await c.listSubscribedSkus('contoso.example');
    const targets = f.apiCalls().slice(1).map((x) => decodeURIComponent(x.target));
    expect(targets).toEqual([
      `/api/ListGraphRequest?Endpoint=directory/subscriptions&tenantFilter=${TEST_TENANT_ID}`,
      '/api/ListGraphRequest?Endpoint=subscribedSkus&tenantFilter=contoso.example',
    ]);
  });

  it('refuses AllTenants and anything that is not a domain or GUID, before any request', async () => {
    const f = mockFetch();
    const c = client(f);
    for (const bad of ['AllTenants', 'contoso', '../ListUsers', 'contoso.example&Endpoint=users', '']) {
      await expect(c.listLicenses(bad)).rejects.toThrow(TypeError);
    }
    expect(f.calls).toHaveLength(0);
  });

  it('turns CIPP\'s string error body into a CippApiError', async () => {
    const f = mockFetch({ handler: () => ({ status: 403, body: 'Access to this tenant is not allowed' }) });
    const err = await client(f).listLicenses('other.example').catch((e) => e);
    expect(err).toBeInstanceOf(CippApiError);
    expect(err.isForbidden).toBe(true);
    expect(err.message).toBe('CIPP GET /api/ListLicenses -> 403: Access to this tenant is not allowed.');
  });

  it('treats an empty body as an empty list, and a malformed Graph body as an error', async () => {
    const f = mockFetch({ handler: (c) => (c.target.startsWith('/api/ListLicenses') ? { rawBody: '' } : { body: { Results: 'nope' } }) });
    const c = client(f);
    expect(await c.listLicenses('contoso.example')).toEqual([]);
    await expect(c.listSubscribedSkus('contoso.example')).rejects.toThrow(/Results to be an array/);
  });

  it('retries 429 and 503 with backoff, honouring Retry-After', async () => {
    const queue = [{ status: 429, headers: { 'retry-after': '2' } }, { status: 503 }];
    const f = mockFetch({ handler: () => queue.shift() ?? { body: [] } });
    const sleeps: number[] = [];
    await client(f, sleeps).listTenants();
    expect(sleeps).toEqual([2000, 1500]);
  });

  it('gives up after maxRetries', async () => {
    const f = mockFetch({ handler: () => ({ status: 429 }) });
    const err = await client(f, [], 1).listTenants().catch((e) => e);
    expect(err.isRateLimited).toBe(true);
    expect(f.apiCalls()).toHaveLength(2);
  });

  it('requests a new token once after a 401', async () => {
    const f = mockFetch({ tokens: ['tok-1', 'tok-2'], validTokens: () => ['tok-2'], handler: () => ({ body: [] }) });
    await client(f).listTenants();
    expect(f.tokenRequests()).toBe(2);
  });

  it('requires an HTTPS apiUrl', () => {
    const f = mockFetch();
    expect(() => new CippReadClient({ auth: creds, apiUrl: 'http://cipp.example.com', fetchImpl: f.fetchImpl })).toThrow(/HTTPS/);
    expect(() => new CippReadClient({ auth: creds, apiUrl: '', fetchImpl: f.fetchImpl })).toThrow(/required/);
  });
});

describe('read-only surface', () => {
  it('sends nothing but GET to the API', async () => {
    const f = mockFetch({ handler: () => ({ body: [] }) });
    await client(f).listTenants();
    expect(f.apiCalls().every((c) => c.method === 'GET')).toBe(true);
  });

  it('exposes exactly these read methods', () => {
    const methods = Object.getOwnPropertyNames(CippReadClient.prototype).filter((m) => m !== 'constructor').sort();
    expect(methods).toEqual(['listDirectorySubscriptions', 'listLicenses', 'listSubscribedSkus', 'listTenants']);
  });

  it('does not export the transport', () => {
    expect(Object.keys(barrel)).not.toContain('CippHttp');
    expect(Object.keys(barrel)).not.toContain('errorFromResponse');
  });
});
