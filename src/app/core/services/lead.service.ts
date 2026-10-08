import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Lead, LeadSearchParams, LeadSearchResult, PaginatedResponse, PlaceDetails,
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
