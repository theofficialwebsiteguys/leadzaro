import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ClientRequest } from '../models/clientRequest.model';

@Injectable({ providedIn: 'root' })
export class RequestService {
  private http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { requests: ClientRequest[] } }> {
    return this.http.get<{ data: { requests: ClientRequest[] } }>(`/api/v1/projects/${projectId}/requests`);
  }

  create(projectId: string, category: string, description: string): Observable<{ data: { request: ClientRequest } }> {
    return this.http.post<{ data: { request: ClientRequest } }>(`/api/v1/projects/${projectId}/requests`, { category, description });
  }

  updateStatus(projectId: string, requestId: string, status: string): Observable<{ data: { request: ClientRequest } }> {
    return this.http.patch<{ data: { request: ClientRequest } }>(`/api/v1/projects/${projectId}/requests/${requestId}/status`, { status });
  }
}
