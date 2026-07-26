// Mirrors server/core/crm/pipelineCatalog.js — kept in sync manually.
export const PIPELINE_STAGES = [
  'Discovered',
  'New Lead',
  'Researching',
  'Attempting Contact',
  'Contacted',
  'Engaged',
  'Qualified',
  'Proposal or Offer Prepared',
  'Payment Link Sent',
  'Closed Won',
  'Closed Lost',
  'Nurture',
  'Do Not Contact',
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export interface OpportunityOrganization {
  id: string;
  name: string;
  type: 'agency' | 'client' | 'prospect';
  managingAgencyOrganizationId?: string | null;
}

export interface OpportunitySourceLead {
  id: string;
  name: string;
  phone?: string | null;
  website?: string | null;
  hasWebsite?: boolean;
  city?: string | null;
  state?: string | null;
}

export interface OpportunityAssignee {
  id: string;
  name: string;
  email: string;
}

export interface OpportunityInboundSubmission {
  landingPageSlug: string;
  requestedService: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export interface Opportunity {
  id: string;
  organizationId: string;
  agencyOrganizationId: string;
  sourceLeadId: string;
  stage: PipelineStage;
  assignedToUserId?: string | null;
  score?: number | null;
  scoreReason?: string | null;
  archivedAt?: string | null;
  mergedIntoOpportunityId?: string | null;
  createdAt: string;
  updatedAt: string;
  organization?: OpportunityOrganization;
  assignedTo?: OpportunityAssignee | null;
  sourceLead?: OpportunitySourceLead;
  inboundSubmission?: OpportunityInboundSubmission | null;
}

export interface DuplicateGroup {
  name: string;
  opportunities: { id: string; organizationId: string; stage: string; createdAt: string }[];
}

export interface MergePreview {
  winner: Opportunity;
  loser: Opportunity;
  winnerContacts: unknown[];
  loserContacts: unknown[];
  winnerLocations: unknown[];
  loserLocations: unknown[];
}

export interface PipelineStageCount {
  stage: PipelineStage;
  count: number;
}

export interface MyPipelineStats {
  assigned: number;
  open: number;
  closedWon: number;
  avgScore: number | null;
}

export interface TeamPipelineRow {
  userId: string;
  name: string;
  open: number;
  closedWon: number;
  closedLost: number;
}

export interface PipelineSummary {
  stageCounts: PipelineStageCount[];
  totalActive: number;
  winRate: number | null;
  myStats: MyPipelineStats;
  teamBreakdown: TeamPipelineRow[];
}

export interface WebsiteAuditCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface WebsiteAudit {
  id: string;
  opportunityId: string;
  score: number;
  summary: string;
  checks: WebsiteAuditCheck[];
  generatedAt: string;
}

export interface PublicWebsiteAuditReport {
  businessName: string;
  website: string | null;
  score: number;
  summary: string;
  checks: WebsiteAuditCheck[];
  generatedAt: string;
}
