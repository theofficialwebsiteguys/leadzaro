import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { IconComponent } from '../../shared/icon/icon.component';

interface SectionLink {
  path: string;
  label: string;
  icon: string;
  hint: string;
  visible: boolean;
}

/**
 * Settings (ADR 0012), organised by what people are trying to do. Each
 * section is its own route with its own save; the server enforces who may
 * change what.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
  template: `
    <div class="page settings-page">
      <header class="set-page-head">
        <h1>Settings</h1>
        <p>Your account, the workspace, your team and connected services.</p>
      </header>
      <div class="set-layout">
        <nav class="set-nav" aria-label="Settings sections">
          @for (s of sections(); track s.path) {
            <a [routerLink]="s.path" routerLinkActive="active" #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
              <lz-icon [name]="s.icon" [size]="16" />
              <span><strong>{{ s.label }}</strong><small>{{ s.hint }}</small></span>
            </a>
          }
        </nav>
        <main class="set-main"><router-outlet /></main>
      </div>
    </div>
  `,
  styles: [`
    .set-page-head { margin-bottom: 20px; h1 { margin: 0; font-family: var(--font-display); font-size: 1.6rem; letter-spacing: -.02em; } p { margin: 4px 0 0; color: var(--text-muted); font-size: .875rem; } }
    .set-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start;
      @media (max-width: 860px) { grid-template-columns: 1fr; }
    }
    .set-nav {
      position: sticky; top: 16px; display: flex; flex-direction: column; gap: 2px;
      @media (max-width: 860px) { position: static; flex-direction: row; overflow-x: auto; padding-bottom: 4px; small { display: none; } }
      a {
        display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius); text-decoration: none; color: var(--text-secondary);
        border: 1px solid transparent; transition: background var(--transition), border-color var(--transition); white-space: nowrap;
        lz-icon { margin-top: 2px; color: var(--text-muted); }
        span { display: flex; flex-direction: column; gap: 1px; }
        strong { font-size: .875rem; font-weight: 600; }
        small { font-size: .72rem; color: var(--text-muted); white-space: normal; }
        &:hover { background: var(--bg-2); }
        &.active { background: var(--card); border-color: var(--border); box-shadow: var(--shadow-xs); color: var(--text-primary); lz-icon { color: var(--primary); } }
        &:focus-visible { outline: 2px solid var(--primary-light); }
      }
    }
  `],
})
export class SettingsComponent {
  private readonly org = inject(OrganizationContextService);

  readonly sections = computed<SectionLink[]>(() => {
    const employee = this.org.membership()?.membershipType === 'employee';
    return [
      { path: 'account', label: 'My account', icon: 'user', hint: 'Profile, sign-in and your access', visible: true },
      { path: 'workspace', label: 'Workspace', icon: 'folder', hint: 'Company details and shared defaults', visible: employee },
      { path: 'sales-kit', label: 'Sales kit & goals', icon: 'note', hint: 'Services, prices, portfolio, pitch, client goal', visible: employee },
      { path: 'team', label: 'Team & access', icon: 'users', hint: 'Members, roles and invitations', visible: employee },
      { path: 'sales', label: 'Sales preferences', icon: 'target', hint: 'Search defaults, signature, goals', visible: employee && this.org.hasPermission('leads.read') },
      { path: 'integrations', label: 'Integrations', icon: 'zap', hint: 'Stripe, email, texting, domains', visible: employee },
      { path: 'notifications', label: 'Notifications', icon: 'bell', hint: 'What you’re told about', visible: employee && this.org.hasPermission('notifications.manage') },
    ].filter((s) => s.visible);
  });
}
