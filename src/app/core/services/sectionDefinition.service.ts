import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SectionDefinition } from '../models/sectionDefinition.model';

@Injectable({ providedIn: 'root' })
export class SectionDefinitionService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { sectionDefinitions: SectionDefinition[] } }> {
    return this.http.get<{ data: { sectionDefinitions: SectionDefinition[] } }>('/api/v1/section-definitions');
  }

  listForGovernance(): Observable<{ data: { sectionDefinitions: SectionDefinition[] } }> {
    return this.http.get<{ data: { sectionDefinitions: SectionDefinition[] } }>('/api/v1/section-definitions/manage');
  }

  create(payload: { name: string; componentKey: string; category: string }): Observable<{ data: { sectionDefinition: SectionDefinition } }> {
    return this.http.post<{ data: { sectionDefinition: SectionDefinition } }>('/api/v1/section-definitions', payload);
  }

  publish(id: string): Observable<{ data: { sectionDefinition: SectionDefinition } }> {
    return this.http.post<{ data: { sectionDefinition: SectionDefinition } }>(`/api/v1/section-definitions/${id}/publish`, {});
  }

  deprecate(id: string): Observable<{ data: { sectionDefinition: SectionDefinition } }> {
    return this.http.post<{ data: { sectionDefinition: SectionDefinition } }>(`/api/v1/section-definitions/${id}/deprecate`, {});
  }
}
