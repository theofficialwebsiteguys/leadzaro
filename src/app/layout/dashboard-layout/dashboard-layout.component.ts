import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, IconComponent],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.scss',
})
export class DashboardLayoutComponent {
  private router = inject(Router);
  private orgContext = inject(OrganizationContextService);
  auth = inject(AuthService);

  sidebarOpen = signal(false);

  exitImpersonation() {
    this.auth.endImpersonation().subscribe(() => {
      this.orgContext.load().subscribe(() => this.router.navigate(['/app/admin']));
    });
  }
}
