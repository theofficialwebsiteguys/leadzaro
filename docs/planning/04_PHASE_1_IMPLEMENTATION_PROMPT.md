# Claude Code Phase 1 Prompt — Platform Foundation and Safe Migration

Execute Phase 1 under the rules in `03_CLAUDE_MASTER_CONTROLLER_PROMPT.md`.

## Phase objective

Transform the current single-user Leadzaro foundation into a safe organization-scoped platform foundation for The Website Guys, while preserving the working lead search, saved leads, notes, outreach, dashboard, login, and settings behavior.

Do not build the full CRM, client project system, website builder, Stripe conversion, or deployment platform in this phase.

## Current repository evidence you must respect

The repository currently contains:

- Angular 19 standalone frontend;
- Express and Sequelize/PostgreSQL backend;
- models: `User`, `Lead`, `SavedLead`, `LeadNote`, `OutreachActivity`, `SubscriptionPlan`, `UserSubscription`;
- public registration that assigns a Free Trial;
- JWT bearer token stored in browser local storage;
- Google Places search and on-demand phone retrieval;
- user-owned saved leads, notes, outreach, and subscription;
- `sequelize.sync({ alter: true })` in non-production;
- no explicit migrations;
- almost no tests;
- a public SaaS landing page that no longer matches the primary Website Guys product direction.

Preserve useful existing behavior through compatibility services and backfills.

## Required Phase 1 outcomes

### A. Repository and secret sanitation

1. Update `.gitignore` to cover at minimum:
   - `.env` and environment variants except approved examples;
   - `.claude/settings.local.json`;
   - `node_modules`;
   - `dist`;
   - `.angular`;
   - logs, coverage, temporary exports, local certificates, and editor-local files.
2. Sanitize `.env.example` so every credential is an obvious placeholder.
3. Add startup configuration validation that fails clearly in production when required values are missing or unsafe.
4. Never print secret values.
5. Document that credentials previously included in shared ZIPs must be rotated.
6. Establish a clean baseline/checkpoint before domain changes.

### B. Explicit migrations

1. Add a supported migration and seeding workflow compatible with the current CommonJS Sequelize project.
2. Add scripts for:
   - migrate;
   - migrate status;
   - rollback;
   - seed baseline roles/permissions/organization;
   - test database setup.
3. Remove reliance on `sequelize.sync({ alter: true })` for normal development and production startup.
4. A disposable-test-only schema initialization path is acceptable.
5. Test migrations against:
   - an empty database;
   - a representative legacy database containing current users, saved leads, notes, outreach, plans, and subscriptions.

### C. Organization foundation

Create the minimum production-quality models and migrations for:

- `Organization`
- `OrganizationMembership`
- `Role`
- `Permission`
- `RolePermission`
- `MembershipRole`
- `MembershipPermissionOverride`
- `Invitation`
- `AuthSession`
- `AuditLog`
- `Notification`
- `NotificationPreference`

Recommended organization fields:

- UUID id
- name
- slug
- type (`agency`, `client`, `prospect` or a similarly extensible validated approach)
- lifecycle/status
- primary/branding metadata as needed
- created/updated/archive/delete metadata

Recommended membership fields:

- organizationId
- userId
- status
- membership type (`employee`, `client`)
- title/display metadata
- invited/accepted timestamps
- created/updated/archive metadata

Do not hard-code authorization to organization type alone.

### D. Seed The Website Guys and predefined roles

Seed one organization for The Website Guys.

Seed employee roles:

- Administrator
- Sales Representative
- Sales Manager
- Project Manager
- Designer
- Advanced Designer
- Developer
- Support
- Billing

Seed client roles:

- Client Owner
- Project Contact
- Marketing
- Billing Contact
- Content Editor
- Viewer

Seed a practical Phase 1 permission catalog including current lead/search/settings behavior and future-safe names.

### E. Legacy-user backfill

For every current User:

1. create or reuse a Website Guys membership;
2. map legacy `admin` to Administrator;
3. map legacy normal users to Sales Representative by default;
4. preserve `salespersonType`, company name, target industry, and service area as legacy/profile metadata;
5. preserve login and password hashes;
6. keep legacy `User.role` temporarily only as a compatibility field, mark it deprecated, and stop using it as the source of authority.

The migration must be repeatable/idempotent or safely detect prior completion.

### F. Organization-scope existing data without a big-bang CRM rewrite

During Phase 1, keep the current `Lead` model as canonical business/search data.

Add organization scope and backfill to the current operational records:

- `SavedLead`
- `LeadNote`
- `OutreachActivity`
- `UserSubscription` or a clearly documented temporary billing association

Rules:

1. Existing records inherit the organization of their owning user.
2. Existing routes continue to work for the user’s active organization.
3. Saved lead uniqueness becomes organization-aware rather than only user-aware.
4. Notes and outreach may preserve authorUserId while ownership belongs to the organization.
5. Add appropriate foreign keys and indexes.
6. Do not yet normalize all leads into organizations/locations/opportunities; that is Phase 2.
7. Preserve legacy IDs and traceability.

### G. Active organization context

Implement a centralized current-context mechanism.

For now, most users will have one Website Guys membership, but the architecture must support client memberships later.

Backend requirements:

- resolve authenticated user;
- resolve requested/default active organization;
- verify membership is active;
- attach a typed/request context;
- reject cross-organization access;
- never trust an arbitrary organization ID from the client without membership verification.

Frontend requirements:

- current user signal/store;
- memberships and active organization context;
- permission helper/directive/service;
- future-ready organization switcher shell, even if hidden when only one membership exists;
- restore active context safely after refresh.

### H. Multiple roles and permission overrides

Implement backend authorization with:

- multiple roles per membership;
- additive role permissions;
- explicit individual grants;
- explicit individual restrictions taking precedence;
- organization scope;
- room for later project/client assignments.

Create authorization middleware/helpers such as:

```text
requirePermission('leads.search')
requireAnyPermission([...])
requireOrganizationAccess()
```

Apply permissions to every existing protected endpoint.

At minimum, include permissions for:

- dashboard view;
- lead search;
- lead contact reveal;
- lead save/read/update/archive/merge placeholder;
- note create/read;
- outreach create/read/archive;
- profile/settings;
- membership/role administration;
- invitations;
- audit view;
- notification view/update.

### I. Invitation-only account onboarding

Replace unrestricted public account creation as the primary behavior.

Required behavior:

- administrators can invite an employee or client user by email;
- invitation has organization, membership type, intended roles, token hash, expiry, status, inviter, and audit trail;
- new users accept an invite and create a password;
- existing users can accept an additional membership;
- invitation tokens are one-time and expire;
- resend/revoke invitation actions are authorized and audited;
- public `/register` is disabled, redirected, or available only behind an explicit legacy SaaS feature flag;
- do not automatically create a Free Trial for invited Website Guys employees or clients.

Create a professional Angular invitation-acceptance flow.

A minimal employee/member administration UI is in scope so Phase 1 can be verified end to end.

### J. Revocable sessions and authentication hardening

Implement session/device management without 2FA.

Required behavior:

- create an `AuthSession` on login/invite acceptance;
- allow logout of current session;
- allow user to view and revoke their sessions;
- allow authorized administrator to revoke another user’s sessions;
- record last seen, created time, expiry, revocation, basic device/user-agent metadata, and IP only if handled according to privacy/security standards;
- use secure HttpOnly cookie-based refresh/session continuity where compatible with the existing frontend/API deployment;
- support a temporary legacy bearer-token migration path only if necessary;
- remove long-lived privileged token persistence from browser local storage by the end of Phase 1;
- do not log raw tokens;
- implement password reset and email-verification token models/services if they can be completed cleanly in this phase; otherwise establish the secure token service and document the exact next slice. Invitation acceptance is mandatory.

### K. View as Client/impersonation foundation

Implement administrator-only impersonation foundation with:

- explicit reason required;
- banner/context returned to frontend;
- audit start/end;
- easy exit;
- no password change;
- no agreement acceptance;
- no transfer/ownership change;
- no permanent deletion;
- no exposure of full payment details.

Because full client workspaces arrive later, Phase 1 may demonstrate this using a seeded/test client organization and member or through a constrained “view as member” context. Do not build fake project UI solely for this test.

### L. Audit history

Create a reusable audit service.

Audit at minimum:

- login/logout/session revocation;
- invite create/resend/revoke/accept;
- membership creation/status change;
- role assignment/removal;
- permission override;
- profile/password change;
- saved lead create/update/archive/restore;
- note creation;
- outreach creation/archive;
- impersonation start/end;
- destructive/restore actions.

Audit entries should record actor, organization, action, target type/id, safe metadata diff, timestamp, and request correlation information. Never store secrets or full passwords/tokens.

### M. Soft deletion and archive behavior

Replace permanent deletion in current lead/outreach workflows with archive/soft-delete behavior where appropriate.

- Employees can archive and restore when permitted.
- Administrator-only permanent deletion infrastructure may exist but does not need broad UI.
- Audit every archive, restore, and permanent delete.
- Preserve current user experience with clearer wording.

### N. Notification foundation

Implement the reusable notification foundation, not every future event.

Required:

- in-app notification records;
- unread count;
- mark read/unread;
- notification preferences for immediate/daily/weekly/muted categories;
- role/organization targeting capability;
- email adapter interface with a development/no-provider mode;
- notifications for invitations, role changes, session revocation, and important lead assignment/change events where applicable;
- frontend notification center/shell indicator.

### O. Frontend shell and navigation

Evolve the current dashboard layout into a permission-aware Website Guys operating shell.

Requirements:

- maintain current dashboard/search/saved leads/outreach/settings routes;
- navigation items are filtered by permission;
- public registration and subscription marketing are no longer the default internal experience;
- preserve mobile usability;
- add organization/user context and notifications;
- add an Administration area for members, invitations, roles/overrides, sessions, and audit when authorized;
- use consistent loading, empty, error, and success states;
- avoid raw `any` casts when domain types are practical.

Do not build future empty tabs for CRM, projects, builder, or deployments yet. It is acceptable to show disabled roadmap navigation only if clearly marked and not confusing.

### P. Compatibility and API versioning

- Keep current `/api/...` routes operational during migration where practical.
- Introduce a consistent versioned convention for new foundation endpoints, such as `/api/v1/...`.
- Legacy route handlers should delegate to organization-aware domain services.
- Document deprecations.
- Do not break the current Angular pages while introducing new services.

### Q. Tests

Add a real test foundation.

Required test categories:

1. migrations on empty database;
2. migrations/backfill on representative legacy data;
3. migration rollback where safe;
4. existing user login after migration;
5. invite acceptance for new user;
6. invite acceptance for existing user/additional membership;
7. multiple roles combine permissions;
8. explicit deny overrides role grant;
9. organization isolation for saved leads, notes, outreach, membership, audit, notifications;
10. admin versus non-admin membership management;
11. session revoke behavior;
12. impersonation restrictions;
13. soft delete and restore;
14. existing lead search/save/detail/outreach dashboard regression;
15. frontend permission navigation and invitation flow tests.

Use the lightest suitable test stack compatible with the repository. Add API integration tests against a disposable PostgreSQL database rather than mocking every Sequelize call.

### R. Documentation

Replace the generated README with real setup documentation or create a complete repository README covering:

- prerequisites;
- environment setup;
- clean dependency install;
- PostgreSQL/Docker Compose;
- migration and seed commands;
- frontend/backend run commands;
- test commands;
- Google Places configuration;
- organization/role concepts;
- invitation flow;
- secret handling;
- current architecture;
- known deferred modules.

Create architecture decision records for:

- modular monolith;
- organization membership and multiple roles;
- auth/session approach;
- migration strategy;
- compatibility route strategy.

## Phase 1 non-goals

Do not implement:

- normalized prospect organizations, contacts, opportunities, campaigns, territories, or full CRM pipeline;
- public inbound landing forms connected to CRM;
- Stripe Payment Links/webhooks/client conversion;
- projects/tasks/client requests/messaging;
- Google Cloud Storage file workflows;
- website builder;
- GitHub repositories/previews;
- cPanel/Namecheap deployment;
- analytics or SEO dashboards;
- AI features.

Foundation interfaces are allowed only where they directly support Phase 1.

## Phase 1 acceptance criteria

Phase 1 is complete only when all are true:

1. No tracked secret or local-only artifact remains.
2. Current application code has a safe baseline/checkpoint.
3. Clean installation and production frontend build pass on the development platform.
4. Backend tests and syntax/lint checks pass.
5. Explicit migrations replace runtime alter-sync.
6. Empty and legacy database migration tests pass.
7. Existing users can log in after migration.
8. Existing saved leads, notes, outreach, dashboard data, and subscriptions remain linked and accessible within the correct organization.
9. Existing users are members of The Website Guys organization.
10. Multiple roles and permission overrides work and are enforced on the backend.
11. A non-member cannot access another organization by changing an ID/header/URL.
12. Public account registration is no longer the default; invitation acceptance works.
13. Revocable sessions work and long-lived privileged tokens are no longer stored in local storage.
14. Administrator member/invitation/session/audit controls work through the UI.
15. Current lead search, phone reveal, save, detail, notes, outreach, dashboard, and settings workflows pass regression tests.
16. Archive/restore replaces normal permanent deletion.
17. Audit records exist for all required actions.
18. Notification center and core notification behavior work.
19. Mobile navigation remains usable.
20. No unresolved Critical or High review finding remains.

## Required review focus

During the two post-implementation review passes, pay special attention to:

- accidental cross-organization data access;
- legacy endpoints that bypass new permissions;
- migration data loss or duplicate memberships;
- invitation token leakage;
- refresh/session token storage;
- impersonation privilege escalation;
- stale local-storage auth behavior;
- frontend routes visible but unauthorized;
- audit metadata containing secrets;
- hard deletes that bypass archive rules;
- current Leadzaro workflows broken by refactoring.

## Completion output

Complete `05_PHASE_COMPLETION_REPORT_TEMPLATE.md` as `docs/leadzaro/phase-1-completion-report.md`.

Also create `docs/leadzaro/NEXT_PHASE_PROMPT.md` tailored to the actual resulting repository for Phase 2.

Do not declare Phase 1 complete until the master controller completion gates and every acceptance criterion above pass.
