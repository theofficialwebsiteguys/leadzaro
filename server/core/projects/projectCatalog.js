'use strict';

/**
 * Single source of truth for Project stages (Phase 4), mirroring
 * server/core/crm/pipelineCatalog.js's pattern: a validated reference
 * list, not a DataTypes.ENUM, so a future workflow-configuration change
 * doesn't require a schema migration. Exact order per master
 * architecture § 7's "Project lifecycle."
 */
const STAGES = [
  'Client Onboarding',
  'Content Collection',
  'Design',
  'Client Review',
  'Development',
  'QA',
  'Client Approval',
  'Launch',
  'Ongoing Support',
];

/**
 * Soft-gate checklist per stage (architecture § 10: "Transitions use
 * soft gates. The interface warns about missing items, but authorized
 * users may proceed with an override reason. Launch has the strongest
 * checklist.") These are advisory prompts shown to whoever is changing
 * the stage — nothing here is mechanically verified against other
 * tables yet (Phase 4 has no content/design/deployment tracking to
 * check against); the checklist exists so the UI has something concrete
 * to warn about, and so every transition is auditable against a stated
 * standard rather than an arbitrary click.
 */
const STAGE_CHECKLISTS = {
  'Client Onboarding': ['Kickoff meeting scheduled', 'Primary client contact confirmed'],
  'Content Collection': ['Content request sent to client', 'Brand assets received'],
  Design: ['Wireframes approved internally'],
  'Client Review': ['Design shared with client for feedback'],
  Development: ['Design approved by client'],
  QA: ['Development complete', 'Internal QA pass complete'],
  'Client Approval': ['QA sign-off recorded'],
  Launch: [
    'Client has formally approved the site',
    'Domain and hosting confirmed',
    'Backup of prior state taken (if replacing an existing site)',
    'Post-launch support plan confirmed with client',
  ],
  'Ongoing Support': ['Launch checklist fully complete'],
};

/**
 * Default channels seeded for every Project (architecture § 11): the 7
 * named collaboration channels, all `visibility: 'client'` (both the
 * agency and the client organization participate), plus one additional
 * employee-only channel — "employees also have client-hidden project
 * channels and notes." Shared by both the one-time backfill migrations
 * and `projectService.ensureProjectForConversion` (the ongoing hook for
 * every conversion from here forward), so the default set is defined
 * exactly once.
 */
const CHANNEL_DEFAULTS = [
  { key: 'general', name: 'General Project', visibility: 'client' },
  { key: 'content', name: 'Content and Assets', visibility: 'client' },
  { key: 'design', name: 'Design Feedback', visibility: 'client' },
  { key: 'dev', name: 'Development Questions', visibility: 'client' },
  { key: 'billing', name: 'Billing', visibility: 'client' },
  { key: 'launch', name: 'Launch and Domains', visibility: 'client' },
  { key: 'support', name: 'Ongoing Support', visibility: 'client' },
  { key: 'internal', name: 'Internal Notes', visibility: 'internal' },
];

module.exports = {
  STAGES, STAGE_CHECKLISTS, CHANNEL_DEFAULTS,
};
