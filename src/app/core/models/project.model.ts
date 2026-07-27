import { Task } from './task.model';
import { Message } from './message.model';
import { ClientRequest } from './clientRequest.model';
import { Meeting } from './meeting.model';

export const PROJECT_STAGES = [
  'Client Onboarding',
  'Content Collection',
  'Design',
  'Client Review',
  'Development',
  'QA',
  'Client Approval',
  'Launch',
  'Ongoing Support',
] as const;
export type ProjectStage = typeof PROJECT_STAGES[number];

export type ProjectHealthStatus = 'on_track' | 'at_risk' | 'off_track';

export interface Project {
  id: string;
  organizationId: string;
  agencyOrganizationId: string;
  ownerUserId: string | null;
  stage: ProjectStage;
  healthStatus: ProjectHealthStatus;
  healthStatusIsManualOverride: boolean;
  launchedAt: string | null;
  cancellationRequestedAt: string | null;
  sourceConversionAttemptId: string | null;
  organization?: { id: string; name: string };
}

export const PROJECT_ROLE_SLOTS = ['owner', 'project_manager', 'designer', 'advanced_designer', 'developer', 'support', 'billing'] as const;
export type ProjectRoleSlot = typeof PROJECT_ROLE_SLOTS[number];

export interface ProjectAssignment {
  id: string;
  projectId: string;
  userId: string;
  roleSlot: ProjectRoleSlot;
  user?: { id: string; name: string; email: string };
}

export interface ProjectFinancials {
  id: string;
  projectId: string;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  marginNotes: string | null;
}

export interface StageChangeError {
  checklist?: string[];
}

export interface ProjectDashboard {
  project: Project;
  recentTasks: Task[];
  recentMessages: (Message & { channelName: string | null })[];
  recentRequests: ClientRequest[];
  upcomingMeetings: Meeting[];
}
