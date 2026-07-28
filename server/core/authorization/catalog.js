'use strict';

/**
 * Single source of truth for the Phase 1 permission/role catalog.
 * Consumed by the seed/backfill migration (to populate Role/Permission/
 * RolePermission rows) and by the authorization middleware (permission
 * keys referenced by `requirePermission`). Roles/permissions live as
 * validated reference-table rows rather than enums so future phases can
 * extend the catalog without a schema/enum migration.
 */

const PERMISSIONS = [
  { key: 'dashboard.view', category: 'dashboard', description: 'View the sales dashboard' },
  { key: 'leads.search', category: 'leads', description: 'Search Google Places for new leads' },
  { key: 'leads.contact_reveal', category: 'leads', description: 'Reveal a lead\'s phone/contact details' },
  { key: 'leads.save', category: 'leads', description: 'Save a lead into the organization pipeline' },
  { key: 'leads.read', category: 'leads', description: 'View saved lead details' },
  { key: 'leads.update', category: 'leads', description: 'Update a saved lead (status, priority, follow-up)' },
  { key: 'leads.archive', category: 'leads', description: 'Archive/restore a saved lead' },
  { key: 'leads.merge', category: 'leads', description: 'Merge duplicate lead records (reserved for Phase 2)' },
  { key: 'notes.create', category: 'notes', description: 'Add a note to a lead' },
  { key: 'notes.read', category: 'notes', description: 'View notes on a lead' },
  { key: 'outreach.create', category: 'outreach', description: 'Log an outreach activity' },
  { key: 'outreach.read', category: 'outreach', description: 'View outreach activity history' },
  { key: 'outreach.archive', category: 'outreach', description: 'Archive/restore an outreach activity' },
  { key: 'profile.manage', category: 'account', description: 'Manage own profile and password' },
  { key: 'notifications.view', category: 'account', description: 'View own notifications' },
  { key: 'notifications.manage', category: 'account', description: 'Manage own notification preferences' },
  { key: 'sessions.manage', category: 'account', description: 'View and revoke own sessions' },
  { key: 'memberships.manage', category: 'admin', description: 'Manage organization memberships and role assignments' },
  { key: 'roles.manage', category: 'admin', description: 'Manage individual permission grants/restrictions' },
  { key: 'invitations.manage', category: 'admin', description: 'Create, resend, and revoke invitations' },
  { key: 'audit.view', category: 'admin', description: 'View the organization audit log' },
  { key: 'sessions.manage_others', category: 'admin', description: 'Revoke another user\'s sessions' },
  { key: 'impersonation.use', category: 'admin', description: 'View the app as another member (impersonation)' },
  { key: 'billing.manage_webhooks', category: 'billing', description: 'View and manually reprocess failed Stripe webhook events' },
  { key: 'billing.manage_service_plans', category: 'billing', description: 'Manage the internal service/plan catalog and its Stripe product/price mapping' },
  { key: 'projects.view', category: 'projects', description: "View one's own client organization's project" },
  { key: 'projects.manage', category: 'projects', description: 'Manage project assignments and settings' },
  { key: 'projects.change_stage', category: 'projects', description: 'Change a project\'s stage, including overriding an incomplete soft-gate checklist' },
  { key: 'tasks.manage', category: 'projects', description: 'Create, update, and log time against project tasks' },
  { key: 'messages.post', category: 'projects', description: 'Post messages in a project channel visible to the requester' },
  { key: 'requests.create', category: 'projects', description: 'Submit a client request or content inbox item' },
  { key: 'requests.manage', category: 'projects', description: 'Triage, update, and convert client requests (the unified support queue)' },
  { key: 'meetings.request', category: 'projects', description: 'Request a project meeting' },
  { key: 'meetings.manage', category: 'projects', description: 'Confirm, decline, and cancel project meetings' },
  { key: 'files.upload', category: 'projects', description: 'Upload a file to a project' },
  { key: 'files.manage', category: 'projects', description: 'Delete project files' },
  { key: 'cancellations.request', category: 'projects', description: 'Request cancellation of a project engagement' },
  { key: 'cancellations.manage', category: 'projects', description: 'Confirm or withdraw a project cancellation request' },
  { key: 'builder.edit', category: 'builder', description: 'Edit a project\'s website in the builder' },
  { key: 'builder.publish', category: 'builder', description: 'Approve and publish a pending website version' },
  { key: 'builder.manage', category: 'builder', description: 'Manage website editor assignments and the section/design-system library' },
  { key: 'builder.develop', category: 'builder', description: 'Trigger Angular code generation, merge developer branches back, and register custom components' },
  { key: 'seo.manage_entitlements', category: 'seo', description: 'Manually grant or revoke a client organization\'s SEO add-on entitlement' },
];

const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

// Granted to every employee and client role automatically — these are
// self-service permissions over one's own account, not admin capability.
const BASE_SELF_SERVICE_PERMISSIONS = [
  'profile.manage',
  'notifications.view',
  'notifications.manage',
  'sessions.manage',
];

const SALES_PERMISSIONS = [
  'dashboard.view',
  'leads.search',
  'leads.contact_reveal',
  'leads.save',
  'leads.read',
  'leads.update',
  'leads.archive',
  'notes.create',
  'notes.read',
  'outreach.create',
  'outreach.read',
  'outreach.archive',
];

const ADMIN_ONLY_PERMISSIONS = [
  'memberships.manage',
  'roles.manage',
  'invitations.manage',
  'audit.view',
  'sessions.manage_others',
  'impersonation.use',
];

// Employee roles not yet backed by a real module (Designer, Developer, etc.)
// intentionally get only the base self-service set in Phase 1 — their
// distinguishing permissions arrive with the modules that need them
// (Phase 4 projects, Phase 5 builder, Phase 6 source control, ...).
const PLACEHOLDER_EMPLOYEE_PERMISSIONS = ['dashboard.view'];

const EMPLOYEE_ROLES = [
  {
    key: 'administrator',
    name: 'Administrator',
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: 'sales_representative',
    name: 'Sales Representative',
    permissions: [...SALES_PERMISSIONS],
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    permissions: [...SALES_PERMISSIONS, 'leads.merge', 'audit.view'],
  },
  { key: 'project_manager', name: 'Project Manager', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'projects.manage', 'projects.change_stage', 'tasks.manage', 'requests.manage', 'meetings.manage', 'files.manage', 'cancellations.request', 'cancellations.manage', 'builder.publish', 'builder.manage'] },
  { key: 'designer', name: 'Designer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'tasks.manage', 'requests.manage', 'meetings.manage', 'files.manage', 'builder.edit'] },
  { key: 'advanced_designer', name: 'Advanced Designer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'tasks.manage', 'requests.manage', 'meetings.manage', 'files.manage', 'builder.edit', 'builder.publish', 'builder.develop'] },
  { key: 'developer', name: 'Developer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'tasks.manage', 'requests.manage', 'meetings.manage', 'files.manage', 'builder.edit', 'builder.publish', 'builder.develop'] },
  { key: 'support', name: 'Support', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'tasks.manage', 'requests.manage', 'meetings.manage', 'files.manage'] },
  { key: 'billing', name: 'Billing', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'billing.manage_webhooks', 'billing.manage_service_plans', 'seo.manage_entitlements'] },
].map((role) => ({
  ...role,
  scope: 'employee',
  // projects.view/messages.post are granted to every employee role
  // uniformly (§ 2d: "any active employee membership at the owning
  // agency can read a project's internal content") — narrower controls
  // (projects.manage, projects.change_stage, tasks.manage) are the
  // roles that actually differ.
  permissions: Array.from(new Set([...role.permissions, ...BASE_SELF_SERVICE_PERMISSIONS, 'projects.view', 'messages.post', 'meetings.request', 'files.upload'])),
}));

// Client roles existed since Phase 1 with no module to grant permissions
// over; Phase 4 (the client portal) is that first real module — every
// client role gets projects.view uniformly for now, matching how they
// already uniformly get BASE_SELF_SERVICE_PERMISSIONS. messages.post is
// withheld from `viewer` specifically — the one finer-grained
// distinction Phase 4 actually has a concrete need for: a role named
// "Viewer" should not be able to post into a project's channels.
//
// builder.edit (Phase 5, current-phase-plan.md § 2g) is withheld from
// `project_contact`/`billing_contact` too, not just `viewer` — editing
// a live client website is a materially bigger action than posting a
// message or submitting a request, so it's deliberately narrower than
// every other client-side "create/act" permission here.
const BUILDER_EDIT_CLIENT_ROLE_KEYS = new Set(['client_owner', 'marketing', 'content_editor']);

const CLIENT_ROLES = [
  { key: 'client_owner', name: 'Client Owner' },
  { key: 'project_contact', name: 'Project Contact' },
  { key: 'marketing', name: 'Marketing' },
  { key: 'billing_contact', name: 'Billing Contact' },
  { key: 'content_editor', name: 'Content Editor' },
  { key: 'viewer', name: 'Viewer' },
].map((role) => ({
  ...role,
  scope: 'client',
  permissions: role.key === 'viewer'
    ? [...BASE_SELF_SERVICE_PERMISSIONS, 'projects.view']
    : [
      ...BASE_SELF_SERVICE_PERMISSIONS, 'projects.view', 'messages.post', 'requests.create', 'meetings.request', 'files.upload', 'cancellations.request',
      ...(BUILDER_EDIT_CLIENT_ROLE_KEYS.has(role.key) ? ['builder.edit'] : []),
    ],
}));

const ALL_ROLES = [...EMPLOYEE_ROLES, ...CLIENT_ROLES];

const DEFAULT_EMPLOYEE_ROLE_KEY = 'sales_representative';
const ADMINISTRATOR_ROLE_KEY = 'administrator';

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  EMPLOYEE_ROLES,
  CLIENT_ROLES,
  ALL_ROLES,
  ADMIN_ONLY_PERMISSIONS,
  DEFAULT_EMPLOYEE_ROLE_KEY,
  ADMINISTRATOR_ROLE_KEY,
};
