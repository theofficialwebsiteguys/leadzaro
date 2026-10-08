import { Component, OnDestroy, OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { NotificationService } from '../../core/services/notification.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { NotificationsPanelComponent } from '../notifications-panel/notifications-panel.component';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  permission?: string;
  // Agency-only areas a client membership never sees, even with the permission.
  employeeOnly?: boolean;
}

interface NavSection {
  title: string | null;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, NotificationsPanelComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  org = inject(OrganizationContextService);
  notifications = inject(NotificationService);
  closeMobile = output<void>();

  private sections: NavSection[] = [
    { title: null, items: [
      { label: 'Dashboard', icon: 'dashboard', route: '/app/dashboard', permission: 'dashboard.view' },
    ] },
    { title: 'Sales', items: [
      { label: 'Today',      icon: 'sun',       route: '/app/today',         permission: 'leads.read', employeeOnly: true },
      { label: 'Find Leads', icon: 'search',    route: '/app/search',        permission: 'leads.search' },
      { label: 'Leads',      icon: 'leads',     route: '/app/leads',         permission: 'leads.read', employeeOnly: true },
      { label: 'Outreach',   icon: 'outreach',  route: '/app/outreach',      permission: 'outreach.read', employeeOnly: true },
      { label: 'Reports',    icon: 'chart-bar', route: '/app/sales/reports', permission: 'leads.read', employeeOnly: true },
    ] },
    { title: 'Client Management', items: [
      { label: 'Clients', icon: 'folder', route: '/app/clients', permission: 'projects.view', employeeOnly: true },
      { label: 'Domains', icon: 'globe', route: '/app/domains', permission: 'domains.view', employeeOnly: true },
    ] },
    { title: 'Settings', items: [
      { label: 'Settings', icon: 'settings', route: '/app/settings' },
    ] },
  ];

  navSections = computed(() =>
    this.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => (!item.permission || this.org.hasPermission(item.permission))
          && (!item.employeeOnly || this.org.membership()?.membershipType === 'employee')),
      }))
      .filter((section) => section.items.length > 0)
  );

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
