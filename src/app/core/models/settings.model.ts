// Settings and Dashboard overview (ADR 0012).
import { SalesKit } from './sales.model';

export interface MySettings {
  user: { id: string; name: string; email: string; phone: string | null; emailVerified: boolean; createdAt: string };
  membership: { type: string; title: string | null; since: string; roles: { key: string; name: string; summary: string | null }[] };
  workspace: { id: string; name: string };
  salesPreferences: {
    searchKeywords: string | null; searchLocation: string | null; searchRadius: number | null; signature: string | null; defaultFollowUpDays: number | null;
  };
  effective: {
    searchKeywords: string | null; searchLocation: string | null; searchRadius: number; defaultFollowUpDays: number; timezone: string | null; signature: string;
  };
  sessions: number | null;
}

export interface WorkspaceSettings {
  company: {
    name: string; phone: string | null; email: string | null; website: string | null; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  };
  defaults: { timezone: string | null; defaultSearchLocation: string | null; defaultSearchKeywords: string | null; defaultFollowUpDays: number; clientGoal: number };
  salesKit: SalesKit;
  memberCount: number;
  canEdit: boolean;
}

export type ConnectionState = 'connected' | 'test' | 'attention' | 'not_connected';

export interface IntegrationItem {
  key: 'stripe' | 'email' | 'twilio' | 'namecheap' | 'google_places';
  name: string;
  scope: 'workspace' | 'personal';
  purpose: string;
  state: ConnectionState;
  account: string | null;
  mode: string | null;
  detail: string;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
  manage: 'server' | 'in_app' | 'none';
  personal?: { label: string; value: string | null; needed: boolean };
  diagnostics: Record<string, unknown> | null;
}

export interface IntegrationsResponse {
  canManage: boolean;
  items: IntegrationItem[];
  setupSteps: Record<string, { env: string[]; permissions?: string; events?: string[]; webhookPath?: string; inboundPath?: string }> | null;
}

export interface NotificationCategory {
  key: string;
  group: string;
  label: string;
  channels: ('in_app' | 'email')[];
  inApp: boolean;
  email: boolean | null;
}

export interface NotificationSettings { emailAvailable: boolean; emailTo: string; categories: NotificationCategory[] }

export interface OverviewMetric {
  key: string;
  label: string;
  timeframe: 'period' | 'now';
  format: 'money' | 'money_monthly' | 'count';
  value: number | { currency: string; amountCents: number }[];
  state: 'ok' | 'not_connected';
  note: string;
  link: { path: string; query: Record<string, string> };
}

export interface AttentionItem {
  key: string;
  kind: 'payment' | 'handoff' | 'reply' | 'follow_up' | 'client_info' | 'domain' | 'integration';
  severity: 'high' | 'medium' | 'low';
  subject: string;
  issue: string;
  why: string;
  due?: string | null;
  at: string | null;
  owner: string | null;
  action: { label: string; path: string; query: Record<string, string> };
}

export interface DomainHealth {
  total: number;
  expired: number;
  soonAutoRenewOff: number;
  soonAutoRenewOn: number;
  soonUnknown: number;
  stale: number;
  upcoming: { id: string; kind: string; name: string; expiresOn: string; daysUntilExpiry: number; autoRenew: boolean | null; client: string | null }[];
  connection: { state: ConnectionState; detail: string; lastSyncAt: string | null };
}

export interface Overview {
  scope: 'mine' | 'team';
  canSeeTeam: boolean;
  period: { key: string; label: string; from: string; to: string };
  timezone: string | null;
  generatedAt: string;
  metrics: OverviewMetric[];
  attention: { items: AttentionItem[]; total: number; counts: Record<string, number> };
  sales: { open: number; byStage: { stage: string; label: string; count: number }[]; replies: number; overdue: number; dueToday: number; noNextStep: number } | null;
  clients: {
    active: number;
    goal: { target: number; remaining: number };
    newInPeriod: number;
    salesToExistingInPeriod: number;
    endedInPeriod: number;
    net: number;
    retention: { numerator: number; denominator: number } | null;
    activeAtStart: number;
    fromSales: number;
    existing: number;
    flags: Record<string, number>;
    handoffsOpen: number;
    unassigned: number;
    workload: { userId: string; name: string; clients: number; attention: number; openTasks: number; overdueTasks: number }[] | null;
    mine: { clients: number; attention: number; openTasks: number; overdueTasks: number };
  } | null;
  activity: { kind: string; at: string; title: string; detail: string; amountCents?: number; currency?: string; who: string | null; link: { path: string; query: Record<string, string> } }[];
  domains: DomainHealth | null;
  stripe: { connected: boolean; mode: string; lastWebhookAt: string | null };
  setup: { remaining: { key: string; label: string; detail: string; link: string }[]; total: number } | null;
}
