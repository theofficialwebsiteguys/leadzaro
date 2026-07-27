import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DesignSystemTemplate } from '../models/designSystemTemplate.model';

@Injectable({ providedIn: 'root' })
export class DesignSystemTemplateService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { designSystemTemplates: DesignSystemTemplate[] } }> {
    return this.http.get<{ data: { designSystemTemplates: DesignSystemTemplate[] } }>('/api/v1/design-system-templates');
  }

  listForGovernance(): Observable<{ data: { designSystemTemplates: DesignSystemTemplate[] } }> {
    return this.http.get<{ data: { designSystemTemplates: DesignSystemTemplate[] } }>('/api/v1/design-system-templates/manage');
  }

  create(payload: { name: string }): Observable<{ data: { designSystemTemplate: DesignSystemTemplate } }> {
    return this.http.post<{ data: { designSystemTemplate: DesignSystemTemplate } }>('/api/v1/design-system-templates', payload);
  }

  publish(id: string): Observable<{ data: { designSystemTemplate: DesignSystemTemplate } }> {
    return this.http.post<{ data: { designSystemTemplate: DesignSystemTemplate } }>(`/api/v1/design-system-templates/${id}/publish`, {});
  }

  deprecate(id: string): Observable<{ data: { designSystemTemplate: DesignSystemTemplate } }> {
    return this.http.post<{ data: { designSystemTemplate: DesignSystemTemplate } }>(`/api/v1/design-system-templates/${id}/deprecate`, {});
  }
}
