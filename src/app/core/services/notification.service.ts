import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { NotificationItem, NotificationPreference } from '../models/organization.model';
import { PaginatedResponse } from '../models/lead.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);

  unreadCount = signal(0);

  refreshUnreadCount(): void {
    this.http.get<{ data: { count: number } }>('/api/v1/notifications/unread-count').subscribe({
      next: (res) => this.unreadCount.set(res.data.count),
      error: () => {},
    });
  }

  list(page = 1, limit = 20): Observable<{ data: PaginatedResponse<NotificationItem> }> {
    return this.http.get<{ data: PaginatedResponse<NotificationItem> }>(`/api/v1/notifications?page=${page}&limit=${limit}`);
  }

  markRead(id: string): Observable<unknown> {
    return this.http.post(`/api/v1/notifications/${id}/read`, {}).pipe(tap(() => this.refreshUnreadCount()));
  }

  markAllRead(): Observable<unknown> {
    return this.http.post('/api/v1/notifications/read-all', {}).pipe(tap(() => this.unreadCount.set(0)));
  }

  getPreferences(): Observable<{ data: { preferences: NotificationPreference[] } }> {
    return this.http.get<{ data: { preferences: NotificationPreference[] } }>('/api/v1/notifications/preferences');
  }

  setPreference(category: string, channel: 'in_app' | 'email', frequency: string): Observable<unknown> {
    return this.http.put('/api/v1/notifications/preferences', { category, channel, frequency });
  }
}
