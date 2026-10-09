import type { ContactResearch, DiscoveryStatus } from './sales.model';

export type LeadStatus = 'New' | 'Saved' | 'Contacted' | 'Follow Up' | 'Interested' | 'Not Interested' | 'Closed' | 'Archived';
export type LeadPriority = 'Low' | 'Medium' | 'High';
export type OutreachType = 'email' | 'call' | 'visit' | 'message' | 'linkedin' | 'other';

export const LEAD_STATUSES: LeadStatus[] = ['New', 'Saved', 'Contacted', 'Follow Up', 'Interested', 'Not Interested', 'Closed', 'Archived'];
export const LEAD_PRIORITIES: LeadPriority[] = ['Low', 'Medium', 'High'];

export interface Lead {
  id: string;
  name: string;
  category?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  hasWebsite: boolean;
  googleMapsUrl?: string;
  googlePlaceId?: string;
  rating?: number;
  reviewCount: number;
  source: string;
  createdAt?: string;
  // enriched field from search results
  isSaved?: boolean;
  // Pipeline status for search results (ADR 0011)
  pipeline?: {
    opportunityId: string;
    stage: string;
    stageLabel: string;
    assignedTo: { id: string; name: string } | null;
    isClient: boolean;
    contacted: boolean;
    lastInteractionAt: string | null;
    doNotContact: boolean;
    archived: boolean;
    contact?: ContactResearch | null;
  } | null;
  possibleMatch?: { organizationId: string; name: string; isClient: boolean; reasons: string[] } | null;
  /** Guided search (ADR 0014): which selections found it, and an email check already run on it. */
  matchedQueries?: string[];
  searchArea?: string;
  discovery?: SearchDiscovery | null;
}

/** Email discovery run on an unsaved search result. */
export interface SearchDiscovery {
  status: DiscoveryStatus;
  statusLabel?: string;
  summary: string;
  email: string | null;
  emailSourceUrl: string | null;
  checkedAt: string;
  candidates: { email: string; sourceUrl: string }[];
  website: { url: string; reachable?: boolean | null; secure?: boolean | null; error?: string | null; standalone: boolean } | null;
  facebook: { url: string; match: string } | null;
}

export interface SearchCategory {
  key: string;
  label: string;
  queries: string[];
  subcategories: { key: string; label: string; query: string }[];
}
export interface SearchTerritory { key: string; name: string; areas: string[] }
export interface SearchPreset { key: string; name: string; categories: string[]; subcategories: string[]; territory: string }
export interface SearchOptions {
  categories: SearchCategory[];
  territories: SearchTerritory[];
  presets: SearchPreset[];
  maxQueries: number;
  canEditPresets: boolean;
}

export interface GuidedSearchParams {
  categories: string[];
  subcategories: string[];
  keywords: string;
  mode: 'radius' | 'area';
  location: string;
  areas: string[];
  radius: number;
  minRating?: number | null;
  minReviews?: number | null;
  demo?: boolean;
}

export interface SearchPlan {
  mode: 'radius' | 'area';
  queries: { query: string; label: string; area: string; count: number; error: string | null }[];
  skipped: { query: string; area: string }[];
  notes: string[];
  failed: number;
}

/** A search response: the results plus the searched area (for the map and distances). */
export type LeadSearchResult = PaginatedResponse<Lead> & {
  source: string;
  center?: { lat: number; lng: number } | null;
  radiusMiles?: number | null;
  plan?: SearchPlan;
  hiddenOutsideRadius?: number;
};

export interface PlaceDetails {
  available: boolean;
  demo?: boolean;
  phone: string | null;
  website?: string | null;
  hours: string[];
  businessStatus?: string | null;
  googleMapsUrl?: string | null;
  address?: string | null;
}

export interface SavedLead {
  id: string;
  userId: string;
  leadId: string;
  status: LeadStatus;
  priority: LeadPriority;
  notes?: string;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
  lead?: Lead;
}

export interface LeadNote {
  id: string;
  userId: string;
  leadId: string;
  content: string;
  createdAt: string;
}

export interface OutreachActivity {
  id: string;
  userId: string;
  leadId: string;
  type: OutreachType;
  note?: string;
  createdAt: string;
  lead?: Pick<Lead, 'id' | 'name' | 'city'>;
}

export interface LeadSearchParams {
  keyword?: string;
  location?: string;
  radius?: number;
  minRating?: number;
  minReviews?: number;
  demo?: boolean;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface DashboardStats {
  totalSaved: number;
  contacted: number;
  followUpsDue: number;
  interested: number;
  closed: number;
  noWebsiteLeads: number;
}

export interface DashboardConfig {
  primaryMetric: string;
  quickFilters: string[];
  emphasis: string;
  tip: string;
}
