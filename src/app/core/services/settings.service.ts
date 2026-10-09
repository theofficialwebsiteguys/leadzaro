import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import {
  IntegrationsResponse, MySettings, NotificationSettings, Overview, WorkspaceSettings,
} from '../models/settings.model';
import { AuthService } from './auth.service';

const API = '/api/v1/settings';

/**
 * Settings and the Dashboard overview (ADR 0012). `me` is cached so other
 * screens (Find Leads, the composer) can use personal defaults without
 * another request.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly mine = signal<MySettings | null>(null);

  private unwrap<T>(request: Observable<{ data: T }>): Observable<T> {
    return request.pipe(map((r) => r.data));
  }

  me(): Observable<MySettings> {
    return this.unwrap(this.http.get<{ data: MySettings }>(`${API}/me`)).pipe(tap((m) => this.mine.set(m)));
  }

  /** Loads `me` once per session for screens that only need defaults. */
  ensureMe(): void {
    if (!this.mine()) this.me().subscribe({ error: () => undefined });
  }

  updateProfile(body: { name?: string; phone?: string; title?: string }): Observable<MySettings> {
    return this.unwrap(this.http.put<{ data: MySettings }>(`${API}/me/profile`, body)).pipe(tap((m) => {
      this.mine.set(m);
      const user = this.auth.currentUser();
      if (user) this.auth.currentUser.set({ ...user, name: m.user.name });
    }));
  }

  updateSalesPreferences(body: Record<string, unknown>): Observable<MySettings> {
    return this.unwrap(this.http.put<{ data: MySettings }>(`${API}/me/sales-preferences`, body)).pipe(tap((m) => this.mine.set(m)));
  }

  workspace(): Observable<WorkspaceSettings> {
    return this.unwrap(this.http.get<{ data: WorkspaceSettings }>(`${API}/workspace`));
  }

  updateWorkspace(body: { company?: Record<string, unknown>; defaults?: Record<string, unknown>; salesKit?: unknown; leadSearch?: unknown }): Observable<WorkspaceSettings> {
    return this.unwrap(this.http.put<{ data: WorkspaceSettings }>(`${API}/workspace`, body));
  }

  integrations(): Observable<IntegrationsResponse> {
    return this.unwrap(this.http.get<{ data: IntegrationsResponse }>(`${API}/integrations`));
  }

  notifications(): Observable<NotificationSettings> {
    return this.unwrap(this.http.get<{ data: NotificationSettings }>(`${API}/notifications`));
  }

  updateNotifications(changes: { key: string; inApp?: boolean; email?: boolean }[]): Observable<NotificationSettings> {
    return this.unwrap(this.http.put<{ data: NotificationSettings }>(`${API}/notifications`, { changes }));
  }

  overview(scope: 'mine' | 'team', period: string): Observable<Overview> {
    const params = new HttpParams().set('scope', scope).set('period', period).set('tzOffset', String(new Date().getTimezoneOffset()));
    return this.unwrap(this.http.get<{ data: Overview }>('/api/v1/overview', { params }));
  }
}
