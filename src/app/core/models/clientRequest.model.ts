export const REQUEST_CATEGORIES = ['content', 'image', 'hours', 'page_section', 'design', 'form', 'bug', 'domain', 'analytics', 'functionality', 'emergency'] as const;
export type RequestCategory = typeof REQUEST_CATEGORIES[number];

export interface ClientRequest {
  id: string;
  projectId: string;
  category: RequestCategory;
  description: string;
  status: 'queued' | 'in_progress' | 'waiting_on_client' | 'completed' | 'declined';
  convertedToTaskId: string | null;
  createdAt: string;
}
