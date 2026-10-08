import { Component, ElementRef, HostListener, OnInit, inject, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { NotificationItem } from '../../core/models/organization.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { relativeDay } from '../../features/sales/shared/sales-format';

type NotificationData = Record<string, unknown> | null | undefined;

const PROJECT_TABS: Record<string, string> = {
  task_assigned: 'tasks',
  message_mention: 'messages',
  meeting_requested: 'meetings',
  meeting_confirmed: 'meetings',
  meeting_declined: 'meetings',
  client_request_submitted: 'requests',
  cancellation_requested: 'settings',
  cancellation_confirmed: 'settings',
  cancellation_withdrawn: 'settings',
};

const ICONS: Record<string, string> = {
  lead_assignment: 'leads', 'sales.reply': 'message', 'sales.payment_received': 'card', renewal_upcoming: 'globe', role_change: 'users', follow_up_due: 'clock',
  task_assigned: 'check', message_mention: 'message', meeting_requested: 'calendar', meeting_confirmed: 'calendar', meeting_declined: 'calendar',
};

/**
 * The notification inbox behind the sidebar bell: newest first, unread
 * highlighted. Opening one marks it read and goes to the record it's
 * about; preferences live in Settings → Notifications.
 */
@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="np" role="dialog" aria-modal="false" aria-labelledby="np-title">
      <header class="np-head">
        <h2 id="np-title">Notifications</h2>
        <div class="np-head-actions">
          @if (hasUnread()) { <button class="link" (click)="markAll()" [disabled]="busy()">Mark all read</button> }
          <a class="icon" routerLink="/app/settings/notifications" (click)="closed.emit()" aria-label="Notification settings" title="Notification settings"><lz-icon name="settings" [size]="15" /></a>
          <button class="icon" (click)="closed.emit()" aria-label="Close notifications"><lz-icon name="x" [size]="16" /></button>
        </div>
      </header>

      <div class="np-body">
        @if (loading() && !items().length) {
          <p class="np-state">Loading…</p>
        } @else if (error()) {
          <div class="np-state">{{ error() }} <button class="link" (click)="load(1)">Try again</button></div>
        } @else {
          @for (n of items(); track n.id) {
            <button class="np-item" [class.unread]="!n.readAt" (click)="open(n)">
              <span class="np-icon" aria-hidden="true"><lz-icon [name]="icon(n)" [size]="15" /></span>
              <span class="np-text">
                <strong>{{ n.title }}</strong>
                @if (n.body) { <span class="np-sub">{{ n.body }}</span> }
                <span class="np-when">{{ when(n.createdAt) }}</span>
              </span>
              @if (!n.readAt) { <span class="np-dot" aria-label="Unread"></span> }
            </button>
          } @empty {
            <div class="np-empty">
              <lz-icon name="bell" [size]="22" />
              <strong>You’re all caught up</strong>
              <span>Replies, payments, assigned leads and renewals will show up here.</span>
            </div>
          }
          @if (hasMore()) { <button class="np-more" (click)="load(page + 1)" [disabled]="loading()">{{ loading() ? 'Loading…' : 'Show older' }}</button> }
        }
      </div>
    </div>
  `,
  styles: [`
    .np {
      position: fixed; z-index: 400; left: calc(var(--sidebar-width) + 8px); bottom: 12px;
      width: min(380px, calc(100vw - var(--sidebar-width) - 24px)); max-height: min(560px, calc(100vh - 24px));
      display: flex; flex-direction: column; background: var(--card); color: var(--text-primary);
      border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
      /* Phones: the sidebar is a drawer, so the panel fills the drawer. */
      @media (max-width: 768px) { left: 8px; right: 8px; width: auto; bottom: 8px; max-height: calc(100vh - 16px); }
    }
    .np-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 14px 10px 16px; border-bottom: 1px solid var(--border-light);
      h2 { margin: 0; font-size: 1rem; } }
    .np-head-actions { display: flex; align-items: center; gap: 4px; }
    .link { border: none; background: none; color: var(--primary-dark); font-size: .78rem; font-weight: 600; cursor: pointer; padding: 4px 6px; border-radius: var(--radius-sm);
      &:hover { background: var(--primary-50); } &:disabled { opacity: .5; } }
    .icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: none; background: none; border-radius: var(--radius); color: var(--text-muted); cursor: pointer;
      &:hover { background: var(--bg-2); color: var(--text-primary); } }
    .np-body { overflow-y: auto; padding: 6px; }
    .np-state { padding: 20px; font-size: .85rem; color: var(--text-muted); text-align: center; margin: 0; }
    .np-item {
      display: flex; gap: 10px; width: 100%; text-align: left; padding: 10px; border: none; background: none; border-radius: var(--radius); cursor: pointer; color: inherit; align-items: flex-start;
      &:hover { background: var(--bg); }
      &:focus-visible { outline: 2px solid var(--primary-light); outline-offset: -2px; }
      &.unread { background: var(--primary-50); &:hover { background: var(--primary-100); } }
    }
    .np-icon { width: 30px; height: 30px; border-radius: var(--radius); display: grid; place-items: center; background: var(--bg-2); color: var(--text-secondary); flex-shrink: 0; }
    .unread .np-icon { background: var(--card); color: var(--primary); }
    .np-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;
      strong { font-size: .85rem; font-weight: 600; } }
    .np-sub { font-size: .78rem; color: var(--text-secondary); white-space: pre-line; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .np-when { font-size: .7rem; color: var(--text-muted); }
    .np-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); margin-top: 6px; flex-shrink: 0; }
    .np-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 20px; text-align: center; color: var(--text-muted);
      strong { color: var(--text-primary); font-size: .9rem; } span { font-size: .8rem; } }
    .np-more { width: 100%; padding: 10px; border: none; background: none; color: var(--primary-dark); font-weight: 600; font-size: .8rem; cursor: pointer; border-radius: var(--radius);
      &:hover { background: var(--bg); } }
  `],
})
export class NotificationsPanelComponent implements OnInit {
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly closed = output<void>();

  readonly items = signal<NotificationItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly hasMore = signal(false);
  page = 1;

  ngOnInit(): void {
    this.load(1);
    this.notifications.refreshUnreadCount();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  /** Clicking anywhere outside the panel (other than the bell itself) closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || this.host.nativeElement.contains(target) || target.closest('.notif-row')) return;
    this.closed.emit();
  }

  load(page: number): void {
    this.loading.set(true);
    this.error.set('');
    this.notifications.list(page, 20).subscribe({
      next: (res) => {
        this.page = page;
        this.items.set(page === 1 ? res.data.items : [...this.items(), ...res.data.items]);
        this.hasMore.set(res.data.pagination.hasNext);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('Notifications couldn’t be loaded.'); },
    });
  }

  hasUnread(): boolean {
    return this.items().some((n) => !n.readAt);
  }

  markAll(): void {
    this.busy.set(true);
    this.notifications.markAllRead().subscribe({
      next: () => { this.busy.set(false); const now = new Date().toISOString(); this.items.set(this.items().map((n) => ({ ...n, readAt: n.readAt ?? now }))); },
      error: () => { this.busy.set(false); this.error.set('Couldn’t mark them as read — try again.'); },
    });
  }

  open(n: NotificationItem): void {
    if (!n.readAt) {
      this.items.set(this.items().map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      this.notifications.markRead(n.id).subscribe({ error: () => undefined });
    }
    const link = this.linkFor(n);
    if (link) {
      this.closed.emit();
      this.router.navigateByUrl(link);
    }
  }

  /** Where a notification leads, from the record ids it carries. */
  linkFor(n: NotificationItem): string | null {
    const data = (n.data ?? null) as NotificationData;
    const str = (key: string) => (data && typeof data[key] === 'string' ? data[key] as string : null);
    const link = str('link');
    if (link && link.startsWith('/app/')) return link;
    const opportunityId = str('opportunityId');
    if (opportunityId) return n.type === 'sales.payment_received' ? `/app/leads/${opportunityId}?tab=handoff` : `/app/leads/${opportunityId}`;
    const projectId = str('projectId');
    if (projectId) return `/app/projects/${projectId}/${PROJECT_TABS[n.type] ?? 'overview'}`;
    if (n.type === 'role_change') return '/app/settings/account';
    if (n.type === 'renewal_upcoming') return '/app/domains';
    if (n.type === 'follow_up_due') return '/app/today';
    return null;
  }

  icon(n: NotificationItem): string {
    return ICONS[n.type] ?? 'bell';
  }

  when(value: string): string {
    const date = new Date(value);
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
    return `${relativeDay(date)} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
}
