import { HandoffData, Handoff, UserRef } from './sales.model';

/** Guided role-based workflow (ADR 0016). */

export type QualificationStatus = 'draft' | 'needs_research' | 'needs_correction' | 'ready' | 'assigned' | 'unsuitable';
export type SourceStatus = 'not_checked' | 'found' | 'not_found' | 'unable';
export type ContactStatus = 'not_checked' | 'found' | 'not_found';
export type SourceKey = 'google' | 'website' | 'facebook';
export type InterestLevel = 'unknown' | 'cold' | 'warm' | 'hot';
export type WorkRole = 'qualifier' | 'sales' | 'client_manager' | 'admin';

export interface SourceCheck { status: SourceStatus; url: string | null; label: string; note?: string | null; from?: string | null }
export interface ContactCheck { status: ContactStatus; value?: string | null; sourceUrl: string | null; from?: string | null }
export interface OwnerCheck { status: ContactStatus; contactId: string | null; name: string | null; title: string | null; sourceUrl: string | null }

export interface Qualification {
  opportunityId: string;
  status: QualificationStatus | null;
  statusLabel: string;
  inProgress: boolean;
  note: string | null;
  step: number;
  stage: string;
  stageLabel: string;
  business: {
    organizationId: string; name: string; category: string | null; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
    isClient: boolean; rating: number | null; reviewCount: number | null; fromSearch: boolean;
  };
  sources: Record<SourceKey, SourceCheck>;
  contacts: { email: ContactCheck; phone: ContactCheck; owner: OwnerCheck };
  emailDiscovery: { status: string; statusLabel: string; summary: string | null; email: string | null; emailSourceUrl: string | null; candidates: { email: string; sourceUrl?: string }[] };
  reason: { tags: string[]; text: string; evidence: string };
  researcher: UserRef | null;
  qualifiedBy: UserRef | null;
  qualifiedAt: string | null;
  assignedTo: UserRef | null;
  credit: { status: string; reviewNote: string | null; correctionCount: number; lastCorrectionReason: string | null } | null;
  canEdit: boolean;
  missing: { step: number; key: string; label: string }[];
  hasUsableContact: boolean;
}

export interface QualificationResponse {
  qualification: Qualification;
  assignees: (UserRef & { roles: string[] })[];
  reasonOptions: { key: string; label: string; text: string }[];
}

export interface WorkCard {
  opportunityId: string;
  businessName: string;
  city?: string | null;
  state?: string | null;
  status?: string;
  statusLabel?: string;
  note?: string | null;
  step?: number;
  researcher?: UserRef | null;
  assignedTo?: UserRef | null;
  updatedAt?: string;
  qualifiedAt?: string | null;
  qualifiedBy?: UserRef | null;
  reason?: string | null;
  stageLabel?: string;
  at?: string | null;
  method?: string | null;
  closingStatus?: string | null;
  paymentConfirmedAt?: string | null;
  reviewNote?: string | null;
  missingEssential?: number;
  openItems?: number;
  clientManager?: UserRef | null;
  startedAt?: string;
  error?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  nextActionNote?: string | null;
  replyNeededSince?: string | null;
  lastInteractionSummary?: string | null;
  paymentLabel?: string;
  amountCents?: number;
  currency?: string;
  hasPhone?: boolean;
  hasEmail?: boolean;
}

export interface WorkSessionItem {
  id: string;
  workType: string;
  source: 'timer' | 'manual';
  status: 'running' | 'paused' | 'stopped' | 'abandoned';
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  pausedSeconds: number;
  minutes: number | null;
  note: string | null;
  originalMinutes: number | null;
  correctionReason: string | null;
  reviewStatus: 'unreviewed' | 'approved' | 'flagged';
  opportunityId: string | null;
  businessName: string | null;
  user: UserRef | null;
}

export interface TimerState { session: WorkSessionItem | null; abandoned: number; workTypes: string[] }

export interface MyWork {
  roles: WorkRole[];
  qualifier: {
    inProgress: WorkCard[]; corrections: WorkCard[]; ready: WorkCard[];
    feedback: { opportunityId: string; businessName: string; status: string; note: string | null; reviewedAt: string }[];
    stats: { startedThisWeek: number; completedThisWeek: number; completedTotal: number; pendingReview: number; accepted: number };
  } | null;
  sales: {
    replies: WorkCard[]; overdue: WorkCard[]; dueToday: WorkCard[]; payments: WorkCard[]; stalled: WorkCard[]; newLeads: WorkCard[];
    newlyAssigned: WorkCard[]; meetings: WorkCard[]; closing: WorkCard[];
    goals: { metric: string; label: string; actual: number; target: number | null }[];
    queueSize: number; unclaimed: number;
  } | null;
  clientManager: { newHandoffs: WorkCard[]; incomplete: WorkCard[]; clients: { id: string; name: string; nextActionAt: string | null; nextActionNote: string | null; waitingOn: string | null }[] } | null;
  admin: { closingsToApprove: number; readyForAssignment: number; creditsToReview: number; abandonedTimers: number; failedHandoffs: number } | null;
  timer: TimerState;
}

export interface Meeting {
  status: 'scheduled' | 'rescheduled' | 'held' | 'no_show' | 'canceled';
  method: 'phone' | 'video' | 'in_person';
  methodLabel: string;
  at: string | null;
  notes: string | null;
  outcome: string | null;
  updatedAt: string;
}

export interface Proposal {
  service: string | null;
  scope: string | null;
  setupCents: number | null;
  recurringCents: number | null;
  interval: 'month' | 'year';
  message: string | null;
  sentAt?: string | null;
  sentVia?: string | null;
  followUpAt?: string | null;
}

export interface ClosingMilestone { key: string; label: string; done: boolean; at: string | null }

export interface QualificationBrief {
  status: QualificationStatus;
  statusLabel: string;
  note: string | null;
  qualifiedBy: UserRef | null;
  researcher: UserRef | null;
  qualifiedAt: string | null;
  sources: Partial<Record<SourceKey, { status: SourceStatus; url: string | null }>>;
  contacts: Partial<Record<'email' | 'phone' | 'owner', { status: ContactStatus; sourceUrl: string | null }>>;
}

export interface PendingClosing {
  opportunityId: string;
  businessName: string;
  city: string | null;
  state: string | null;
  isExistingClient: boolean;
  stageLabel: string;
  salesperson: UserRef | null;
  submittedBy: UserRef | null;
  submittedAt: string;
  note: string | null;
  qualifiedBy: UserRef | null;
  proposal: Proposal | null;
  paymentConfirmedAt: string | null;
  payment: { amountCents: number; currency: string; source: string; method: string | null; paidAt: string; stripeMode: string | null } | null;
  offer: { title: string | null; initialAmountCents: number | null; recurringAmountCents: number | null; recurringInterval: string | null; currency: string; status: string } | null;
}

export interface Onboarding {
  opportunityId: string;
  clientId: string | null;
  business: { name: string; phone: string | null; email: string | null; website: string | null; facebookUrl: string | null; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; category: string | null };
  contacts: { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }[];
  sale: {
    title: string | null; outreachReason: string | null; need: string | null; service: string | null; decisionMaker: string | null; timing: string | null;
    proposal: Proposal | null; approvedAt: string | null; exception: string | null; salesperson: UserRef | null; qualifiedBy: UserRef | null; clientManager: UserRef | null;
  };
  history: { id: string; channel: string; direction: string; outcomeLabel: string | null; subject: string | null; note: string | null; at: string; user: UserRef | null }[];
  handoff: (Handoff & { data: HandoffData & { requirements?: string; missingInfo?: string; checklist: Record<string, boolean> } }) | null;
  canEdit: boolean;
}

export interface PersonWork {
  user: UserRef & { roles: string[] };
  does: { qualifying: boolean; selling: boolean };
  qualifier: {
    researched: number; completed: number; assigned: number; pending: number; accepted: number; needsCorrection: number; rejected: number; paid: number; returned: number; unsuitable: number; duplicates: number;
    downstream: { contacted: number; meetings: number; paymentConfirmed: number; won: number };
  };
  sales: {
    assignedOpen: number; attempts: number; attemptsByChannel: { channel: string; count: number }[]; uniqueContacted: number; conversations: number; replies: number;
    followUpsDone: number; overdueNow: number; meetings: number; pricingSent: number; paymentsConfirmed: number; paymentsCents: number; approvedClients: number;
  };
  time: { minutes: number; manualMinutes: number; corrected: number };
}

export interface CreditItem {
  id: string;
  status: 'pending' | 'accepted' | 'needs_correction' | 'rejected' | 'paid';
  earnedAt: string;
  user: UserRef;
  reviewNote: string | null;
  reviewedBy: UserRef | null;
  reviewedAt: string | null;
  paidAt: string | null;
  correctionCount: number;
  lastCorrectionReason: string | null;
  opportunityId: string;
  businessName: string;
  location: string;
  reason: string | null;
  qualificationLabel: string | null;
  stageLabel: string | null;
  salesperson: UserRef | null;
  contacted: boolean;
  paymentConfirmed: boolean;
}

export const WORK_TYPE_LABELS: Record<string, string> = {
  qualifying: 'Qualifying',
  research: 'Research', outreach: 'Outreach', calls: 'Calls', meeting: 'Meeting', onboarding: 'Onboarding', admin: 'Admin', other: 'Other',
};

export const CREDIT_LABELS: Record<string, string> = {
  pending: 'Pending review', accepted: 'Accepted', needs_correction: 'Needs correction', rejected: 'Rejected', paid: 'Marked paid',
};

export const INTEREST_LABELS: Record<InterestLevel, string> = { unknown: 'Unknown', cold: 'Cold', warm: 'Warm', hot: 'Hot' };

/** Plain CSV, quoted, for exports opened in a spreadsheet. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
