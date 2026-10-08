import { Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './core/guards/auth.guard';
import { unsavedChangesGuard } from './features/settings/unsaved-changes.guard';

export const routes: Routes = [
  {
    // Internal tool: the domain root is the login screen, not a public
    // marketing/signup landing page. Accounts are provisioned by an admin
    // via Administration → Invitations, not public self-registration.
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    // Reachable while logged out (new invitee) or logged in (existing
    // user accepting an additional membership) — no auth guard.
    path: 'accept-invite',
    loadComponent: () => import('./features/invitation-accept/invitation-accept.component').then((m) => m.InvitationAcceptComponent),
  },
  {
    // Public shareable website-audit report — no auth, reachable by
    // anyone holding the link (the token itself is the authorization).
    path: 'audit/:token',
    loadComponent: () => import('./features/public-audit/public-audit.component').then((m) => m.PublicAuditComponent),
  },
  {
    // Public marketing/acquisition landing pages feeding the same
    // inbound CRM — no auth.
    path: 'get-started/:slug',
    loadComponent: () => import('./features/public-landing/public-landing.component').then((m) => m.PublicLandingComponent),
  },
  {
    // Where Stripe Checkout returns the customer (public). Never claims a
    // payment succeeded — payments are recorded only from verified webhooks.
    path: 'payment/thanks',
    loadComponent: () => import('./features/sales/payment-thanks/payment-thanks.component').then((m) => m.PaymentThanksComponent),
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
      // Sales workflow (ADR 0011): Today → Find Leads → Leads (list/pipeline)
      // → one workspace per lead → Outreach → Reports.
      {
        path: 'today',
        loadComponent: () => import('./features/sales/today/today.component').then((m) => m.TodayComponent),
      },
      {
        path: 'search',
        loadComponent: () => import('./features/lead-search/lead-search.component').then((m) => m.LeadSearchComponent),
      },
      {
        path: 'leads',
        loadComponent: () => import('./features/sales/leads/leads.component').then((m) => m.LeadsComponent),
      },
      {
        // Also resolves older saved-lead ids to the matching lead.
        path: 'leads/:id',
        loadComponent: () => import('./features/sales/workspace/workspace.component').then((m) => m.WorkspaceComponent),
      },
      // The old Pipeline screen is the Leads board now.
      { path: 'pipeline', pathMatch: 'full', redirectTo: 'leads?layout=board' },
      {
        path: 'sales/reports',
        loadComponent: () => import('./features/sales/reports/sales-reports.component').then((m) => m.SalesReportsComponent),
      },
      {
        // Domains & Renewals (ADR 0009): upcoming renewals, Namecheap domains
        // waiting for a client, and the agency's hosting plans.
        path: 'domains',
        loadComponent: () => import('./features/domains/domains-page/domains-page.component').then((m) => m.DomainsPageComponent),
      },
      {
        // One domain, managed in place (ADR 0010) — the same page from Domains or from a client.
        path: 'domains/:domainId',
        loadComponent: () => import('./features/domains/domain-detail/domain-detail.component').then((m) => m.DomainDetailComponent),
      },
      {
        // The client hub: a directory of every client, and one binder per
        // client (overview, projects, website, media, billing, contacts,
        // notes). A client can own several projects; each project still
        // opens its own workspace under /projects/:projectId below.
        path: 'clients',
        loadComponent: () => import('./features/clients/clients-list/clients-list.component').then((m) => m.ClientsListComponent),
      },
      {
        path: 'clients/:clientId',
        loadComponent: () => import('./features/clients/client-shell/client-shell.component').then((m) => m.ClientShellComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          { path: 'overview', loadComponent: () => import('./features/clients/client-overview/client-overview.component').then((m) => m.ClientOverviewComponent) },
          { path: 'projects', loadComponent: () => import('./features/clients/client-projects/client-projects.component').then((m) => m.ClientProjectsComponent) },
          { path: 'domains', loadComponent: () => import('./features/clients/client-domains/client-domains.component').then((m) => m.ClientDomainsComponent) },
          // The tab was "Website & Hosting" before ADR 0009; old links keep working.
          { path: 'website', pathMatch: 'full', redirectTo: 'domains' },
          { path: 'media', loadComponent: () => import('./features/clients/client-media/client-media.component').then((m) => m.ClientMediaComponent) },
          { path: 'billing', loadComponent: () => import('./features/clients/client-billing/client-billing.component').then((m) => m.ClientBillingComponent) },
          { path: 'contacts', loadComponent: () => import('./features/clients/client-contacts/client-contacts.component').then((m) => m.ClientContactsComponent) },
          { path: 'notes', loadComponent: () => import('./features/clients/client-notes/client-notes.component').then((m) => m.ClientNotesComponent) },
        ],
      },
      // Projects are reached through their client now; the old list URL
      // lands on the Clients directory instead of a dead page.
      { path: 'projects', pathMatch: 'full', redirectTo: 'clients' },
      {
        // One selected business/project's workspace. Each child tab is a
        // reusable feature component (also used by no other route) that
        // reads :projectId from this shell's route — never a separate
        // global page — so the exact same component/service pair renders
        // "Projects > J&J Building > Tasks" and "Projects > Ksserrts >
        // Tasks" with completely separate data, scoped server-side by
        // projectId.
        path: 'projects/:projectId',
        loadComponent: () => import('./features/projects/project-shell/project-shell.component').then((m) => m.ProjectShellComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          {
            path: 'overview',
            loadComponent: () => import('./features/projects/project-overview/project-overview.component').then((m) => m.ProjectOverviewComponent),
          },
          {
            path: 'messages',
            loadComponent: () => import('./features/messaging/messaging.component').then((m) => m.MessagingComponent),
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/tasks/tasks.component').then((m) => m.TasksComponent),
          },
          {
            path: 'media',
            loadComponent: () => import('./features/media/media.component').then((m) => m.MediaComponent),
          },
          {
            path: 'meetings',
            loadComponent: () => import('./features/meetings/meeting-calendar.component').then((m) => m.MeetingCalendarComponent),
          },
          {
            path: 'requests',
            loadComponent: () => import('./features/requests/requests.component').then((m) => m.RequestsComponent),
          },
          {
            path: 'settings',
            loadComponent: () => import('./features/projects/project-settings/project-settings.component').then((m) => m.ProjectSettingsComponent),
          },
        ],
      },
      {
        path: 'outreach',
        loadComponent: () => import('./features/sales/outreach/outreach-page.component').then((m) => m.OutreachPageComponent),
      },
      {
        // Settings (ADR 0012): one section per task, each with its own save.
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'account' },
          {
            path: 'account',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () => import('./features/settings/sections/account-settings.component').then((m) => m.AccountSettingsComponent),
          },
          {
            path: 'workspace',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () => import('./features/settings/sections/workspace-settings.component').then((m) => m.WorkspaceSettingsComponent),
          },
          {
            path: 'sales-kit',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () => import('./features/settings/sections/sales-kit-settings.component').then((m) => m.SalesKitSettingsComponent),
          },
          { path: 'team', loadComponent: () => import('./features/settings/sections/team-settings.component').then((m) => m.TeamSettingsComponent) },
          {
            path: 'sales',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () => import('./features/settings/sections/sales-preferences.component').then((m) => m.SalesPreferencesComponent),
          },
          { path: 'integrations', loadComponent: () => import('./features/settings/sections/integrations-settings.component').then((m) => m.IntegrationsSettingsComponent) },
          {
            path: 'notifications',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () => import('./features/settings/sections/notification-settings.component').then((m) => m.NotificationSettingsComponent),
          },
          { path: '**', redirectTo: 'account' },
        ],
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
