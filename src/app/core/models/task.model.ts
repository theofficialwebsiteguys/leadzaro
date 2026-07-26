export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export interface Task {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  assigneeUserId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  position: number;
  tags: string[];
  isClientVisible: boolean;
  assignee?: { id: string; name: string };
}

export interface TimeEntry {
  id: string;
  taskId: string;
  userId: string;
  minutes: number;
  note: string | null;
  loggedAt: string;
  user?: { id: string; name: string };
}
