// Domain registry, Namecheap connection, hosting plans and renewals (ADR 0009).

/** Where a value came from — shown next to every value that can come from more than one place. */
export type ValueSource = 'namecheap' | 'manual' | 'estimate' | null;

export interface SourcedValue<T> {
  value: T | null;
  source: ValueSource;
  /** The provider's own value when a manual override differs from it. */
  providerValue?: T | null;
  manualValue?: string | null;
  lastKnown?: boolean;
}

export type LinkStateKey = 'linked' | 'missing' | 'not_found' | 'pending' | 'manual' | 'unlinked' | 'conflict' | 'review';

export interface ConnectionSummary {
  provider: 'namecheap';
  connected: boolean;
  configured?: boolean;
  status: 'not_configured' | 'unverified' | 'connected' | 'error';
  lastSuccessfulSyncAt: string | null;
  lastSyncStatus?: string | null;
  syncing: boolean;
  lastError?: { kind: string; message: string } | null;
}

export interface ConnectionStatus {
  provider: 'namecheap';
  configured: boolean;
  status: 'not_configured' | 'unverified' | 'connected' | 'error';
  environment?: 'production' | 'sandbox';
  apiUser?: string | null;
  accountUserName?: string | null;
  clientIp?: string | null;
  hasApiKey: boolean;
  credentialsUpdatedAt?: string | null;
  lastTestedAt?: string | null;
  lastVerifiedAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastSyncFinishedAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastSyncStatus?: 'running' | 'success' | 'partial' | 'failed' | 'interrupted' | null;
  lastSyncTrigger?: 'manual' | 'scheduled' | null;
  lastSyncSummary?: SyncSummary;
  syncing: boolean;
  lastError: { kind: string; message: string; providerCode?: string | null; at?: string } | null;
  account?: { currency?: string | null; availableBalanceCents?: number | null; fundsRequiredForAutoRenewCents?: number | null; fetchedAt?: string };
  secretsKey: { source: 'configured' | 'derived' | 'missing' | 'invalid'; canStore: boolean };
}

export interface SyncSummary {
  domainsSeen?: number;
  domainsAdded?: number;
  markedMissing?: number;
  nameserversFetched?: number;
  pricesFetched?: number;
  sslCertificates?: number;
  apiCalls?: number;
  errors?: { step: string; kind?: string; message: string; domain?: string; tld?: string }[];
}

export interface ConnectionTestResult {
  ok: boolean;
  totalDomains?: number;
  error?: { kind: string; message: string; providerCode?: string | null };
}

export interface CredentialsInput {
  apiUser: string;
  userName?: string;
  apiKey?: string;
  clientIp: string;
  environment: 'production' | 'sandbox';
}

export interface SslCertificate {
  certificateId: string | null;
  hostName: string | null;
  type: string | null;
  status: string | null;
  purchasedOn: string | null;
  expiresOn: string | null;
  isExpired: boolean | null;
}

export interface RenewalCost {
  cents: number | null;
  currency: string | null;
  periodMonths: number | null;
  source: ValueSource;
  estimate: { cents: number; currency: string | null; years: number | null; fetchedAt: string | null; note: string | null } | null;
  note: string | null;
}

export interface Expense {
  id: string;
  domainRecordId: string | null;
  hostingPlanId: string | null;
  amountCents: number;
  currency: string;
  paidOn: string;
  coversFrom: string | null;
  coversTo: string | null;
  description: string | null;
  source: 'manual';
  createdAt: string;
}

export interface DomainLinkView {
  id: string;
  projectId: string | null;
  projectName: string | null;
  hostname: string;
  source: 'client_website' | 'project_url' | 'manual' | 'namecheap_link';
  isPrimary: boolean;
  override: 'confirmed' | 'rejected' | null;
  state: LinkStateKey;
  stateLabel: string;
  linkedBy: 'auto' | 'manual' | null;
  otherClients: { id: string; name: string }[];
}

export interface DomainView {
  id: string;
  domainName: string;
  displayName: string;
  inConnectedAccount: boolean;
  registrar: SourcedValue<string>;
  registeredOn: SourcedValue<string>;
  expiresOn: SourcedValue<string>;
  daysUntilExpiry: number | null;
  autoRenew: SourcedValue<boolean>;
  providerStatus: { isExpired: boolean | null; isLocked: boolean | null; isPremium: boolean | null; privacy: string | null } | null;
  dns: { provider: SourcedValue<string>; nameservers: string[] | null; nameserversSyncedAt: string | null; nameserversError: string | null };
  sslCertificates: SslCertificate[];
  nextChargeOn: SourcedValue<string>;
  notes: string | null;
  sync: { provider: string | null; lastSeenAt: string | null; checkedAt: string | null; missingSince: string | null; stale: boolean };
  ignoredAt: string | null;
  providerMatched: boolean;
  providerPreview: { registrar: string | null; expiresOn: string | null; daysUntilExpiry: number | null; autoRenew: boolean | null } | null;
  links: DomainLinkView[];
  countsForClient: boolean;
  /** A registration this client doesn't own (disputed or unlinked): no details or costs are sent. */
  restricted?: boolean;
  relevance?: 'project' | 'client';
  // Only for people who can manage projects:
  renewal?: RenewalCost;
  clientCharge?: { cents: number; periodMonths: number } | null;
  expenses?: Expense[];
}

export interface HostingPlanClientView {
  organizationId: string;
  clientName: string;
  projects: { id: string; name: string }[];
  allocatedCents?: number | null;
  shareCents?: number | null;
  shareAnnualCents?: number | null;
}

export type AllocationMethod = 'equal' | 'manual' | 'none';

export interface HostingPlanView {
  id: string;
  name: string;
  providerName: string | null;
  planName: string | null;
  controlPanelUrl: string | null;
  billingPeriodMonths: number | null;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
  nextChargeOn: string | null;
  autoRenew: boolean | null;
  allocationMethod: AllocationMethod;
  archivedAt: string | null;
  notes: string | null;
  clientCount: number;
  shared: boolean;
  clients: HostingPlanClientView[];
  relevance?: 'project' | 'client';
  costCents?: number | null;
  currency?: string;
  annualCostCents?: number | null;
  allocation?: { method: AllocationMethod; allocatedCents: number; unallocatedCents: number | null; unknownShares: number };
}

export interface Tally {
  knownCents: number | null;
  knownCount: number;
  unknownCount: number;
  complete: boolean;
}

export interface CostSummary {
  direct: Tally & { items: { kind: 'domain'; name: string; annualCents: number | null; source: ValueSource; currency: string | null }[] };
  allocatedHosting: Tally & { items: { kind: 'hosting'; name: string; annualCents: number | null; method: AllocationMethod; shared: boolean; currency?: string }[] };
  total: Tally;
  notCharged: string[];
  needsReview: number;
  paidLast12MonthsCents: number;
  clientPays: {
    recurringAnnualCents: number | null;
    recurringPriceCents: number | null;
    billingFrequency: string | null;
    setupPriceCents: number | null;
    domainChargesAnnual: Tally;
  };
}

export interface ClientDomainsView {
  connection: ConnectionSummary;
  canSeeInternals: boolean;
  projects: { id: string; name: string }[];
  domains: DomainView[];
  hosting: HostingPlanView[];
  costs: CostSummary | null;
}

/** What a client/project form shows next to a website field. */
export interface DomainMatch {
  state: LinkStateKey | 'platform';
  label: string;
  domainName: string | null;
  displayName?: string;
  hostname: string;
  linkId?: string;
  otherClientIds?: string[];
  platformSuffix?: string;
  preview: { registrar: string | null; expiresOn: string | null; daysUntilExpiry: number | null; autoRenew: boolean | null; isPremium: boolean | null; isExpired: boolean | null } | null;
}

export type LookupState = 'matched' | 'missing' | 'not_found' | 'not_connected' | 'check_failed' | 'platform' | 'invalid';

export interface DomainBrief {
  id: string;
  domainName: string;
  displayName: string;
  registrar: string | null;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
  autoRenew: boolean | null;
  isPremium: boolean | null;
  isExpired: boolean | null;
  inConnectedAccount: boolean;
  missingSince: string | null;
  checkedAt: string | null;
  stale: boolean;
}

export interface LookupResult {
  state: LookupState;
  label: string;
  message?: string;
  domainName?: string;
  displayName?: string;
  hostname: string | null;
  subdomain?: string | null;
  preview: DomainBrief | null;
  linkedElsewhere?: { clientId: string; clientName: string }[];
  checkError?: string | null;
}

export interface ReviewLinkBrief {
  id: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  hostname: string;
  override: 'confirmed' | 'rejected' | null;
}

export interface ReviewQueue {
  connection: ConnectionSummary;
  counts: Record<'unlinked' | 'conflicts' | 'reviews' | 'notFound' | 'missing' | 'ignored', number>;
  unlinked: (DomainBrief & { suggestedClientName: string; suggestions: { clientId: string; clientName: string; projectId: string | null; projectName: string | null; strength: number }[] })[];
  conflicts: (DomainBrief & { links: ReviewLinkBrief[] })[];
  reviews: (DomainBrief & { links: ReviewLinkBrief[] })[];
  notFound: (DomainBrief & { link: ReviewLinkBrief })[];
  missing: (DomainBrief & { links: ReviewLinkBrief[] })[];
  ignored: (DomainBrief & { ignoredAt: string })[];
}

export type RenewalWindow = 'expired' | '7' | '30' | '60' | 'all';

export interface RenewalItem {
  kind: 'domain' | 'ssl' | 'hosting';
  id: string;
  name: string;
  expiresOn: string;
  expiresSource: ValueSource;
  daysUntilExpiry: number;
  autoRenew: SourcedValue<boolean>;
  status: 'linked' | 'unlinked' | 'conflict' | 'review';
  ignored?: boolean;
  shared?: boolean;
  inConnectedAccount?: boolean;
  stale?: boolean;
  certificateStatus?: string | null;
  clients: { id: string; name: string; projects: { id: string; name: string }[] }[];
  cost?: { cents: number | null; currency?: string | null; periodMonths?: number | null; source: ValueSource; annualCents?: number | null };
}

export interface RenewalsResponse {
  window: RenewalWindow;
  counts: Record<RenewalWindow, number>;
  items: RenewalItem[];
  canSeeInternals: boolean;
}

export interface DomainManualInput {
  registrarName?: string | null;
  manualRegisteredOn?: string | null;
  manualExpiresOn?: string | null;
  manualAutoRenew?: 'on' | 'off' | 'unknown' | boolean | null;
  dnsProviderName?: string | null;
  renewalPriceCents?: number | null;
  renewalCurrency?: string | null;
  renewalPeriodMonths?: number | null;
  nextChargeOn?: string | null;
  clientChargeCents?: number | null;
  clientChargePeriodMonths?: number | null;
  notes?: string | null;
}

export interface HostingPlanInput {
  name?: string;
  providerName?: string | null;
  planName?: string | null;
  controlPanelUrl?: string | null;
  costCents?: number | null;
  currency?: string;
  billingPeriodMonths?: number | null;
  expiresOn?: string | null;
  nextChargeOn?: string | null;
  autoRenew?: boolean | null;
  allocationMethod?: AllocationMethod;
  notes?: string | null;
  archived?: boolean;
  clientId?: string;
  projectIds?: string[];
}

export interface ExpenseInput {
  amountCents: number | null;
  currency?: string;
  paidOn: string;
  coversFrom?: string | null;
  coversTo?: string | null;
  description?: string | null;
}

export interface CreateFromDomainInput {
  client: { name: string; websiteUrl?: string };
  project: { name: string; projectType: string; liveUrl?: string } | null;
  contact?: { name?: string; email?: string; phone?: string };
  billing?: { recurringPriceCents?: number | null; billingFrequency?: string | null; setupPriceCents?: number | null };
}

export const PERIOD_OPTIONS: { months: number; label: string; suffix: string }[] = [
  { months: 1, label: 'Monthly', suffix: '/mo' },
  { months: 3, label: 'Quarterly', suffix: '/qtr' },
  { months: 6, label: 'Every 6 months', suffix: '/6 mo' },
  { months: 12, label: 'Yearly', suffix: '/yr' },
  { months: 24, label: 'Every 2 years', suffix: '/2 yr' },
  { months: 36, label: 'Every 3 years', suffix: '/3 yr' },
];

export function periodSuffix(months: number | null | undefined): string {
  return PERIOD_OPTIONS.find((option) => option.months === months)?.suffix ?? '';
}

export const SOURCE_LABELS: Record<Exclude<ValueSource, null>, string> = {
  namecheap: 'Namecheap',
  manual: 'Manual',
  estimate: 'Estimate',
};

export const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  equal: 'Split equally between clients',
  manual: 'Amounts assigned per client',
  none: 'Not charged to clients (overhead)',
};

// ─── Read-only Domains list & domain page (ADR 0010) ────────────────────

export type InventoryFilter = 'all' | 'assigned' | 'unassigned' | 'expiring' | 'attention';

export interface SyncState {
  state: 'not_connected' | 'never_synced' | 'syncing' | 'ok' | 'incomplete' | 'failed';
  status: string;
  configured: boolean;
  syncing: boolean;
  lastSuccessfulSyncAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSyncStatus: string | null;
  domainsInAccount: number | null;
  lastError: string | null;
}

export interface DomainDns {
  usesNamecheapDns: boolean | null;
  nameservers: string[] | null;
  managedAt: string | null;
}

export interface InventoryItem {
  id: string;
  domainName: string;
  displayName: string;
  assigned: boolean;
  clients: { id: string; name: string; projects: { id: string; name: string }[] }[];
  status: { key: 'active' | 'expired' | 'missing' | 'manual'; label: string };
  dns: DomainDns;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
  autoRenew: boolean | null;
  locked: boolean | null;
  ignored: boolean;
  inConnectedAccount: boolean;
  attention: string[];
}

export interface InventoryResponse {
  sync: SyncState;
  counts: Record<InventoryFilter, number>;
  total: number;
  items: InventoryItem[];
}

export interface DomainDetail extends Omit<DomainView, 'links' | 'countsForClient' | 'providerMatched' | 'providerPreview' | 'dns' | 'sync' | 'renewal' | 'clientCharge' | 'expenses' | 'inConnectedAccount'> {
  status: InventoryItem['status'];
  dns: DomainDns;
  locked: boolean | null;
  ownership: 'linked' | 'unlinked' | 'conflict' | 'review';
  links: { id: string; clientId: string; clientName: string; projectId: string | null; projectName: string | null; hostname: string; source: DomainLinkView['source']; state: LinkStateKey; stateLabel: string }[];
  sync: SyncState;
  websiteUrl: string;
  namecheapUrl: string | null;
  inConnectedAccount: boolean;
  canLink: boolean;
}
