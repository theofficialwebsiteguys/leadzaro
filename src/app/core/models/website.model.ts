export const WEBSITE_STARTING_MODES = ['template', 'page_kit', 'guided', 'blank'] as const;
export type WebsiteStartingMode = typeof WEBSITE_STARTING_MODES[number];

export interface WebsiteSection {
  id: string;
  componentKey: string;
  variant?: string;
  settings?: Record<string, unknown>;
  content?: Record<string, unknown>;
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
