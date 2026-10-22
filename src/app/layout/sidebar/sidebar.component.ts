import { Component, OnDestroy, OnInit, computed, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { MODE_LABELS, WorkModeService } from '../../core/services/work-mode.service';
import { WorkRole } from '../../core/models/workflow.model';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { NotificationService } from '../../core/services/notification.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { NotificationsPanelComponent } from '../notifications-panel/notifications-panel.component';
import { TimeTrackerComponent } from '../time-tracker/time-tracker.component';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  /** Shown with any one of these permissions (ADR 0016 role-based navigation). */
  permission?: string | string[];
  exact?: boolean;
  // Agency-only areas a client membership never sees, even with the permission.
  employeeOnly?: boolean;
  /** Other pages that belong to this item (ADR 0017): a lead opened from it, research resumed from it. */
  also?: (url: string) => boolean;
}

// A lead or a piece of research keeps the menu item it was opened from selected.
const fromLeads = (url: string) => url.startsWith('/app/work/') && /[?&]from=leads\b/.test(url);
const fromConversations = (url: string) => url.startsWith('/app/work/') && /[?&]from=conversations\b/.test(url);
const leadFromMyWork = (url: string) => url.startsWith('/app/work/') && !fromLeads(url) && !fromConversations(url);
const research = (url: string) => /^\/app\/qualify\/(?!new)/.test(url);

interface NavSection {
  title: string | null;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, NotificationsPanelComponent, TimeTrackerComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  org = inject(OrganizationContextService);
  notifications = inject(NotificationService);
  private readonly router = inject(Router);
  closeMobile = output<void>();

  readonly workMode = inject(WorkModeService);
  readonly modeLabels = MODE_LABELS;
  /** The current address, for items that also cover pages opened from them. */
  readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)), { initialValue: this.router.url });

  alsoActive(item: NavItem): boolean {
    return Boolean(item.also?.(this.url()));
  }

  // A short menu per role (ADR 0016): someone with several roles picks one
  // under "Working as" and sees only that role's few pages. The server
  // enforces the real boundaries.
  private readonly menus: Record<WorkRole, NavItem[]> = {
    sales: [
      { label: 'My Work', icon: 'sun', route: '/app/my-work', also: leadFromMyWork },
      { label: 'My leads', icon: 'leads', route: '/app/leads', permission: 'leads.read', also: fromLeads },
      { label: 'Conversations', icon: 'outreach', route: '/app/outreach', permission: 'outreach.read', also: fromConversations },
      { label: 'My numbers', icon: 'chart-bar', route: '/app/sales/reports', permission: 'outreach.read' },
    ],
    qualifier: [
      { label: 'My Work', icon: 'sun', route: '/app/my-work', also: research },
      { label: 'Qualify businesses', icon: 'play', route: '/app/qualify', permission: 'qualification.work', exact: true },
      { label: 'Add a business', icon: 'plus', route: '/app/qualify/new', permission: 'qualification.work' },
    ],
    client_manager: [
      { label: 'My Work', icon: 'sun', route: '/app/my-work' },
      { label: 'Clients', icon: 'folder', route: '/app/clients', permission: ['projects.manage', 'clients.onboard'] },
      { label: 'Domains', icon: 'globe', route: '/app/domains', permission: 'domains.view' },
    ],
    admin: [
      { label: 'My Work', icon: 'sun', route: '/app/my-work', also: (url) => leadFromMyWork(url) || research(url) },
      { label: 'Team work', icon: 'users', route: '/app/team-work', permission: ['team.review_work', 'sales.approve_close'] },
      { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard', permission: 'dashboard.view' },
      { label: 'All leads', icon: 'leads', route: '/app/leads', permission: 'leads.read', also: fromLeads },
      { label: 'Clients', icon: 'folder', route: '/app/clients', permission: ['projects.manage', 'clients.onboard'] },
      { label: 'Domains', icon: 'globe', route: '/app/domains', permission: 'domains.view' },
    ],
  };

  // People without one of the four work roles (designers, developers…) keep the general menu.
  private readonly general: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard', permission: 'dashboard.view' },
    { label: 'Clients', icon: 'folder', route: '/app/clients', permission: 'projects.view' },
    { label: 'Domains', icon: 'globe', route: '/app/domains', permission: 'domains.view' },
  ];

  navSections = computed<NavSection[]>(() => {
    const employee = this.org.membership()?.membershipType === 'employee';
    const mode = this.workMode.mode();
    const items = (mode && employee ? this.menus[mode] : this.general)
      .filter((item) => !item.permission || this.org.hasAnyPermission(Array.isArray(item.permission) ? item.permission : [item.permission]));
    return [
      { title: null, items },
      { title: null, items: [{ label: 'Settings', icon: 'settings', route: '/app/settings' }] },
    ];
  });

  setMode(mode: WorkRole): void {
    this.workMode.set(mode);
    this.router.navigate(['/app/my-work']);
    this.closeMobile.emit();
  }

  readonly showNotifications = signal(false);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.notifications.refreshUnreadCount();
    // Keep the bell's unread count current while the app is open.
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.notifications.refreshUnreadCount();
    }, 60000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  toggleNotifications() {
    this.showNotifications.set(!this.showNotifications());
  }

  closeNotifications() {
    this.showNotifications.set(false);
    this.closeMobile.emit();
  }

  logout() {
    this.auth.logout();
  }
}
