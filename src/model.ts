/**
 * Response and option types for the CIPP API routes this library reads.
 *
 * CIPP has no published schema; these shapes come from its source (github.com/KelvinTegelaar/
 * CIPP-API) and from live responses. Fields are optional because CIPP passes through whatever
 * Microsoft Graph returned. Types are honest about CIPP's quirks: some counts arrive as strings.
 * Transport-free, so code that receives CIPP data some other way can use them.
 *
 * Dates are kept as the strings CIPP sends (ISO 8601, usually with `Z`).
 */

/** A tenant as CIPP identifies it in `tenantFilter`: its default domain name or its tenant GUID. */
export type TenantFilter = string;

/** A managed tenant from `ListTenants`. CIPP's own table bookkeeping fields are left untyped. */
export interface Tenant {
  /** The Microsoft tenant id (GUID). */
  customerId: string;
  defaultDomainName: string;
  displayName: string;
  initialDomainName?: string;
  /** For example `granularDelegatedAdminPrivileges`. */
  delegatedPrivilegeStatus?: string;
  /** The tenant's domains, as one comma-separated string. */
  domains?: string;
  /** GDAP relationship: whether it extends itself, how many relationships, and when the last one ends. */
  hasAutoExtend?: boolean;
  relationshipCount?: number;
  relationshipEnd?: string;
  /** True when the tenant is excluded in CIPP's settings. */
  Excluded?: boolean;
  LastRefresh?: string;
  LastGraphError?: string;
  RequiresRefresh?: boolean;
  [key: string]: unknown;
}

export interface ListTenantsOptions {
  /** Case-insensitive substring match over display name, default and initial domain, and tenant id. */
  search?: string;
}

/** One Microsoft subscription behind a license, from CIPP's `TermInfo`. */
export interface LicenseTerm {
  /** For example `Enabled`, `Warning`, `Suspended`, `Deleted`. */
  Status?: string;
  /** For example `Monthly` or `Annual`, derived by CIPP. */
  Term?: string;
  TotalLicenses?: number;
  DaysUntilRenew?: number;
  /** When the subscription next renews, expires or changes state. */
  NextLifecycle?: string;
  CreatedDateTime?: string;
  IsTrial?: boolean;
  /** Graph `directory/subscriptions` `id`. */
  SubscriptionId?: string;
  /** Graph `commerceSubscriptionId`. */
  CSPSubscriptionId?: string;
  /** Graph `ocpSubscriptionId`. */
  OCPSubscriptionId?: string;
}

export interface ServicePlan {
  servicePlanId?: string;
  servicePlanName?: string;
  servicePlanType?: string;
  provisioningStatus?: string;
  appliesTo?: string;
}

export interface LicensedPrincipal {
  displayName?: string;
  userPrincipalName?: string;
  id?: string;
}

/**
 * One SKU in a tenant, from `ListLicenses`: Graph `subscribedSkus` joined with the subscriptions
 * behind it and who holds it.
 *
 * `CountUsed` and `TotalLicenses` arrive as strings; `CountAvailable` and `availableUnits` as
 * numbers. {@link licenseCounts} reads all of them as numbers.
 */
export interface License {
  Tenant?: string;
  /** The SKU's display name, from CIPP's conversion table. */
  License?: string;
  /** Graph `skuId` (GUID). */
  skuId?: string;
  /** Graph `skuPartNumber`, for example `O365_BUSINESS_ESSENTIALS`. */
  skuPartNumber?: string;
  CountUsed?: string | number;
  CountAvailable?: string | number;
  TotalLicenses?: string | number;
  availableUnits?: number;
  TermInfo?: LicenseTerm[];
  /** Users holding the license. Personal data: handle it as such. */
  AssignedUsers?: LicensedPrincipal[];
  AssignedGroups?: LicensedPrincipal[] | null;
  ServicePlans?: ServicePlan[];
}

/**
 * A Microsoft subscription in a tenant, from Graph `directory/subscriptions` (Graph's
 * `companySubscription`). `ownerType` and `ownerTenantId` do not identify the reseller: in testing
 * `ownerType` was empty for every subscription.
 */
export interface DirectorySubscription {
  id?: string;
  commerceSubscriptionId?: string;
  ocpSubscriptionId?: string;
  skuId?: string;
  skuPartNumber?: string;
  /** For example `Enabled`, `Warning`, `Suspended`, `Deleted`, `LockedOut`. */
  status?: string;
  totalLicenses?: number;
  isTrial?: boolean;
  createdDateTime?: string;
  nextLifecycleDateTime?: string;
  ownerId?: string;
  ownerTenantId?: string;
  ownerType?: string | null;
  serviceStatus?: Array<{ servicePlanId?: string; servicePlanName?: string; provisioningStatus?: string; appliesTo?: string }>;
  /** Added by CIPP: the tenant the row came from. */
  Tenant?: string;
  [key: string]: unknown;
}

/** A SKU in a tenant, from Graph `subscribedSkus`. */
export interface SubscribedSku {
  id?: string;
  skuId?: string;
  skuPartNumber?: string;
  /** `Enabled`, `Warning`, `Suspended`, `Deleted`, `LockedOut`. */
  capabilityStatus?: string;
  appliesTo?: string;
  consumedUnits?: number;
  prepaidUnits?: { enabled?: number; suspended?: number; warning?: number; lockedOut?: number };
  servicePlans?: ServicePlan[];
  Tenant?: string;
  [key: string]: unknown;
}
