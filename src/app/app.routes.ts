import { Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './core/guards/auth.guard';
import { requireAnyPermissionGuard } from './core/guards/permission.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'login',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    // Reachable while logged out (new invitee) or logged in (existing
    // user accepting an additional membership) — no auth guard.
    path: 'accept-invite',
    loadComponent: () => import('./features/invitation-accept/invitation-accept.component').then((m) => m.InvitationAcceptComponent),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/dashboard-layout/dashboard-layout.component').then((m) => m.DashboardLayoutComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'search',
        loadComponent: () => import('./features/lead-search/lead-search.component').then((m) => m.LeadSearchComponent),
      },
      {
        path: 'leads',
        loadComponent: () => import('./features/saved-leads/saved-leads.component').then((m) => m.SavedLeadsComponent),
      },
      {
        path: 'pipeline',
        loadComponent: () => import('./features/crm-pipeline/crm-pipeline.component').then((m) => m.CrmPipelineComponent),
      },
      {
        path: 'leads/:id',
        loadComponent: () => import('./features/lead-detail/lead-detail.component').then((m) => m.LeadDetailComponent),
      },
      {
        path: 'outreach',
        loadComponent: () => import('./features/outreach/outreach.component').then((m) => m.OutreachComponent),
      },
      {
        path: 'subscription',
        loadComponent: () => import('./features/subscription/subscription.component').then((m) => m.SubscriptionComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'admin',
        canActivate: [requireAnyPermissionGuard(['memberships.manage', 'invitations.manage', 'roles.manage', 'audit.view'])],
        loadComponent: () => import('./features/administration/administration.component').then((m) => m.AdministrationComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
