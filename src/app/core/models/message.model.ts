export interface ProjectChannel {
  id: string;
  projectId: string;
  key: string;
  name: string;
  visibility: 'client' | 'internal';
}

export interface Message {
  id: string;
  channelId: string;
  authorUserId: string;
  body: string;
  threadParentMessageId: string | null;
  convertedToTaskId: string | null;
  createdAt: string;
  author?: { id: string; name: string };
}
