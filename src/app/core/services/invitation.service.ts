import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Invitation, MembershipType } from '../models/organization.model';

@Injectable({ providedIn: 'root' })
export class InvitationService {
  private http = inject(HttpClient);

  list(status?: string): Observable<{ data: { invitations: Invitation[] } }> {
    const query = status ? `?status=${status}` : '';
    return this.http.get<{ data: { invitations: Invitation[] } }>(`/api/v1/invitations${query}`);
  }

  create(payload: { email: string; membershipType: MembershipType; roleKeys: string[] }): Observable<unknown> {
    return this.http.post('/api/v1/invitations', payload);
  }

  resend(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/invitations/${id}/resend`, {});
  }

  revoke(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/invitations/${id}/revoke`, {});
  }
}
