export const WEBSITE_STARTING_MODES = ['template', 'page_kit', 'guided', 'blank'] as const;
export type WebsiteStartingMode = typeof WEBSITE_STARTING_MODES[number];

// Per-instance component state (current-phase-plan.md § 2c, Phase 6
// slice 2) — 'inherited' (the default when absent) defers to the
// SectionDefinition's own type-level state (managed/extended/
// registered_custom); 'detached' ejects this ONE instance from
// generated management without affecting any other instance of the
// same componentKey elsewhere.
export type WebsiteSectionInstanceState = 'inherited' | 'detached';

export interface WebsiteSection {
  id: string;
  componentKey: string;
  variant?: string;
  settings?: Record<string, unknown>;
  content?: Record<string, unknown>;
  state?: WebsiteSectionInstanceState;
}

export interface WebsitePage {
  id: string;
  route: string;
  title: string;
  sections: WebsiteSection[];
}

export interface WebsiteSchema {
  pages: WebsitePage[];
  navigation?: { items: Array<{ label: string; route: string }> };
  siteSettings?: Record<string, unknown>;
  organizationContent?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Website {
  id: string;
  projectId: string;
  designSystemId: string;
  name: string;
  startingMode: WebsiteStartingMode;
  draftSchema: WebsiteSchema;
  currentPublishedVersionId: string | null;
  // Phase 7 (current-phase-plan.md § 2b) — which WebsiteDeployment is
  // actually serving live production hosting right now, distinct from
  // currentPublishedVersionId's design-review "approved" pointer.
  currentLiveProductionDeploymentId?: string | null;
  // Guided Google Analytics connection (current-phase-plan.md § 2d).
  googleAnalyticsMeasurementId?: string | null;
}

export type WebsiteVersionStatus = 'draft' | 'pending_review' | 'approved' | 'published';

export interface WebsiteVersion {
  id: string;
  websiteId: string;
  versionNumber: number;
  label: string | null;
  schema: Record<string, unknown>;
  isAutosave: boolean;
  status: WebsiteVersionStatus;
  createdByUserId: string;
  publishedAt: string | null;
  createdAt: string;
}

export type WebsiteEditingLevel = 'basic' | 'professional' | 'advanced';

export interface WebsiteEditorAssignment {
  id: string;
  websiteId: string;
  userId: string;
  editingLevel: WebsiteEditingLevel;
  user?: { id: string; name: string; email: string };
}

export interface WebsiteVersionChange {
  pageId: string;
  sectionId: string;
  key: string;
  editingLevel: WebsiteEditingLevel;
  requiresReview: boolean;
}

export interface WebsiteVersionComparison {
  fromVersion: { id: string; versionNumber: number };
  toVersion: { id: string; versionNumber: number };
  structuralChange: boolean;
  changes: WebsiteVersionChange[];
}

export interface WebsiteComment {
  id: string;
  websiteId: string;
  versionId: string | null;
  anchorKey: string;
  authorUserId: string;
  body: string;
  isInternal: boolean;
  resolvedAt: string | null;
  createdAt: string;
  author?: { id: string; name: string };
}

export interface WebsitePresenceEntry {
  id: string;
  websiteId: string;
  userId: string;
  sectionKey: string | null;
  lastSeenAt: string;
  user?: { id: string; name: string };
}

export interface WebsiteRepository {
  id: string;
  websiteId: string;
  provider: string;
  externalRepoId: string | null;
  fullName: string | null;
  defaultBranch: string;
  status: 'provisioning' | 'active' | 'error';
}

export type WebsiteDeploymentStatus = 'pending' | 'building' | 'live' | 'failed' | 'rolled_back' | 'rollback_failed';

export interface WebsiteDeployment {
  id: string;
  websiteId: string;
  websiteVersionId: string;
  environment: 'preview' | 'production';
  branchName: string;
  commitSha: string | null;
  previewUrl: string | null;
  status: WebsiteDeploymentStatus;
  // Production only (current-phase-plan.md § 2b) — null for preview
  // deploys and for a website's first-ever production attempt.
  previousLiveDeploymentId?: string | null;
  backupRef?: string | null;
  createdAt: string;
}

export interface WebsiteDevelopmentHandoff {
  id: string;
  websiteId: string;
  websiteVersionId: string;
  branchName: string;
  technicalHandoffNotes: string | null;
  status: 'initiated' | 'preview_ready' | 'in_development';
  createdAt: string;
}

// Phase 7 — Production Website Operations (current-phase-plan.md).
// Employee-only, mirroring WebsiteDeployment/WebsiteDevelopmentHandoff.
export interface WebsiteDomain {
  id: string;
  websiteId: string;
  provider: string;
  domain: string;
  status: 'pending' | 'active' | 'expired' | 'transferring';
  registeredAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  dnsRecords: Array<{ type: string; host: string; value: string }>;
  cpanelAccount: string | null;
  documentRootPath: string | null;
  renewalNoticeSentAt: string | null;
}

export interface WebsitePublicFormSubmission {
  id: string;
  websiteId: string;
  websiteVersionId: string;
  pageId: string;
  sectionId: string;
  values: Record<string, unknown>;
  status: 'pending_review' | 'converted' | 'discarded' | 'spam';
  convertedToClientRequestId: string | null;
  createdAt: string;
}

export interface WebsiteAnalyticsEvent {
  id: string;
  websiteId: string;
  eventType: string;
  path: string | null;
  sessionId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WebsiteAnalyticsSummaryRow {
  day: string;
  eventType: string;
  count: number;
}

export interface WebsiteExportBundle {
  exportedAt: string;
  website: { id: string; name: string; domain: string | null };
  version: {
    id: string; versionNumber: number; label: string | null; status: WebsiteVersionStatus;
  };
  files: Array<{ path: string; content: string }>;
}
