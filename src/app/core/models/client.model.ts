import { Contact } from './contact.model';
import { ProjectBilling } from './billing.model';
import { ProjectFile } from './file.model';
import { ProjectHealthStatus, ProjectStage } from './project.model';

export const PROJECT_TYPES = ['website', 'web_app', 'mobile_app', 'seo', 'branding', 'hosting', 'other'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  website: 'Website',
  web_app: 'Web app',
  mobile_app: 'Mobile app',
  seo: 'SEO',
  branding: 'Branding',
  hosting: 'Hosting',
  other: 'Other',
};

export const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annually', 'one_time'] as const;
export type BillingFrequency = typeof BILLING_FREQUENCIES[number];
export const BILLING_FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
  one_time: 'One-time',
};
export const BILLING_FREQUENCY_SUFFIX: Record<BillingFrequency, string> = {
  monthly: '/mo',
  quarterly: '/qtr',
  annually: '/yr',
  one_time: '',
};

export const PAYMENT_STATUSES = ['current', 'pending', 'overdue', 'paused', 'cancelled'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export type WaitingOn = 'us' | 'client';
export type AcquisitionSource = 'sales' | 'existing';

/** Client-list filters (ADR 0013), keyed as the API names them. */
export type ClientFilterKey = 'attention' | 'mine' | 'waiting_us' | 'waiting_client' | 'onboarding' | 'billing' | 'next_overdue' | 'tasks_overdue' | 'missing_info' | 'unassigned';
export type ClientSort = 'name' | 'attention' | 'next_action' | 'since' | 'recent';

export interface TeamMember { id: string; name: string; inactive?: boolean }

export interface ClientHealthReason { flag: string; severity: 'high' | 'medium' | 'low'; text: string }

export interface ClientBillingSummary {
  state: 'problem' | 'subscribed' | 'cancelling' | 'manual' | 'inactive' | 'paid' | 'none';
  label: string;
  source: 'stripe' | 'manual' | null;
  test?: boolean;
  cancelsAt?: string | null;
  paymentStatus?: PaymentStatus | null;
}

export interface ClientHealth {
  flags: string[];
  reasons: ClientHealthReason[];
  missing: { key: string; label: string }[];
  billing: ClientBillingSummary;
  onboarding: { status: string; opportunityId: string; missingEssential: number; completedAt: string | null } | null;
  tasks: { open: number; overdue: number; blocked: number; nextDue: string | null };
  neededFromClient: number;
  lastNoteAt: string | null;
  notesCount: number;
  stripeLinked: boolean;
  lastPayment: { paidAt: string; amountCents: number; currency: string; source: string; test: boolean } | null;
  severity: 'high' | 'medium' | 'low' | null;
}

export interface ClientAccountFields {
  services: string[];
  scopeNotes: string | null;
  clientSince: string | null;
  clientEndedAt: string | null;
  endReason: string | null;
  acquisitionSource: AcquisitionSource | null;
  waitingOn: WaitingOn | null;
  waitingOnNote: string | null;
  waitingOnSince: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
}

export interface ImageRef {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
  originalName: string;
}

export interface LinkEntry {
  label: string | null;
  url: string;
}

export interface OutstandingNeed {
  id: string;
  label: string;
  done: boolean;
}

export interface ClientProfileFields {
  description: string | null;
  logoFileId: string | null;
  featuredImageFileId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  internalNotes: string | null;

  websiteUrl: string | null;
  adminLinks: LinkEntry[];
  /** Omitted unless the viewer can manage projects (see ClientDetail.canSeeInternals). */
  accessNotes?: string | null;

  setupPriceCents: number | null;
  recurringPriceCents: number | null;
  billingFrequency: BillingFrequency | null;
  paymentStatus: PaymentStatus | null;
  billingLinks: LinkEntry[];
  billingNotes: string | null;
  /** Omitted unless the viewer can manage projects. */
  internalMonthlyCostCents?: number | null;
  internalCostNotes?: string | null;

  accountManagerUserId?: string | null;
  services?: string[];
  scopeNotes?: string | null;
  waitingOn?: WaitingOn | null;
  waitingOnNote?: string | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
  clientSince?: string | null;
  clientEndedAt?: string | null;
  endReason?: string | null;
}

export interface ClientProfile extends ClientProfileFields {
  waitingOnSince?: string | null;
  acquisitionSource?: AcquisitionSource | null;
  logo: ImageRef | null;
  featuredImage: ImageRef | null;
}

export interface ClientFile extends ProjectFile {
  organizationId: string;
  url: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
}

export interface ClientProject {
  id: string;
  organizationId: string;
  stage: ProjectStage;
  healthStatus: ProjectHealthStatus;
  name: string | null;
  displayName: string;
  projectType: ProjectType | null;
  description: string | null;
  liveUrl: string | null;
  previewUrl: string | null;
  previewFileId: string | null;
  outstandingNeeds: OutstandingNeed[];
  previewImage: ClientFile | null;
  createdAt: string;
}

export interface ClientNote {
  id: string;
  organizationId: string;
  projectId: string | null;
  authorUserId: string;
  body: string;
  createdAt: string;
  author?: { id: string; name: string };
}

export interface ClientSummary extends Partial<ClientAccountFields> {
  id: string;
  name: string;
  createdAt: string;
  websiteUrl: string | null;
  logo: ImageRef | null;
  cover: ImageRef | null;
  primaryContact: Contact | null;
  projects: { id: string; displayName: string; projectType: ProjectType | null; stage: ProjectStage }[];
  manager?: TeamMember | null;
  health?: ClientHealth;
}

export interface ClientListResult {
  clients: ClientSummary[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  filters: Record<ClientFilterKey, string>;
  team: TeamMember[];
  status: 'active' | 'ended' | 'all';
  sort: ClientSort;
}

export interface ClientListQuery {
  page: number;
  pageSize?: number;
  view?: ClientFilterKey | '';
  q?: string;
  sort?: ClientSort;
  status?: 'active' | 'ended' | 'all';
  manager?: string;
}

export interface ClientSalesHistory {
  deals: { id: string; title: string | null; stage: string; stageLabel: string; wonAt: string | null; createdAt: string; archived: boolean; owner: TeamMember | null }[];
  payments: { id: string; opportunityId: string | null; source: string; kind: string; status: string; amountCents: number; currency: string; paidAt: string; test: boolean }[];
  collected: { currency: string; amountCents: number }[];
  paymentCount: number;
}

export interface ClientTaskItem {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  projectId: string;
  projectName: string | null;
  assignee: TeamMember | null;
}

export interface PossibleDuplicate {
  organizationId: string;
  name: string;
  isClient: boolean;
  reasons: string[];
  opportunityId: string | null;
  stageLabel: string | null;
  assignedTo: { id: string; name: string } | null;
}

export interface ExistingClientInput {
  name: string;
  websiteUrl?: string | null;
  services?: string[];
  accountManagerUserId?: string | null;
  clientSince?: string | null;
  recurringPriceCents?: number | null;
  setupPriceCents?: number | null;
  billingFrequency?: BillingFrequency | null;
  paymentStatus?: PaymentStatus | null;
  scopeNotes?: string | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
  contact?: { name: string; email: string; phone: string; title: string } | null;
  confirmNew?: boolean;
  useOrganizationId?: string;
}

export interface ClientDetail {
  client: { id: string; name: string; createdAt: string };
  /** Whether internal cost, cost notes and access notes were included. */
  canSeeInternals: boolean;
  profile: ClientProfile;
  contacts: Contact[];
  projects: ClientProject[];
  files: ClientFile[];
  recentNotes: ClientNote[];
  notesCount: number;
  stripe: ProjectBilling | null;
  manager: TeamMember | null;
  team: TeamMember[];
  health: ClientHealth;
  tasks: ClientHealth['tasks'] & { items: ClientTaskItem[] };
  sales: ClientSalesHistory;
}

export type ProjectInput = Partial<Pick<ClientProject, 'name' | 'projectType' | 'description' | 'liveUrl' | 'previewUrl' | 'previewFileId' | 'outstandingNeeds'>>;
