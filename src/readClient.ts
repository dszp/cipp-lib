import { CippHttp, type CippHttpConfig } from './http.js';
import type { DirectorySubscription, License, ListTenantsOptions, SubscribedSku, Tenant, TenantFilter } from './model.js';

export type CippReadClientConfig = CippHttpConfig;

/**
 * Read-only client for the CIPP API: tenants and per-tenant Microsoft 365 licensing.
 *
 * Only GET routes that read are called, and only these. `ListTenants`' refresh and cache-clearing
 * options, which queue work inside CIPP, are not reachable. Graph reads go through CIPP's
 * `ListGraphRequest` with a fixed endpoint per method, never one a caller supplies.
 *
 * If writes are added, they belong in a separate write client with its own transport; this class
 * will never gain a mutating method.
 */
export class CippReadClient {
  readonly #http: CippHttp;

  constructor(config: CippReadClientConfig) {
    this.#http = new CippHttp(config);
  }

  /** Every tenant this credential may see. */
  async listTenants(opts: ListTenantsOptions = {}): Promise<Tenant[]> {
    return asArray(await this.#http.get<Tenant[]>('/api/ListTenants', { Search: opts.search }));
  }

  /**
   * One tenant's licenses, read live from Microsoft Graph (expect several seconds per call).
   * `AllTenants` is refused: CIPP answers it from a cache that can return a "check back in 1
   * minute" placeholder instead of data.
   */
  async listLicenses(tenant: TenantFilter): Promise<License[]> {
    return asArray(await this.#http.get<License[]>('/api/ListLicenses', { tenantFilter: tenantFilter(tenant) }));
  }

  /** Graph `directory/subscriptions` for one tenant: each Microsoft subscription and its lifecycle date. */
  async listDirectorySubscriptions(tenant: TenantFilter): Promise<DirectorySubscription[]> {
    return this.#graph<DirectorySubscription>('directory/subscriptions', tenant);
  }

  /** Graph `subscribedSkus` for one tenant: each SKU's prepaid and consumed units. */
  async listSubscribedSkus(tenant: TenantFilter): Promise<SubscribedSku[]> {
    return this.#graph<SubscribedSku>('subscribedSkus', tenant);
  }

  // ---- internals --------------------------------------------------------------------------------

  /** CIPP's Graph passthrough. `endpoint` is always a literal from this class. */
  async #graph<T>(endpoint: 'directory/subscriptions' | 'subscribedSkus', tenant: TenantFilter): Promise<T[]> {
    const body = await this.#http.get<{ Results?: unknown }>('/api/ListGraphRequest', { Endpoint: endpoint, tenantFilter: tenantFilter(tenant) });
    const rows = body?.Results;
    if (!Array.isArray(rows)) {
      throw new Error(`CIPP ListGraphRequest ${endpoint}: expected Results to be an array, got ${typeof rows}.`);
    }
    return rows as T[];
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A DNS name: labels of letters, digits and hyphens, at least one dot.
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * A tenant as a `tenantFilter` value: a default domain name or a tenant GUID. Anything else,
 * including `AllTenants`, is refused before a request is made.
 */
function tenantFilter(tenant: TenantFilter): string {
  if (typeof tenant !== 'string' || !(GUID.test(tenant) || DOMAIN.test(tenant))) {
    throw new TypeError(`CIPP tenant must be a domain name or tenant GUID, got ${JSON.stringify(tenant)}`);
  }
  return tenant;
}

/** CIPP returns bare arrays; an empty body is an empty list, anything else is an error. */
function asArray<T>(body: T[] | undefined): T[] {
  if (body === undefined) return [];
  if (!Array.isArray(body)) throw new Error(`CIPP: expected an array, got ${typeof body}.`);
  return body;
}

/** A license row's counts as numbers. `undefined` where CIPP sent nothing readable. */
export function licenseCounts(row: License): { total?: number; used?: number; available?: number } {
  const n = (v: unknown) => {
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(x) ? x : undefined;
  };
  return { total: n(row.TotalLicenses), used: n(row.CountUsed), available: n(row.CountAvailable ?? row.availableUnits) };
}
