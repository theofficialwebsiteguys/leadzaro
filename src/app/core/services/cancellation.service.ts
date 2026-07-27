import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CancellationRequest } from '../models/cancellationRequest.model';

@Injectable({ providedIn: 'root' })
export class CancellationService {
  private http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { cancellationRequests: CancellationRequest[] } }> {
    return this.http.get<{ data: { cancellationRequests: CancellationRequest[] } }>(`/api/v1/projects/${projectId}/cancellation-requests`);
  }

  create(projectId: string, reason: string): Observable<{ data: { cancellationRequest: CancellationRequest } }> {
    return this.http.post<{ data: { cancellationRequest: CancellationRequest } }>(`/api/v1/projects/${projectId}/cancellation-requests`, { reason });
  }

  confirm(projectId: string, requestId: string): Observable<{ data: { cancellationRequest: CancellationRequest } }> {
    return this.http.post<{ data: { cancellationRequest: CancellationRequest } }>(`/api/v1/projects/${projectId}/cancellation-requests/${requestId}/confirm`, {});
  }

  withdraw(projectId: string, requestId: string): Observable<{ data: { cancellationRequest: CancellationRequest } }> {
    return this.http.post<{ data: { cancellationRequest: CancellationRequest } }>(`/api/v1/projects/${projectId}/cancellation-requests/${requestId}/withdraw`, {});
  }
}
