import { Component, OnInit, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { NotificationService } from '../../core/services/notification.service';
import { IconComponent } from '../../shared/icon/icon.component';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  permission?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  auth = inject(AuthService);
  org = inject(OrganizationContextService);
  notifications = inject(NotificationService);
  closeMobile = output<void>();

  private allNav: NavItem[] = [
    { label: 'Dashboard',    icon: 'dashboard',     route: '/app/dashboard',    permission: 'dashboard.view' },
    { label: 'Search Leads', icon: 'search',        route: '/app/search',       permission: 'leads.search' },
    { label: 'Saved Leads',  icon: 'leads',          route: '/app/leads',        permission: 'leads.read' },
    { label: 'Pipeline',     icon: 'funnel',         route: '/app/pipeline',     permission: 'leads.read' },
    { label: 'Outreach',     icon: 'outreach',       route: '/app/outreach',     permission: 'outreach.read' },
    { label: 'Subscription', icon: 'subscription',   route: '/app/subscription' },
    { label: 'Settings',     icon: 'settings',       route: '/app/settings' },
  ];

  nav = computed(() => this.allNav.filter((item) => !item.permission || this.org.hasPermission(item.permission)));

  showAdminLink = computed(() => this.org.hasAnyPermission(['memberships.manage', 'invitations.manage', 'roles.manage', 'audit.view']));

  ngOnInit() {
    this.notifications.refreshUnreadCount();
  }

  logout() {
    this.auth.logout();
  }
}
