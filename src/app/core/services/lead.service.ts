import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  GuidedSearchParams, Lead, LeadSearchParams, LeadSearchResult, PaginatedResponse, PlaceDetails, SearchDiscovery, SearchOptions,
} from '../models/lead.model';

@Injectable({ providedIn: 'root' })
export class LeadService {
  private http = inject(HttpClient);

  search(params: LeadSearchParams): Observable<{ data: LeadSearchResult }> {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        httpParams = httpParams.set(key, String(val));
      }
    });
    return this.http.get<{ data: LeadSearchResult }>('/api/leads/search', { params: httpParams });
  }

  /** Categories, territories and presets for the guided search (ADR 0014). */
  searchOptions(): Observable<{ data: SearchOptions }> {
    return this.http.get<{ data: SearchOptions }>('/api/leads/search-options');
  }

  /** Runs the guided search. Only called when the employee presses “Find businesses”. */
  guidedSearch(params: GuidedSearchParams): Observable<{ data: LeadSearchResult }> {
    return this.http.post<{ data: LeadSearchResult }>('/api/leads/search/guided', params);
  }

  /** Checks one search result's website for a public email (cached per listing on the server). */
  discoverEmail(lead: Lead, force = false): Observable<{ data: { discovery: SearchDiscovery } }> {
    return this.http.post<{ data: { discovery: SearchDiscovery } }>('/api/leads/discover-email', {
      placeId: lead.googlePlaceId || lead.id, website: lead.website || null, name: lead.name, force,
    });
  }

  getById(id: string): Observable<{ data: { lead: Lead } }> {
    return this.http.get<{ data: { lead: Lead } }>(`/api/leads/${id}`);
  }

  getContactDetails(placeId: string): Observable<{ data: { details: { phone: string | null } } }> {
    return this.http.get<{ data: { details: { phone: string | null } } }>(`/api/leads/contact/${encodeURIComponent(placeId)}`);
  }

  /** Phone, website, opening hours and status for one search result (fetched only when a row is expanded). */
  getFullDetails(placeId: string): Observable<{ data: { details: PlaceDetails } }> {
    return this.http.get<{ data: { details: PlaceDetails } }>(`/api/leads/details/${encodeURIComponent(placeId)}`);
  }

  getAll(params?: Record<string, string>): Observable<{ data: PaginatedResponse<Lead> }> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) httpParams = httpParams.set(k, v);
      });
    }
    return this.http.get<{ data: PaginatedResponse<Lead> }>('/api/leads', { params: httpParams });
  }
}
