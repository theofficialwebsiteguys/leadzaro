// Sales workflow (ADR 0011). Mirrors server/core/crm/pipelineCatalog.js.
export const SALES_STAGES = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'won', 'lost', 'nurture'] as const;
export type SalesStage = typeof SALES_STAGES[number];

export const STAGE_LABELS: Record<SalesStage, string> = {
  new: 'New',
  contacting: 'Contacting',
  qualified: 'Interested / Qualified',
  proposal: 'Meeting / Proposal',
  awaiting_payment: 'Awaiting Payment',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
};

export const OPEN_STAGES: SalesStage[] = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment'];

export type Outcome = 'no_answer' | 'voicemail' | 'connected' | 'interested' | 'meeting_arranged' | 'not_interested' | 'wrong_contact' | 'do_not_contact';
export const OUTCOMES: { key: Outcome; label: string; hint: string }[] = [
  { key: 'no_answer', label: 'No answer', hint: 'Try again later' },
  { key: 'voicemail', label: 'Left voicemail', hint: 'Follow up in a couple of days' },
  { key: 'connected', label: 'Connected', hint: 'Spoke with someone' },
  { key: 'interested', label: 'Interested', hint: 'Moves to Interested / Qualified' },
  { key: 'meeting_arranged', label: 'Meeting arranged', hint: 'Moves to Meeting / Proposal' },
  { key: 'not_interested', label: 'Not interested', hint: 'Closes as lost (or nurture)' },
  { key: 'wrong_contact', label: 'Wrong contact', hint: 'Removes that contact' },
  { key: 'do_not_contact', label: 'Do not contact', hint: 'Stops all outreach' },
];

export type Channel = 'email' | 'sms' | 'call' | 'in_person' | 'linkedin' | 'message' | 'other';
export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email', sms: 'Text', call: 'Call', in_person: 'In person', linkedin: 'LinkedIn', message: 'Message', other: 'Other',
};

export type NextActionType = 'call' | 'email' | 'text' | 'follow_up' | 'meeting' | 'send_offer' | 'payment_follow_up' | 'handoff' | 'other';
export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  call: 'Call', email: 'Email', text: 'Text', follow_up: 'Follow up', meeting: 'Meeting', send_offer: 'Send offer', payment_follow_up: 'Payment follow-up', handoff: 'Handoff', other: 'Other',
};

export interface UserRef { id: string; name: string; email?: string }

/** A deal with no recorded activity for longer than its stage allows (ADR 0013). */
export interface StallInfo { days: number; limit: number; label: string }

export interface LeadCard {
  opportunityId: string;
  businessName: string;
  city?: string | null;
  state?: string | null;
  title?: string | null;
  stage: SalesStage;
  stageLabel: string;
  assignedTo: UserRef | null;
  nextActionAt: string | null;
  nextActionType: NextActionType | null;
  nextActionNote: string | null;
  lastInteractionAt: string | null;
  lastInteractionSummary: string | null;
  replyNeededSince: string | null;
  valueCents: number | null;
  currency: string | null;
  hasPhone?: boolean;
  hasEmail?: boolean;
  paymentRequestId?: string;
  paymentStatus?: string;
  paymentLabel?: string;
  amountCents?: number;
  sentAt?: string | null;
  handoffStatus?: string;
  missingEssential?: number;
  handoffError?: string | null;
  stall?: StallInfo | null;
}

export interface GoalProgress { metric: string; label: string; actual: number; target: number | null; source: 'personal' | 'team' | null }

export interface TodayData {
  generatedAt: string;
  scope: 'mine' | 'team';
  replies: LeadCard[];
  overdue: LeadCard[];
  dueToday: LeadCard[];
  newLeads: LeadCard[];
  newLeadsTotal: number;
  activeDeals: LeadCard[];
  stalled: LeadCard[];
  stalledTotal: number;
  payments: LeadCard[];
  handoffs: LeadCard[];
  unclaimed: number;
  goals: GoalProgress[];
  queueSize: number;
}

export interface QueueItem {
  opportunityId: string;
  businessName: string;
  city?: string | null;
  state?: string | null;
  stage: SalesStage;
  stageLabel: string;
  reason: string;
  label: string;
  dueAt: string | null;
}

export interface LeadRow {
  opportunityId: string;
  organizationId: string;
  businessName: string;
  title: string | null;
  city: string | null;
  state?: string | null;
  category: string | null;
  isClient: boolean;
  stage: SalesStage;
  stageLabel: string;
  assignedTo: UserRef | null;
  valueCents: number | null;
  currency: string;
  lastInteractionAt: string | null;
  lastInteractionSummary: string | null;
  nextActionAt: string | null;
  nextActionType: NextActionType | null;
  nextActionNote: string | null;
  replyNeededSince: string | null;
  doNotContact: boolean;
  archivedAt: string | null;
  isTest: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  website: string | null;
  facebookUrl?: string | null;
  emailStatus?: DiscoveryStatus | null;
  paymentStatus: string | null;
  stall: StallInfo | null;
}

export interface LeadList { items: LeadRow[]; total: number; page: number; limit: number; totalPages: number }

export interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  isPrimary: boolean;
  doNotContact: boolean;
  verifiedAt: string | null;
}

export interface Business {
  id: string;
  name: string;
  type: 'prospect' | 'client';
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  category: string | null;
  detailsSource: Record<string, string>;
  googleMapsUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  listingSource: string | null;
  facebookUrl: string | null;
  contactResearch: ContactResearch;
}

export interface Activity {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  origin: 'platform' | 'manual' | 'external';
  outcome: string | null;
  outcomeLabel: string | null;
  status: string | null;
  subject: string | null;
  body: string | null;
  note: string | null;
  toAddress: string | null;
  fromAddress?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
  occurredAt: string;
  createdAt: string;
  user: UserRef | null;
  contact: { id: string; name: string } | null;
}

export interface LeadNote { id: string; content: string; createdAt: string; user?: UserRef | null }

export interface LineItem { priceId: string; productId: string; name: string; unitAmount: number; currency: string; interval: string | null; source: 'catalog' | 'custom' }

export interface PaymentRequest {
  id: string;
  kind: 'payment_link' | 'checkout_session';
  status: string;
  isOpen: boolean;
  url: string | null;
  stripeMode: string | null;
  currency: string;
  initialAmountCents: number;
  recurringAmountCents: number | null;
  recurringInterval: string | null;
  lineItems: LineItem[];
  offerTitle: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  sentVia: string | null;
  paidAt: string | null;
  amountPaidCents: number | null;
  lastError: string | null;
  replacedByRequestId: string | null;
  createdAt: string;
  createdBy?: UserRef | null;
  attributedTo?: UserRef | null;
  servicePlan?: { name: string } | null;
}

export interface SalesPayment {
  id: string;
  opportunityId: string | null;
  source: 'stripe' | 'manual';
  kind: 'initial' | 'renewal' | 'other';
  status: string;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  paidAt: string;
  stripeMode: string | null;
  receiptUrl: string | null;
  invoiceUrl: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recordedBy?: UserRef | null;
  forThisDeal?: boolean;
}

export interface HandoffItem { key: string; label: string; essential: boolean; done: boolean; hint: string }

export interface HandoffData {
  businessName: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: { line1: string | null; city: string | null; state: string | null; postalCode: string | null };
  contacts: { name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }[];
  agreedServices: string[];
  pricing: { currency: string; initialAmountCents: number; recurringAmountCents: number | null; recurringInterval: string | null } | null;
  payment: { source: string; amountCents: number; currency: string; paidAt: string } | null;
  salesNotes: string;
  promisedWork: string;
  targetDates: { kickoff: string | null; launch: string | null };
  registrarAccess: string;
  hostingAccess: string;
  socialLinks: { facebook: string; instagram: string; linkedin: string; google: string };
  checklist: { logo: boolean; photos: boolean; content: boolean };
  ownerName: string | null;
}

export interface Handoff {
  id: string;
  status: 'pending' | 'needs_info' | 'complete' | 'failed';
  data: HandoffData;
  items: HandoffItem[];
  lastError: string | null;
  attempts: number;
  clientOrganizationId: string | null;
  projectId: string | null;
  completedAt: string | null;
  accessStates: { key: string; label: string }[];
  missingEssential: number;
}

export interface StripeCustomerLink {
  mode: string;
  link: { id: string; stripeCustomerId: string; email: string | null; name: string | null; linkMethod: string; createdAt: string } | null;
  otherModes: { mode: string; stripeCustomerId: string }[];
}

export interface StripeCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created: string | null;
  linkedTo: { organizationId: string; name: string } | null;
  matchedOn?: string;
  sameWebsiteDomain?: boolean;
}

export interface CatalogPrice {
  id: string;
  productId: string;
  productName: string;
  nickname: string | null;
  unitAmount: number;
  currency: string;
  type: 'one_time' | 'recurring';
  interval: string | null;
}

export interface CatalogProduct { id: string; name: string; description: string | null; prices: CatalogPrice[] }

export interface StripeStatus {
  provider: string;
  mode: 'live' | 'test' | 'mock' | 'disabled';
  connected: boolean;
  restrictedKey: boolean;
  webhookSecretConfigured: boolean;
  webhookPath: string;
  automaticTax: boolean;
  promotionCodes: boolean;
  defaultCurrency: string;
  checkoutExpiryHours: number;
  account: { id: string | null; name: string | null; defaultCurrency: string | null } | null;
  accountError: string | null;
  lastWebhookAt: string | null;
  failedWebhooks: number;
  problem: string | null;
}

export interface ChannelState {
  connected: boolean;
  provider: string | null;
  from?: string | null;
  replyTo?: string | null;
  receivesReplies?: boolean;
  tracksDelivery?: boolean;
  testRedirect?: string | null;
  needsYourPhone?: boolean;
  yourPhone?: string | null;
  setup: string;
  note: string | null;
}

export interface Channels { email: ChannelState; sms: ChannelState; call: ChannelState }

export type RecommendationAction = 'call' | 'email' | 'sms' | 'log' | 'offer' | 'check_payment' | 'handoff' | 'client' | 'schedule' | 'edit_business' | 'find_email' | 'intro_email';

export interface Recommendation {
  key: string;
  label: string;
  detail: string;
  tone: 'primary' | 'info' | 'warning' | 'danger' | 'success' | 'muted';
  /** The recorded facts that led to this step. */
  why: string[];
  /** What to find out in the next conversation. */
  ask: string[];
  action: { type: RecommendationAction; label: string } | null;
  tip: string | null;
}

export type QualificationKey = 'qualNeed' | 'qualService' | 'qualDecisionMaker' | 'qualTiming' | 'qualBudget';
export type Qualification = Record<QualificationKey, string | null>;

export interface StageGuide {
  key: SalesStage;
  label: string;
  meaning: string;
  exit: string;
  requires: string[];
  requiresLabels: string[];
  stallDays: number | null;
}

export interface PipelineGuide {
  stages: StageGuide[];
  qualificationFields: { key: QualificationKey; label: string }[];
  closeReasons: { key: string; label: string }[];
  nurtureReasons: { key: string; label: string }[];
}

export interface SalesKitService { name: string; description: string; priceCents: number | null; billing: 'one_time' | 'monthly' | 'yearly' | null }
export interface SalesKit {
  pitch: string;
  services: SalesKitService[];
  portfolio: { label: string; url: string }[];
  objections: { objection: string; response: string }[];
}

/** 422 body when a manual stage move is missing required details. */
export interface StageRequirementError { code: 'stage_requirements'; missing: { key: string; label: string }[]; message: string }
/** 409 body when someone else owns the lead. */
export interface OwnedByOtherError { code: 'owned_by_other'; owner: UserRef | null; message: string }

export interface StripeClientMatch {
  id: string;
  name: string;
  status: 'suggested' | 'ambiguous' | 'none';
  candidates: { id: string; name: string | null; email: string | null; created: string | null; matchedOn: 'email' | 'website' | 'name' }[];
}
export interface StripeClientMatches {
  mode: string;
  customersScanned: number;
  truncated: boolean;
  readAt: string;
  linkedCount: number;
  clientCount: number;
  clients: StripeClientMatch[];
}

export interface Workspace {
  opportunity: {
    id: string;
    title: string | null;
    stage: SalesStage;
    stageLabel: string;
    legacyStage: string | null;
    valueCents: number | null;
    currency: string;
    assignedTo: UserRef | null;
    creditedTo: UserRef | null;
    nextActionAt: string | null;
    nextActionType: NextActionType | null;
    nextActionNote: string | null;
    lastInteractionAt: string | null;
    lastInteractionSummary: string | null;
    replyNeededSince: string | null;
    doNotContact: boolean;
    doNotContactReason: string | null;
    lostReason: string | null;
    wonAt: string | null;
    archivedAt: string | null;
    isTest: boolean;
    score: number | null;
    scoreReason: string | null;
    createdAt: string;
    inboundSubmission: { requestedService: string; landingPageSlug: string } | null;
    paymentStatus: string | null;
    stageChangedAt: string | null;
    closeReasonCode: string | null;
    closeReasonLabel: string | null;
    outreachReason: string | null;
    outreachEvidence: string | null;
    emailDraft: EmailDraft | null;
    qualification: Qualification;
    stall: StallInfo | null;
  };
  business: Business;
  contacts: Contact[];
  primaryContact: Contact | null;
  otherOpportunities: { id: string; title: string | null; stage: SalesStage; createdAt: string; archivedAt: string | null }[];
  activities: Activity[];
  notes: LeadNote[];
  paymentRequests: PaymentRequest[];
  payments: SalesPayment[];
  handoff: Handoff | null;
  stripe: StripeCustomerLink;
  clientId: string | null;
  recommendation: Recommendation;
  channels: Channels;
  outreach: { observations: OutreachObservation[]; previousEmails: PreviousEmail[] };
  pipeline: PipelineGuide;
  salesKit: SalesKit;
  ownership: { mine: boolean; unassigned: boolean };
  permissions: {
    send: boolean; logOutreach: boolean; createPayment: boolean; customOffer: boolean; recordManualPayment: boolean;
    assign: boolean; managePipeline: boolean; archive: boolean; editBusiness: boolean;
  };
}

export interface MessageTemplate {
  id: string;
  scope: 'personal' | 'shared';
  category: string;
  channel: 'email' | 'sms' | 'call';
  name: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
  archivedAt: string | null;
  canEdit: boolean;
}

export const TEMPLATE_CATEGORIES: Record<string, string> = {
  intro: 'First contact', voicemail: 'Voicemail', follow_up: 'Follow-up', meeting_confirmation: 'Meeting confirmation',
  objection: 'Objection handling', payment_reminder: 'Offer & payment', welcome: 'Client welcome', other: 'Other',
};

export interface RenderedMessage { templateId: string | null; channel: string | null; subject: string | null; body: string; unresolved: string[]; paymentRequestId: string | null }

export interface Conversation {
  opportunityId: string;
  businessName: string;
  city?: string | null;
  state?: string | null;
  stage: SalesStage;
  stageLabel: string;
  assignedTo: UserRef | null;
  replyNeededSince: string | null;
  doNotContact: boolean;
  lastInteractionAt: string;
  last: { channel: string; direction: string; origin: string; status: string | null; outcome: string | null; subject: string | null; preview: string; at: string } | null;
}

export interface PossibleDuplicate {
  organizationId: string;
  name: string;
  isClient: boolean;
  reasons: string[];
  opportunityId: string | null;
  stage: SalesStage | null;
  stageLabel: string | null;
  assignedTo: UserRef | null;
}

export interface Ratio { numerator: number; denominator: number }

export interface SalesReport {
  scope: 'mine' | 'team';
  userId: string | null;
  from: string;
  to: string;
  includeTest: boolean;
  attempts: { total: number; byChannel: { channel: string; origin: string; count: number }[] };
  businessesContacted: number;
  businessesReached: number;
  repliesReceived: number;
  reachRate: Ratio | null;
  followUpsCompleted: number;
  followUpsOverdueNow: number;
  meetings: number;
  offers: number;
  paidSales: {
    total: number; stripe: number; manual: number; amounts: { source: string; currency: string; amountCents: number }[];
    /** First payments that created a client vs. sales to businesses that were already clients. */
    newClients: number; existingClients: number;
  };
  closeReasons: { stage: string; code: string; label: string; count: number }[];
  pipelineAging: {
    stage: SalesStage; label: string; count: number; avgDaysInStage: number | null; noNextStep: number; overdue: number; stalled: number; stallDays: number | null;
  }[];
  clients: ClientBase | null;
  closeRate: Ratio | null;
  renewals: { currency: string; count: number; amountCents: number }[];
  handoffsCompleted: number;
  wonWithoutPaymentRecord: number;
  recurringNow: { currency: string; subscriptions: number; monthlyCents: number }[] | null;
  team: {
    userId: string; name: string; attempts: number; contacted: number; reached: number; meetings: number; followUps: number; offers: number;
    paidSales: number; manualSales: number; salesAmountCents: number; handoffs: number; openLeads: number; overdue: number;
  }[] | null;
  recentSales: {
    id: string; opportunityId: string | null; organizationId: string; source: string; amountCents: number; amountRefundedCents: number; currency: string; paidAt: string;
    method: string | null; businessName: string; attributedTo: string | null; newClient: boolean;
  }[];
}

/** The client base in numbers (ADR 0013) — shared by Reports and the Dashboard. */
export interface ClientBase {
  active: number;
  fromSales: number;
  existing: number;
  goal: { target: number; remaining: number };
  newInPeriod: number;
  salesToExistingInPeriod: number;
  endedInPeriod: number;
  endedClients: { id: string; name: string; endedAt: string; reason: string | null }[];
  net: number;
  activeAtStart: number;
  retention: Ratio | null;
  flags: Record<string, number>;
  workload: { userId: string; name: string; clients: number; attention: number; openTasks: number; overdueTasks: number }[];
  unassigned: number;
  needingAttention: { id: string; name: string; severity: string | null; reason: string; flags: string[]; managerId: string | null }[];
  includeTest: boolean;
}

export interface BillingSummary {
  customer: StripeCustomerLink;
  payments: SalesPayment[];
  subscriptions: {
    id: string; status: string; stripeSubscriptionId: string | null; amountCents: number | null; currency: string | null; interval: string | null;
    productName: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; stripeMode: string | null;
  }[];
  invoices: { id: string; number: string | null; status: string; amountDue: number; amountPaid: number; currency: string; created: string; hostedInvoiceUrl: string | null; invoicePdf: string | null }[] | null;
  liveError: string | null;
}

// ---- Contact research and the introduction email (ADR 0014)

/** Email discovery — separate from the lead's stage and from message delivery. */
export type DiscoveryStatus = 'not_checked' | 'checking' | 'found' | 'none_found' | 'failed' | 'needs_review';

export interface DiscoveryCandidate { email: string; sourceUrl: string; via: string; sameDomain: boolean; freeProvider: boolean }

export interface ContactResearch {
  status: DiscoveryStatus;
  statusLabel: string;
  summary: string | null;
  email: string | null;
  emailSource: string | null;
  emailSourceUrl: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  candidates: DiscoveryCandidate[];
  pages: { url: string; ok: boolean; status: number | null; error: string | null }[];
  website: { url: string; finalUrl?: string | null; reachable?: boolean | null; secure?: boolean | null; error?: string | null; checkedAt: string; standalone: boolean } | null;
  facebookUrl: string | null;
  facebookMatch: 'linked_from_website' | 'google_listing' | 'manual' | 'on_record' | 'uncertain' | null;
  facebookSuggestion: { url: string; match: string; sourceUrl?: string } | null;
  markedNoEmail: { by: string; at: string; note: string | null } | null;
}

export interface OutreachObservation { key: string; observation: string; reason: string; evidence: string }
export interface PreviousEmail { id?: string; at: string; subject: string | null; to: string | null; status: string | null; origin?: string; user: UserRef | null }
export interface EmailDraft { subject: string; body: string; to: string | null; savedAt: string; savedBy: UserRef | null }
export interface IntroDraft { subject: string; body: string; evidence: { label: string; value: string; source?: string }[]; warnings: string[]; contactId: string | null }

export const DISCOVERY_LABELS: Record<DiscoveryStatus, string> = {
  not_checked: 'Not checked', checking: 'Checking…', found: 'Email found', none_found: 'No public email found', failed: 'Couldn’t check', needs_review: 'Needs manual review',
};
export const DISCOVERY_TONES: Record<DiscoveryStatus, string> = {
  not_checked: 'tag-muted', checking: 'tag-info', found: 'tag-success', none_found: 'tag-muted', failed: 'tag-danger', needs_review: 'tag-warning',
};

/** A Facebook search for the business, when no page is on record. */
export function facebookSearchUrl(name: string, place?: string | null): string {
  return 'https://www.facebook.com/search/pages/?q=' + encodeURIComponent([name, place].filter(Boolean).join(' '));
}
