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
  } | null;
  possibleMatch?: { organizationId: string; name: string; isClient: boolean; reasons: string[] } | null;
}

/** A search response: the results plus the searched area (for the map and distances). */
export type LeadSearchResult = PaginatedResponse<Lead> & {
  source: string;
  center?: { lat: number; lng: number } | null;
  radiusMiles?: number;
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
