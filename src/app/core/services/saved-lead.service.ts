import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Lead, LeadNote, OutreachActivity, PaginatedResponse, SavedLead } from '../models/lead.model';

@Injectable({ providedIn: 'root' })
export class SavedLeadService {
  private http = inject(HttpClient);

  getAll(filters?: { status?: string; priority?: string; search?: string; page?: number; limit?: number }): Observable<{ data: PaginatedResponse<SavedLead> }> {
    let params = new HttpParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== '') params = params.set(k, String(v));
      });
    }
    return this.http.get<{ data: PaginatedResponse<SavedLead> }>('/api/saved-leads', { params });
  }

  getById(id: string): Observable<{ data: { savedLead: SavedLead; notes: LeadNote[]; activities: OutreachActivity[] } }> {
    return this.http.get<{ data: { savedLead: SavedLead; notes: LeadNote[]; activities: OutreachActivity[] } }>(`/api/saved-leads/${id}`);
  }

  save(leadData: Lead, status?: string, priority?: string): Observable<{ data: { savedLead: SavedLead } }> {
    return this.http.post<{ data: { savedLead: SavedLead } }>('/api/saved-leads', { leadData, status, priority });
  }

  update(id: string, updates: Partial<SavedLead>): Observable<{ data: { savedLead: SavedLead } }> {
    return this.http.put<{ data: { savedLead: SavedLead } }>(`/api/saved-leads/${id}`, updates);
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(`/api/saved-leads/${id}`);
  }

  addNote(savedLeadId: string, content: string): Observable<{ data: { note: LeadNote } }> {
    return this.http.post<{ data: { note: LeadNote } }>(`/api/saved-leads/${savedLeadId}/notes`, { content });
  }
}
