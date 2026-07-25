import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { CurrentOrganizationContext } from '../models/organization.model';

/**
 * Holds the caller's active organization/membership/permission set for
 * this session. The backend resolves this from the caller's own active
 * memberships only (see server/core/authorization/context.js) — this
 * service is purely a client-side cache of that resolved context, never
 * a source of authorization truth. Every permission check here is a UI
 * convenience (hide/disable); the server enforces the real boundary.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationContextService {
  private http = inject(HttpClient);

  private context = signal<CurrentOrganizationContext | null>(null);
  private permissionSet = computed(() => new Set(this.context()?.permissions ?? []));

  organization = computed(() => this.context()?.organization ?? null);
  membership = computed(() => this.context()?.membership ?? null);
  availableMemberships = computed(() => this.context()?.availableMemberships ?? []);
  hasMultipleOrganizations = computed(() => this.availableMemberships().length > 1);

  /** Set when the caller switches organizations via the header below. */
  activeOrganizationId = signal<string | null>(null);

  load(): Observable<boolean> {
    return this.http.get<{ data: CurrentOrganizationContext }>('/api/v1/organizations/current').pipe(
      tap((res) => {
        this.context.set(res.data);
        this.activeOrganizationId.set(res.data.organization.id);
      }),
      map(() => true),
      catchError(() => {
        this.context.set(null);
        return of(false);
      })
    );
  }

  clear(): void {
    this.context.set(null);
    this.activeOrganizationId.set(null);
  }

  switchOrganization(organizationId: string): Observable<boolean> {
    this.activeOrganizationId.set(organizationId);
    return this.load();
  }

  hasPermission(key: string): boolean {
    return this.permissionSet().has(key);
  }

  hasAnyPermission(keys: string[]): boolean {
    const set = this.permissionSet();
    return keys.some((k) => set.has(k));
  }
}
