export interface SeoEntitlementGrant {
  id: string;
  organizationId: string;
  grantedByUserId: string;
  reason: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  createdAt: string;
}

export interface WebsitePageSeoSettings {
  id: string;
  websiteId: string;
  pageId: string;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsDirective: 'index,follow' | 'noindex,follow' | 'index,nofollow' | 'noindex,nofollow';
  schemaJson: Record<string, unknown> | null;
}

export interface SeoPageListEntry {
  pageId: string;
  route: string;
  title: string;
  seoSettings: WebsitePageSeoSettings | null;
}

export interface WebsiteRedirect {
  id: string;
  websiteId: string;
  fromPath: string;
  toPath: string;
  statusCode: 301 | 302;
  createdAt: string;
}

export interface SeoAuditFinding {
  check: string;
  severity: 'error' | 'warning';
  pageId?: string;
  sectionId?: string;
  message: string;
  url?: string;
}

export interface WebsiteSeoAudit {
  id: string;
  websiteId: string;
  websiteVersionId: string;
  runByUserId: string;
  findings: SeoAuditFinding[];
  createdAt: string;
}

export interface SeoTaskCycle {
  id: string;
  websiteId: string;
  cyclePeriod: string;
  generatedByUserId: string;
  createdAt: string;
}

export interface SeoAuditSummary {
  id: string;
  createdAt: string;
  errorCount: number;
  warningCount: number;
}

export interface SeoDashboard {
  entitled: boolean;
  latestAudit: SeoAuditSummary | null;
  taskCycleCount: number;
  redirectCount: number;
  pageSettingsConfiguredCount: number;
  googleSearchConsolePropertyUrl: string | null;
}

export interface AgencySeoOverviewRow {
  organizationId: string;
  organizationName: string;
  entitled: boolean;
}
