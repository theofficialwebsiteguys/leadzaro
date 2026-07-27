export const FILE_SCOPES = ['organization', 'project', 'website_asset', 'task_attachment', 'message_attachment', 'request_attachment', 'meeting_attachment'] as const;
export type FileScope = typeof FILE_SCOPES[number];

export interface ProjectFile {
  id: string;
  projectId: string | null;
  scope: FileScope;
  relatedId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isPrivate: boolean;
  variants: Record<string, string>;
  createdAt: string;
}
