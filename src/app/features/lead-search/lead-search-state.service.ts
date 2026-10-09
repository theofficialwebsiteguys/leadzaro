import { Injectable } from '@angular/core';
import { LeadSearchResult, SearchDiscovery } from '../../core/models/lead.model';
import { ContactResearch, PossibleDuplicate } from '../../core/models/sales.model';

/** What the employee chose on the guided search form (ADR 0014). */
export interface SearchSelection {
  categories: string[];
  subcategories: string[];
  keywords: string;
  locationType: 'territory' | 'place';
  territory: string;
  location: string;
  wholeArea: boolean;
  radius: number;
  minRating: string;
  minReviews: string;
}

export type RowDiscovery = SearchDiscovery | 'checking' | 'error';

/**
 * The last search, its results and everything done to them, kept for the
 * session so opening a lead and coming back returns to the same list,
 * filters and scroll position without paying for the search again.
 */
export interface LeadSearchSnapshot {
  selection: SearchSelection;
  results: LeadSearchResult | null;
  searched: boolean;
  opportunityFor: Record<string, string>;
  discoveries: Record<string, RowDiscovery>;
  savedContact: Record<string, ContactResearch | null>;
  needsReview: Record<string, PossibleDuplicate[]>;
  showExisting: boolean;
  noWebsiteOnly: boolean;
  selected: string[];
  scrollTop: number;
}

@Injectable({ providedIn: 'root' })
export class LeadSearchStateService {
  snapshot: LeadSearchSnapshot | null = null;
}
