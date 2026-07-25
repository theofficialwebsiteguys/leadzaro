# Leadzaro Repository Audit

## Executive assessment

The current repository is a useful early product, not a throwaway prototype. It already contains a functional Angular 19 frontend and an Express/Sequelize/PostgreSQL backend with authentication, Google Places lead search, saved leads, notes, outreach activity, a dashboard, and initial subscription models.

The correct strategy is to **evolve the repository through compatibility-preserving migrations**, not rebuild it from zero.

The largest gap is not visual polish. It is that the current data and authorization model represents a single-user lead-search SaaS, while the intended product is a multi-user Website Guys agency operating system with employees, client organizations, projects, role-based access, billing, design, development, hosting, and ongoing support.

## Repository snapshot

### Current stack

- Angular 19.2 standalone application
- Angular signals and lazy-loaded routes
- Node.js with Express 4
- Sequelize 6 with PostgreSQL
- JWT bearer authentication
- Google Places API integration
- Stripe environment/configuration placeholders
- Docker Compose PostgreSQL development service
- Shared root `package.json` for frontend and backend

### Existing backend modules

- Authentication and profile management
- Lead search and Google Place detail retrieval
- Saved leads
- Lead notes
- Outreach activities
- Dashboard statistics
- Subscription plans and user subscriptions

### Existing frontend areas

- Public Leadzaro marketing landing page
- Login and public registration
- Dashboard
- Lead search
- Saved leads
- Lead detail and activity logging
- Outreach history
- Subscription page
- User settings

## What should be preserved

1. **Google Places search service** — it already contains sensible cost-control ideas: short-term search caching, longer geocode caching, and on-demand phone retrieval.
2. **Angular standalone architecture** — it is modern and suitable for the future application.
3. **Signal-based local state** — appropriate for the current scope and can be retained while introducing domain stores only where needed.
4. **Lazy feature routing** — a good foundation for a much larger product.
5. **Response, pagination, validation, and error utilities** — these can be refined instead of discarded.
6. **Lead search and saved-lead user experience** — should be migrated into the new sales workspace rather than rewritten immediately.
7. **PostgreSQL and Sequelize** — acceptable for the intended modular monolith.
8. **The existing visual design language** — can be evolved into the Website Guys operating interface.

## Critical findings

### 1. Uploaded credentials require rotation

The uploaded ZIP includes a populated `.env` containing a Stripe test secret, Stripe webhook secret, Google API key, JWT secret, and database credentials. Values were not reproduced in this audit.

Required action:

- rotate the Stripe webhook secret and test key;
- restrict or rotate the Google API key;
- replace the JWT secret;
- replace shared database credentials if they are used outside a disposable local database;
- add `.env` to `.gitignore`;
- ensure `.env.example` contains placeholders only;
- remove local Claude permission files, build caches, `node_modules`, `dist`, and `.git` from future ZIP handoffs.

### 2. There is no trustworthy application baseline commit

The Git repository contains one initial scaffold commit. Nearly all application files are modified or untracked. Before structural work begins, the current functioning application must be committed as a baseline on a protected branch or tag.

Without this, Claude cannot reliably distinguish inherited behavior from new regressions.

### 3. Runtime schema synchronization is unsafe

The server starts with:

```js
sequelize.sync({ alter: process.env.NODE_ENV !== 'production' })
```

There is no migrations directory or migration runner. `sync({ alter: true })` must be replaced with explicit, reversible migrations before the domain model grows.

### 4. Ownership is user-based instead of organization-based

Current records are owned directly by a user:

- `SavedLead.userId`
- `LeadNote.userId`
- `OutreachActivity.userId`
- `UserSubscription.userId`

This prevents shared lead pools, multiple employees, client users, role-based access, team reassignment, and organization billing.

The first migration must introduce organizations and memberships while preserving existing data.

### 5. Authorization supports only `user` and `admin`

The platform needs:

- multiple roles per employee;
- predefined role bundles;
- individual permission grants and restrictions;
- organization and project scope;
- client roles;
- backend permission enforcement;
- auditability.

Frontend route hiding is not sufficient.

### 6. Current product positioning conflicts with the new product direction

The current landing page sells Leadzaro publicly as a general lead-generation SaaS with Free Trial, Starter, Pro, and Agency plans. Public registration automatically creates a trial subscription.

The new direction is:

- public Website Guys acquisition pages that create inbound leads;
- invite-only employee and client accounts;
- Website Guys-branded client portal;
- internal service plans and Stripe billing;
- optional future external Leadzaro SaaS, but not the current launch focus.

The old public SaaS behavior should be feature-flagged or archived, not mixed into agency billing.

### 7. Stripe is not implemented

Stripe environment variables and subscription fields exist, but `/api/subscriptions/upgrade` returns HTTP 501. There is no product catalog, Payment Link creation, webhook handling, idempotency table, client conversion, billing portal, or organization billing model.

This belongs in Phase 3 after the organization and CRM foundations exist.

### 8. Automated test coverage is effectively absent

Only the generated root Angular component test exists. There are no backend tests, integration tests, migration tests, authorization tests, or end-to-end workflows.

Every phase must add tests for its highest-risk behavior rather than postponing all testing.

### 9. Hard deletion and no audit history

Saved leads and outreach activities are permanently destroyed. There is no archive lifecycle, restore behavior, deletion actor, or immutable activity record.

The target system requires soft deletion by default and administrator-only permanent deletion.

### 10. Browser authentication storage should be strengthened

The JWT and serialized user are stored in `localStorage`. This is simple but raises token exposure risk if an XSS issue occurs. Phase 1 should establish revocable sessions and move toward secure HttpOnly cookie-based refresh/session handling, retaining a controlled compatibility path during migration.

### 11. API scoping is inconsistent

`GET /api/leads` returns canonical Lead records without organization ownership or user filtering. Other endpoints filter by user. As soon as teams and clients exist, every endpoint must explicitly declare its scope and authorization behavior.

### 12. Duplicate and CRM semantics are too limited

`Lead.googlePlaceId` is globally unique, which is useful for canonical Google businesses, but the current `SavedLead` model is only a user bookmark. It does not represent:

- a prospect organization;
- multiple locations;
- contacts;
- opportunities;
- assignment;
- pipeline stage;
- source attribution;
- campaigns;
- conversion history.

Phase 2 should normalize this while maintaining compatibility with the existing UI.

### 13. Demo IDs are unstable

Demo Place IDs include the current timestamp. The same demo business can become a new canonical Lead on every search. Demo data should use deterministic IDs.

### 14. Search pagination is not true Google pagination

Google search is limited to the returned page and presents a single-page pagination structure. The current implementation is still useful, but saved search campaigns and later-page retrieval need a separate design.

### 15. In-memory caches do not scale across processes

The lead-search caches are process-local. This is acceptable now, but the service interface should allow a Redis or database-backed cache later without rewriting lead search.

### 16. Validation is incomplete

Registration has validation, but profile updates, saved-lead updates, and several route parameters are not comprehensively validated. Enumeration and date fields should be validated in route schemas or domain commands.

### 17. Configuration validation is missing

The application silently falls back to a known development JWT secret and default database credentials. Startup should validate required configuration by environment and fail clearly in production.

### 18. Documentation is still the Angular-generated README

There is no setup guide covering the backend, database, environment, Google APIs, architecture, test commands, or deployment.

### 19. Build packaging is not portable

The ZIP included Windows-installed `node_modules`. The bundled esbuild binary cannot run on Linux. Dependencies must be installed from `package-lock.json` on the target system; `node_modules` should never be distributed.

### 20. Build validation status

- Backend JavaScript files passed `node --check` syntax validation.
- The uploaded frontend could not be clean-built in the audit environment because the included dependencies were Windows-specific and a clean dependency installation did not complete in the available sandbox.
- A previous `dist/` artifact exists in the ZIP, suggesting the project has built successfully in its original environment, but that is not a substitute for a clean baseline build.

## Recommended migration strategy

### Do not perform a big-bang rewrite

Use a strangler/compatibility approach:

1. Create migrations, organization scope, memberships, roles, permissions, audit, notifications, and invitations.
2. Backfill every existing user into the seeded Website Guys organization.
3. Add organization scope to existing saved leads, notes, outreach, and subscriptions.
4. Keep existing routes working through organization-aware services.
5. In Phase 2, introduce normalized prospect organizations, locations, contacts, opportunities, and campaigns.
6. Migrate the current `Lead`/`SavedLead` workflow behind a compatibility adapter.
7. Remove legacy fields and routes only after data parity and regression tests pass.

## Phase 1 migration mapping

| Current concept | Phase 1 treatment |
|---|---|
| `User` | Remains the global login identity |
| `User.role` | Temporarily retained for compatibility; authority moves to membership roles |
| `User.companyName` | Preserved as profile metadata; no longer used as tenant ownership |
| Existing users | Added to the seeded Website Guys organization |
| Existing admin users | Receive Administrator membership role |
| Existing normal users | Receive Sales Representative membership role by default |
| `Lead` | Remains canonical business/search data during Phase 1 |
| `SavedLead` | Gains organization scope and compatibility service |
| `LeadNote` | Gains organization scope and audit behavior |
| `OutreachActivity` | Gains organization scope and audit behavior |
| `UserSubscription` | Preserved temporarily; future billing authority moves to organization/client accounts |
| Public registration | Disabled or invitation-gated |
| Existing landing page | Retained only as a temporary/feature-flagged surface until inbound pages are built |

## Immediate pre-Claude checklist

- [ ] Rotate secrets.
- [ ] Sanitize `.env.example`.
- [ ] Add `.env`, `.claude/settings.local.json`, `.angular`, `dist`, logs, and local artifacts to `.gitignore`.
- [ ] Remove `node_modules` from shared packages.
- [ ] Perform a clean `npm ci` on the development machine.
- [ ] Confirm `npm run build` passes.
- [ ] Confirm the backend connects to a disposable PostgreSQL database.
- [ ] Commit/tag the current application as the baseline.
- [ ] Create a feature branch for Phase 1.
