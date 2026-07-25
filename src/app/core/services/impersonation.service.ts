import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ImpersonationCandidate {
  membershipId: string;
  organizationName: string;
  userName: string;
  userEmail: string;
  title?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ImpersonationCandidateService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { candidates: ImpersonationCandidate[] } }> {
    return this.http.get<{ data: { candidates: ImpersonationCandidate[] } }>('/api/v1/impersonation/candidates');
  }
}
