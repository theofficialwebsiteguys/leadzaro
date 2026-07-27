export const WEBSITE_STARTING_MODES = ['template', 'page_kit', 'guided', 'blank'] as const;
export type WebsiteStartingMode = typeof WEBSITE_STARTING_MODES[number];

export interface Website {
  id: string;
  projectId: string;
  designSystemId: string;
  name: string;
  startingMode: WebsiteStartingMode;
  draftSchema: { pages: Array<{ id: string; route: string; title: string; sections: unknown[] }>; [key: string]: unknown };
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
