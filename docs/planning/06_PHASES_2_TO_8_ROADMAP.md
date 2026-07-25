# Leadzaro Phases 2–8 Roadmap

This roadmap defines scope boundaries. Each future phase must receive a repository-specific prompt generated from the actual completion state of the prior phase.

## Phase 2 — Lead Generation, Inbound Acquisition, and CRM

### Primary outcomes

- temporary discovered search results;
- saved search campaigns, private/shared;
- prospect organizations and multiple locations;
- contacts;
- opportunities;
- default pipeline and configurable future pipeline architecture;
- assignments: claim, manager, round robin;
- optional territories;
- activity timeline;
- opportunity and engagement scoring;
- manual score adjustments;
- duplicate detection, merge preview, merge audit, restore/undo safety;
- website audits and shareable audit report;
- manual/optional enrichment adapter;
- assisted outreach sequences;
- public Website Guys landing pages and inbound forms;
- source/UTM/ad attribution;
- sales employee dashboard and performance tracking;
- migration from `Lead`/`SavedLead` compatibility records.

### Major gate

Current Google search, saved leads, notes, outreach, and dashboards must transition without data loss or duplicate prospect records.

## Phase 3 — Stripe Billing and Client Conversion

### Primary outcomes

- internal service and plan catalog;
- configurable subscription plans;
- add-ons/entitlements;
- Stripe products/prices mapping;
- employee-generated Payment Links;
- idempotent Stripe webhook processing;
- webhook event ledger;
- opportunity payment states;
- automatic and manual client conversion;
- organization transition from prospect to client;
- client billing account;
- Stripe customer portal link;
- subscription synchronization;
- failed payment states;
- project creation from template;
- invitation of primary client user;
- conversion-needs-attention workflow.

### Major gate

The same Stripe event must never create duplicate clients, projects, subscriptions, or invitations.

## Phase 4 — Agency Operations and Website Guys Client Portal

### Primary outcomes

- projects, templates, stages, soft gates, launch checklist;
- project owner and multi-role assignments;
- tasks/subtasks, board/list/calendar/timeline;
- workload and time tracking;
- client-visible milestones/tasks;
- client requests and unified support queue;
- role-based project channels and internal notes;
- meeting request/confirmation and Google Calendar adapter;
- organization/project files using Google Cloud Storage;
- content requests and free-form content inbox;
- client dashboard with last-worked context;
- ongoing support after launch;
- cancellation request workflow;
- audit and notifications across operations.

### Major gate

Client users must never see internal notes, financial margins, unrelated projects, or other client data.

## Phase 5 — Website Builder Foundation

### Primary outcomes

- versioned website schema;
- design systems/tokens;
- website/page/navigation management;
- reusable section/component library;
- Basic, Professional, and Advanced editing permissions;
- responsive automatic behavior with breakpoint overrides;
- template, page-kit, guided, and blank starts;
- asset manager and no-extra-service image optimization;
- organization/global/page content scopes;
- client content permissions and review rules;
- client-editable form builder;
- section-level locks and presence;
- autosave, versions, named checkpoints, compare, restore;
- visual feedback anchored to versions/components;
- template/page/section/design-system library governance.

### Major gate

The schema, preview renderer, and version history must be stable before Angular code generation is introduced.

## Phase 6 — Angular Generation and Developer Workflow

### Primary outcomes

- developer-quality Angular generation;
- generated/custom code boundaries;
- repository creation when design begins;
- GitHub adapter;
- branches and preview workflow;
- GitHub Pages automatic previews;
- promote-to-development checkpoint/handoff;
- managed, extended, registered, and detached component states;
- custom component editor schemas;
- component publication permission/review;
- design version ↔ commit ↔ deployment linkage;
- developer merge-back workflow;
- protection against overwriting custom code.

### Major gate

A designer edit must never overwrite developer-owned custom functionality, and a registered developer component must remain usable in the builder.

## Phase 7 — Production Website Operations

### Primary outcomes

- Namecheap domain records and ownership metadata;
- cPanel shared-hosting adapter;
- document-root mapping;
- production build and manual deploy;
- backup, health check, rollback;
- deployment logs and history;
- shared website-services API;
- form submissions and routing;
- spam protection;
- hybrid analytics events;
- Google Analytics guided connection;
- domain renewal tracking;
- cancellation export and domain transfer workflow;
- employee-controlled full website export.

### Major gate

A failed or unhealthy production deployment must restore the prior live build without losing the domain, configuration, or form functionality.

## Phase 8 — Premium SEO and Advanced Services

### Primary outcomes

- entitlement-gated SEO dashboard;
- manual add-on activation with reason/expiration/audit;
- Google Search Console connection;
- page metadata, canonical, sitemap, robots, redirects, schema controls;
- technical audits;
- heading, alt text, broken-link, performance checks;
- recurring SEO project/tasks;
- client reports and activity summaries;
- later keyword/location/competitor/content-plan workspace;
- owner executive reporting;
- optional AI provider interface and cost controls.

### Major gate

SEO access and recurring work must be unavailable without the proper entitlement while the base website remains fully functional.

## Cross-phase regression suite

Every phase after Phase 1 must continue validating:

- authentication and sessions;
- organization isolation;
- multiple roles and overrides;
- invitations;
- lead search and canonical business matching;
- saved data/history;
- audit and notifications;
- mobile shell/navigation;
- migration integrity;
- no secret leakage.
