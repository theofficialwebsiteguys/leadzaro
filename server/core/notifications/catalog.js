'use strict';

/**
 * The notification events a person can control (ADR 0012). Each entry maps
 * to one or more `type` values passed to notify(); only events Leadzaro
 * actually sends are listed, and only to people whose permissions make
 * them relevant. Renewal and follow-up reminders are in-app only.
 */
const CATEGORIES = [
  {
    key: 'lead_assignment', group: 'Sales', label: 'A lead is assigned to me', types: ['lead_assignment'], permission: 'leads.read', channels: ['in_app', 'email'],
  },
  {
    key: 'sales.reply', group: 'Sales', label: 'A lead replies by text', types: ['sales.reply'], permission: 'outreach.read', channels: ['in_app', 'email'],
  },
  {
    key: 'sales.payment_received', group: 'Sales', label: 'A payment arrives and the handoff needs finishing', types: ['sales.payment_received'], permission: 'leads.read', channels: ['in_app', 'email'],
  },
  {
    key: 'follow_up_due', group: 'Sales', label: 'Morning reminder when my follow-ups are due', types: ['follow_up_due'], permission: 'leads.read', channels: ['in_app'],
  },
  {
    key: 'renewal_upcoming', group: 'Domains', label: 'Domain or hosting renewals are approaching', types: ['renewal_upcoming'], permission: 'domains.view', channels: ['in_app'],
  },
  {
    key: 'task_assigned', group: 'Client work', label: 'A task is assigned to me', types: ['task_assigned'], permission: 'tasks.manage', channels: ['in_app', 'email'],
  },
  {
    key: 'message_mention', group: 'Client work', label: 'Someone mentions me in a project message', types: ['message_mention'], permission: 'projects.view', channels: ['in_app', 'email'],
  },
  {
    key: 'client_request_submitted', group: 'Client work', label: 'A client request is submitted', types: ['client_request_submitted'], permission: 'requests.manage', channels: ['in_app', 'email'],
  },
  {
    key: 'meeting_requested', group: 'Client work', label: 'A meeting is requested', types: ['meeting_requested'], permission: 'meetings.manage', channels: ['in_app', 'email'],
  },
  {
    key: 'meeting_updates', group: 'Client work', label: 'A meeting I requested is confirmed or declined', types: ['meeting_confirmed', 'meeting_declined'], permission: 'meetings.request', channels: ['in_app', 'email'],
  },
  {
    key: 'role_change', group: 'Account', label: 'My access in the workspace changes', types: ['role_change'], permission: null, channels: ['in_app', 'email'],
  },
];

const KNOWN_TYPES = new Set(CATEGORIES.flatMap((c) => c.types));

function categoriesFor(permissionKeys) {
  return CATEGORIES.filter((c) => !c.permission || permissionKeys.has(c.permission));
}

module.exports = { CATEGORIES, KNOWN_TYPES, categoriesFor };
