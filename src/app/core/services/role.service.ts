import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RoleOption {
  id: string;
  key: string;
  name: string;
  scope: 'employee' | 'client';
}

@Injectable({ providedIn: 'root' })
export class RoleService {
  private http = inject(HttpClient);

  list(scope?: 'employee' | 'client'): Observable<{ data: { roles: RoleOption[] } }> {
    const query = scope ? `?scope=${scope}` : '';
    return this.http.get<{ data: { roles: RoleOption[] } }>(`/api/v1/roles${query}`);
  }
}
