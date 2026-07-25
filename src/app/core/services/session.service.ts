import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthSessionInfo } from '../models/organization.model';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { sessions: AuthSessionInfo[] } }> {
    return this.http.get<{ data: { sessions: AuthSessionInfo[] } }>('/api/v1/sessions');
  }

  revoke(id: string): Observable<unknown> {
    return this.http.delete(`/api/v1/sessions/${id}`);
  }
}
