# Phase 1 Implementation Plan — Platform Foundation and Safe Migration

## 1. Repository evidence audit

### Stack confirmed
- Angular 19.2 standalone frontend, Express 4 + Sequelize 6 + PostgreSQL backend, shared root `package.json`.
- Node v24.11.1, npm 11.6.2, Docker 29.3.1 with Compose available locally.
- `docker-compose.yml` provides a disposable local Postgres (`leadzaro_db`, db `leadzaro`, user `leadzaro_user`).

### Secrets / sanitation
- `.env` exists locally and is already git-ignored (`git check-ignore` confirms); it has never been committed (`git log --all -- .env` is empty).
- `.env.example` already contains placeholders only (no real credentials found).
- `.claude/settings.local.json` is currently **untracked and not ignored** — must be added to `.gitignore` before any commit (local permission grants are machine-specific, not shared config). `.claude/agents/fable-phase-reviewer.md` should remain tracked (shared operating config referenced by `CLAUDE.md`).
- **Action:** still advise credential rotation in the completion report per audit item #1, since the audit indicates a ZIP containing populated `.env` was shared outside this working copy at some point; this repo's own history is clean.

### No trustworthy baseline commit
- Confirmed: `git log` shows one `initial commit` (bare Angular scaffold). Nearly everything — `server/`, `src/app/core|features|layout|shared`, `docs/`, `.claude/`, `docker-compose.yml`, `proxy.conf.json` — is untracked or modified.
- **Action:** commit the current working application as-is (sanitized `.gitignore` only) as an explicit baseline checkpoint before any Phase 1 domain change, so regressions can be diffed against real prior behavior.

### package-lock.json
- Deleted from the working tree relative to the initial commit (which only had the bare Angular lockfile). Current `package.json` already includes backend deps (express, sequelize, jsonwebtoken, bcryptjs, etc.) added after that commit.
- **Action:** run `npm install` to regenerate a lockfile that matches the current `package.json` (cannot `npm ci` — no matching lock exists yet), then commit the regenerated lockfile as part of the baseline.

### Existing backend behavior (read in full)
- `server/models`: `User` (role enum user/admin, salespersonType enum, isActive), `Lead` (canonical business, unique `googlePlaceId`), `SavedLead` (`userId`+`leadId`, status/priority enums, no DB-level unique constraint — dedupe only enforced in `savedLeadController`), `LeadNote`, `OutreachActivity`, `SubscriptionPlan`, `UserSubscription`. All user-owned, no org concept.
- `server/config/database.js` builds a raw `Sequelize` instance from env vars directly (no `config.js` for sequelize-cli). `server/server.js` calls `sequelize.sync({ alter: ... })` — must be replaced by migrations for non-test environments.
- `server/middleware/auth.js`: bearer-only `authenticate` + `requireAdmin` (single global role, no membership/permission concept).
- `server/controllers/authController.js` + `server/services/authService.js`: register/login issue a long-lived (7d) JWT; no session table, no revocation, no refresh.
- Routes are flat under `/api/...` with no versioning; all existing routes (`leads`, `savedLeads`, `outreach`, `dashboard`, `subscriptions`) filter by `req.user.id` only — no organization scoping exists anywhere.
- `leadSearchService.js` already implements sensible caching/cost-control (geocode cache, search cache, on-demand contact reveal) — preserved unchanged.
- Frontend `AuthService` persists both JWT and serialized user in `localStorage` permanently; `authGuard`/`noAuthGuard` gate on `isAuthenticated()` signal only; `authInterceptor` attaches bearer token and force-logs-out on 401. Public `/register` route is open or a `noAuthGuard`-gated marketing flow with automatic Free Trial subscription creation.
- No test infrastructure exists beyond the generated `app.component.spec.ts`.

## 2. Decisions for this phase (why, given the evidence)

1. **Migrations tool:** adopt `sequelize-cli` (`.sequelizerc` + `server/config/config.js`) rather than a bespoke runner — it is the standard reversible-migration tool for this exact stack and needs no new database driver. The existing `server/config/database.js` (used by `models/index.js` at runtime) is left as the single source of truth for the app's live connection; `config.js` mirrors the same env vars for the CLI only.
2. **Idempotent-safe baseline migration:** because a legacy dev database may already have the 7 existing tables created via `sync({alter:true})`, the first migration checks `queryInterface.showAllTables()` and only creates tables that are missing. This lets the exact same migration set run cleanly against both an empty DB and a representative legacy DB, satisfying acceptance criterion #6 without a separate "assume already synced" flag.
3. **New tables stay flat in `server/models/`** (matching the existing convention) rather than moving everything into `server/modules/*/models` immediately — avoids a big-bang restructure of working code. New *routes/controllers/services* for genuinely new domains (organizations, membership admin, invitations, sessions, audit, notifications) are added under `server/modules/<domain>/` and mounted at `/api/v1/...`, per the versioning rule in the controller prompt. Existing `/api/...` routes are kept and updated internally to call the new authorization/org-context layer rather than being replaced.
4. **Roles/permissions as validated reference tables, not enums** — per the master architecture's explicit instruction to avoid PostgreSQL enum churn for workflow-configurable concepts. `Role`/`Permission` are rows seeded by migration, not `DataTypes.ENUM`.
5. **Session model:** short-lived in-memory access token (returned in the API response body, held in an Angular signal, attached via the existing bearer interceptor) + a `HttpOnly`/`SameSite=Lax` refresh cookie backing a real `AuthSession` row (hashed token, revocable, last-seen, device metadata). A CSRF-only cookie cannot mutate state by itself since all mutating requests still require the bearer header the cookie cannot supply cross-site — this removes the long-lived privileged token from `localStorage` while keeping the frontend's existing interceptor pattern. Documented as an ADR.
6. **Backfill lives inside a migration**, not a re-runnable seeder, for the one-time legacy-user/organization-scope backfill (it must run exactly once, transactionally, against real existing rows). Pure reference-data seeding (permissions/roles/role-permissions/Website Guys org) is idempotent (`findOrCreate`) and safe to also invoke via an explicit `db:seed` script for fresh environments.
7. **SavedLead uniqueness becomes `(organizationId, leadId)`** at the DB level (added as a real unique index in the alter migration) instead of the current app-level-only `(userId, leadId)` check.
8. **Soft delete/archive** replaces hard `destroy()` for `SavedLead` and `OutreachActivity`: add `archivedAt`, `deletedAt`, `deletedByUserId`; existing `DELETE` endpoints become archive actions (audited), with a separate administrator-only permanent-delete path that does not get broad UI in this phase.
9. **Impersonation** is demonstrated using a seeded test client organization + seeded client member (not fake project UI), gated behind a new `impersonation.use` permission, fully audited, with an explicit banner/context surfaced to the frontend and an easy exit — no password change, no billing exposure, no permanent deletion while impersonating.
10. **Public registration** is disabled by default behind a `FEATURE_PUBLIC_REGISTRATION` flag (default `false`); the route/controller/service remain in place (not deleted) for the possible future external-SaaS scenario the architecture explicitly keeps open, but the Angular `/register` route is removed from primary navigation and redirects to login with an explanatory message when the flag is off.

## 3. Acceptance matrix

| # | Phase 1 requirement | Implementation location | DB impact | API impact | UI impact | Permission | Tests | Backfill | Status |
|---|---|---|---|---|---|---|---|---|---|
|1| Secret sanitation, baseline checkpoint | `.gitignore`, git history | — | — | — | — | manual verify | — | done in Step 0 |
|2| Explicit migrations replace `sync({alter})` | `server/config/config.js`, `.sequelizerc`, `server/migrations/*`, `server/server.js` | new | — | — | — | migration up/down tests | — | pending |
|3| Organization + RBAC schema | `server/migrations/*-create-org-rbac.js`, `server/models/{Organization,OrganizationMembership,Role,Permission,RolePermission,MembershipRole,MembershipPermissionOverride}.js` | new tables | new v1 routes | Admin UI | `memberships.manage`, `roles.manage` | RBAC combine/override tests | — | pending |
|4| Seed Website Guys + predefined roles/permissions | migration seed step + `server/seeders` reference | data | — | — | — | seed idempotency test | seed | pending |
|5| Legacy user backfill into Website Guys org | same migration (transactional) | data | — | — | — | legacy-db migration test | backfill | pending |
|6| Org-scope existing operational tables | alter migration on SavedLead/LeadNote/OutreachActivity/UserSubscription | altered tables + unique index | updated controllers | unchanged UX, clearer archive wording | org-scoped queries | org isolation tests | backfill | pending |
|7| Active organization context (backend + frontend) | `server/core/authorization/*`, Angular `OrganizationContextService` | — | new context resolution on every protected route | org switcher shell (hidden if 1 membership) | `requireOrganizationAccess` | cross-org access test | — | pending |
|8| Multiple roles + permission overrides enforced server-side | `server/core/authorization/authorize.js` | uses RBAC tables | `requirePermission`/`requireAnyPermission` applied to all protected routes | disabled/hidden nav by permission | full catalog | grant/deny precedence tests | — | pending |
|9| Invitation-only onboarding | `server/modules/invitations/*`, Angular invite-accept flow, `/register` gated | new `Invitation` table | `/api/v1/invitations/*` | invite-accept page, admin invite UI | `invitations.manage` | invite new-user / existing-user tests | — | pending |
|10| Revocable sessions, no privileged localStorage token | `server/modules/sessions/*`, `AuthSession` model, cookie refresh flow, Angular `AuthService` rewrite | new `AuthSession` table | `/api/v1/auth/refresh`, `/sessions` | session list/revoke UI | `sessions.manage`, `sessions.manage_others` | session revoke tests | — | pending |
|11| Impersonation foundation | `server/modules/impersonation/*` | uses AuditLog | admin-only endpoints | banner + exit control | `impersonation.use` | impersonation restriction tests | seeded client org | pending |
|12| Audit history | `server/core/audit/auditService.js`, `AuditLog` model | new table | audit view endpoint | admin Audit tab | `audit.view` | audit-recorded-on-action tests | — | pending |
|13| Soft deletion / archive | SavedLead/OutreachActivity controllers | new columns | delete endpoints become archive | wording update, restore action | existing perms | soft delete/restore tests | — | pending |
|14| Notification foundation | `server/modules/notifications/*`, `Notification`/`NotificationPreference` models, console email adapter | new tables | `/api/v1/notifications/*` | notification center + bell | `notifications.view/manage` | notification CRUD tests | — | pending |
|15| Frontend shell/navigation permission-aware | Angular layout/sidebar | — | — | filtered nav, Administration area | permission service | nav filtering test | — | pending |
|16| API versioning + compatibility | new `/api/v1` routers, legacy `/api` delegates | — | both live | — | — | legacy route regression tests | — | pending |
|17| Backend test foundation | Jest + supertest, `server/tests/*` | test DB | — | — | — | (this row) | — | pending |
|18| Documentation | `README.md`, `docs/leadzaro/adr/*` | — | — | — | — | — | — | pending |

## 4. Non-goals reaffirmed for this phase
Normalized CRM entities, public inbound forms, Stripe, projects/tasks/requests/messaging, GCS files, website builder, GitHub/cPanel deployment, analytics/SEO, AI — none of these are touched.

## 5. Validation commands planned
- `npm install` (regenerate lockfile)
- `npx ng build` (production build)
- `npx tsc -p tsconfig.app.json --noEmit` (strict type check)
- `node --check` across new/changed backend files
- `npx sequelize-cli db:migrate` / `db:migrate:status` / `db:migrate:undo:all` against an empty disposable DB
- A second run against a **legacy-simulated** DB (seeded with pre-Phase-1-shaped rows) to prove backfill correctness
- `npm run test:backend` (Jest + supertest)
- `npx ng test` (Karma/Jasmine) if a headless Chrome is available in this environment; otherwise documented as a known sandbox limitation
