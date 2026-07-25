import { Component, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/icon/icon.component';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  auth = inject(AuthService);
  closeMobile = output<void>();

  nav: NavItem[] = [
    { label: 'Dashboard',    icon: 'dashboard',     route: '/app/dashboard'    },
    { label: 'Search Leads', icon: 'search',        route: '/app/search'       },
    { label: 'Saved Leads',  icon: 'leads',         route: '/app/leads'        },
    { label: 'Outreach',     icon: 'outreach',      route: '/app/outreach'     },
    { label: 'Subscription', icon: 'subscription',  route: '/app/subscription' },
    { label: 'Settings',     icon: 'settings',      route: '/app/settings'     },
  ];

  logout() {
    this.auth.logout();
  }
}
