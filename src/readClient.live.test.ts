/**
 * Live read-only smoke test against a real CIPP instance. Self-skips unless CIPP_TENANT_ID,
 * CIPP_CLIENT_ID, CIPP_CLIENT_SECRET and CIPP_API_URL are set. Source them from your secret
 * manager at run time; never commit them.
 *
 * Reads only, and asserts shapes, never values: responses are customer data, including user names
 * on license rows. Logs counts only. `process` is declared locally so this compiles under the
 * Node-free tsconfig (types: []).
 */
import { describe, it, expect } from 'vitest';
import { CippReadClient, licenseCounts } from './readClient.js';

declare const process: { env: Record<string, string | undefined> } | undefined;
const env = typeof process !== 'undefined' ? process!.env : {};
const ready = Boolean(env.CIPP_TENANT_ID && env.CIPP_CLIENT_ID && env.CIPP_CLIENT_SECRET && env.CIPP_API_URL);

describe.skipIf(!ready)('live read smoke (real CIPP API)', () => {
  const client = ready
    ? new CippReadClient({
        auth: { tenantId: env.CIPP_TENANT_ID!, clientId: env.CIPP_CLIENT_ID!, clientSecret: env.CIPP_CLIENT_SECRET! },
        apiUrl: env.CIPP_API_URL!,
      })
    : (undefined as unknown as CippReadClient);

  it('tenants, then one tenant\'s licenses, subscriptions and SKUs', async () => {
    const tenants = await client.listTenants();
    expect(tenants.length).toBeGreaterThan(0);
    const t = tenants.find((x) => !x.Excluded) ?? tenants[0]!;
    expect(t.customerId).toMatch(/^[0-9a-f-]{36}$/i);

    const licenses = await client.listLicenses(t.defaultDomainName);
    for (const l of licenses) {
      expect(typeof l.skuId).toBe('string');
      const c = licenseCounts(l);
      if (c.total !== undefined) expect(c.total).toBeGreaterThanOrEqual(0);
    }
    const subs = await client.listDirectorySubscriptions(t.customerId);
    const skus = await client.listSubscribedSkus(t.defaultDomainName);
    for (const s of subs) expect(typeof s.skuId).toBe('string');
    console.log(`[live] tenants=${tenants.length} licenses=${licenses.length} subscriptions=${subs.length} skus=${skus.length}`);
  }, 180_000);
});
