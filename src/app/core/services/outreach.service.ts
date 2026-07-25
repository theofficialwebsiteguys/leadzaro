import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { OutreachActivity, OutreachType, PaginatedResponse } from '../models/lead.model';

@Injectable({ providedIn: 'root' })
export class OutreachService {
  private http = inject(HttpClient);

  getAll(leadId?: string, page = 1, limit = 20, archived = false): Observable<{ data: PaginatedResponse<OutreachActivity> }> {
    let params = new HttpParams().set('page', page).set('limit', limit).set('archived', String(archived));
    if (leadId) params = params.set('leadId', leadId);
    return this.http.get<{ data: PaginatedResponse<OutreachActivity> }>('/api/outreach', { params });
  }

  add(leadId: string, type: OutreachType, note?: string): Observable<{ data: { activity: OutreachActivity } }> {
    return this.http.post<{ data: { activity: OutreachActivity } }>('/api/outreach', { leadId, type, note });
  }

  archive(id: string): Observable<unknown> {
    return this.http.post(`/api/outreach/${id}/archive`, {});
  }

  restore(id: string): Observable<unknown> {
    return this.http.post(`/api/outreach/${id}/restore`, {});
  }
}
