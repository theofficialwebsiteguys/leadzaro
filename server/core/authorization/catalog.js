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
  { key: 'project_manager', name: 'Project Manager', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS] },
  { key: 'designer', name: 'Designer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS] },
  { key: 'advanced_designer', name: 'Advanced Designer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS] },
  { key: 'developer', name: 'Developer', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS] },
  { key: 'support', name: 'Support', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS] },
  { key: 'billing', name: 'Billing', permissions: [...PLACEHOLDER_EMPLOYEE_PERMISSIONS, 'billing.manage_webhooks', 'billing.manage_service_plans'] },
].map((role) => ({
  ...role,
  scope: 'employee',
  permissions: Array.from(new Set([...role.permissions, ...BASE_SELF_SERVICE_PERMISSIONS])),
}));

// Client roles have no module to grant permissions over yet (client portal
// arrives in Phase 4); Phase 1 only needs them to exist so a seeded test
// client organization/member can demonstrate the impersonation foundation.
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
  permissions: [...BASE_SELF_SERVICE_PERMISSIONS],
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
