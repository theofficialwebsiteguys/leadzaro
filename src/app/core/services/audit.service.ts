import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuditLogEntry } from '../models/organization.model';
import { PaginatedResponse } from '../models/lead.model';

@Injectable({ providedIn: 'root' })
export class AuditService {
  private http = inject(HttpClient);

  list(page = 1, limit = 20): Observable<{ data: PaginatedResponse<AuditLogEntry> }> {
    return this.http.get<{ data: PaginatedResponse<AuditLogEntry> }>(`/api/v1/audit?page=${page}&limit=${limit}`);
  }
}
