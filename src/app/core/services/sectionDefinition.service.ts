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
}
