import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Member } from '../models/organization.model';

@Injectable({ providedIn: 'root' })
export class MembershipService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { memberships: Member[] } }> {
    return this.http.get<{ data: { memberships: Member[] } }>('/api/v1/memberships');
  }

  updateRoles(membershipId: string, roleKeys: string[]): Observable<unknown> {
    return this.http.put(`/api/v1/memberships/${membershipId}/roles`, { roleKeys });
  }

  updateStatus(membershipId: string, status: 'active' | 'suspended' | 'removed'): Observable<unknown> {
    return this.http.patch(`/api/v1/memberships/${membershipId}/status`, { status });
  }

  revokeAllSessions(userId: string): Observable<unknown> {
    return this.http.delete(`/api/v1/sessions/users/${userId}`);
  }
}
