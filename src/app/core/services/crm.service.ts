import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  DuplicateGroup, MergePreview, Opportunity, PipelineSummary,
} from '../models/crm.model';
import { PaginatedResponse } from '../models/lead.model';

export interface OpportunityLeadData {
  name: string;
  phone?: string;
  website?: string;
  googlePlaceId?: string;
}

@Injectable({ providedIn: 'root' })
export class CrmService {
  private http = inject(HttpClient);

  getDashboardSummary(): Observable<{ data: PipelineSummary }> {
    return this.http.get<{ data: PipelineSummary }>('/api/v1/crm/dashboard');
  }

  list(filters?: { stage?: string; assignedToUserId?: string; archived?: boolean; page?: number; limit?: number }): Observable<{ data: PaginatedResponse<Opportunity> }> {
    let params = new HttpParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== '') params = params.set(k, String(v));
      });
    }
    return this.http.get<{ data: PaginatedResponse<Opportunity> }>('/api/v1/crm/opportunities', { params });
  }

  create(leadData: OpportunityLeadData): Observable<{ data: { opportunity: Opportunity; organization: unknown } }> {
    return this.http.post<{ data: { opportunity: Opportunity; organization: unknown } }>('/api/v1/crm/opportunities', { leadData });
  }

  updateStage(id: string, updates: { stage?: string; score?: number; scoreReason?: string }): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.put<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${id}`, updates);
  }

  recalculateScore(id: string): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.post<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${id}/recalculate-score`, {});
  }

  claim(id: string): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.post<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${id}/claim`, {});
  }

  assign(id: string, userId: string): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.post<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${id}/assign`, { userId });
  }

  roundRobinAssign(id: string): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.post<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${id}/round-robin-assign`, {});
  }

  archive(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/crm/opportunities/${id}/archive`, {});
  }

  restore(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/crm/opportunities/${id}/restore`, {});
  }

  listDuplicates(): Observable<{ data: { duplicateGroups: DuplicateGroup[] } }> {
    return this.http.get<{ data: { duplicateGroups: DuplicateGroup[] } }>('/api/v1/crm/duplicates');
  }

  previewMerge(winnerId: string, loserId: string): Observable<{ data: MergePreview }> {
    const params = new HttpParams().set('winnerId', winnerId).set('loserId', loserId);
    return this.http.get<{ data: MergePreview }>('/api/v1/crm/merge/preview', { params });
  }

  merge(winnerId: string, loserId: string, reason?: string): Observable<unknown> {
    return this.http.post('/api/v1/crm/merge', { winnerId, loserId, reason });
  }

  undoMerge(loserId: string): Observable<{ data: { opportunity: Opportunity } }> {
    return this.http.post<{ data: { opportunity: Opportunity } }>(`/api/v1/crm/opportunities/${loserId}/undo-merge`, {});
  }
}
