# Leadzaro

Leadzaro is the internal operating platform for The Website Guys: lead search and CRM today, growing into project management, a website builder, and deployment operations in later phases. See `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` for the full product vision and `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` for what's coming after this phase.

Stack: Angular 19 (standalone components, signals) + Express 4 + Sequelize 6 + PostgreSQL.

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for the local PostgreSQL instance), or an existing PostgreSQL 16 server
- A Google Places API key if you want real search results (optional — demo mode works without one)

## First-time setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at minimum:

- `DB_*` — leave as-is if you're using the bundled `docker-compose.yml`
- `JWT_SECRET` — any long random string for local dev
- `GOOGLE_PLACES_API_KEY` — optional; omit or leave the placeholder to run in demo mode (`DEMO_MODE=true`)

Start the database:

```bash
docker compose up -d
```

Run migrations (this also seeds the reference data — Website Guys organization, roles, permissions — and backfills any existing users):

```bash
npm run migrate
```

Start the app (backend on :3000, frontend on :4200, proxied through Angular):

```bash
npm start
```

Visit `http://localhost:4200`. Public registration is disabled by default (`FEATURE_PUBLIC_REGISTRATION=false`) — see [Creating your first account](#creating-your-first-account) below.

## Creating your first account

There is no public sign-up in the normal flow — accounts are created by invitation. To bootstrap the very first administrator on a fresh database, either:

1. Temporarily set `FEATURE_PUBLIC_REGISTRATION=true` in `.env`, register through `/register`, then set it back to `false` and restart the server; or
2. Insert a user directly and assign them the Administrator role via the `Roles`/`MembershipRoles` tables (see `server/migrations/20260725120004-seed-website-guys-and-rbac.js` for the exact shape).

Once at least one Administrator exists, all further onboarding goes through **Administration → Invitations** in the app.

## Environment variables

See `.env.example` for the full list with comments. Notable ones beyond the basics:

| Variable | Purpose |
|---|---|
| `FEATURE_PUBLIC_REGISTRATION` | Enables `/api/*/auth/register`. Default `false`. |
| `ACCESS_TOKEN_TTL` | Short-lived JWT lifetime (default `15m`). |
| `REFRESH_TOKEN_TTL_DAYS` | How long a session cookie stays valid (default `30`). |
| `SESSION_COOKIE_SECURE` | Force `false` only for local HTTP dev; must be `true` (default in production) once served over HTTPS. |
| `EMAIL_PROVIDER` | `console` (default, dev-mode — logs invite/reset links to the server console) or `none`. No real email provider is wired up yet. |
| `DB_TEST_NAME` | Database name used by `NODE_ENV=test` (defaults to `<DB_NAME>_test`). |

## Database and migrations

Schema changes are explicit, reversible Sequelize migrations under `server/migrations/` — there is no `sequelize.sync({ alter: true })` anywhere in normal startup. `server/server.js` refuses to start if migrations haven't been run yet.

```bash
npm run migrate            # apply pending migrations
npm run migrate:status     # see what's applied
npm run migrate:undo       # roll back the most recent migration
npm run migrate:undo:all   # roll back everything (destructive — local/test only)
```

Migration `20260725120004-seed-website-guys-and-rbac.js` seeds the permission catalog, the predefined roles, and the Website Guys organization, and backfills every pre-existing `User` row into a Website Guys membership (`role: 'admin'` → Administrator, everyone else → Sales Representative). Migration `20260725120006-ensure-agency-has-administrator.js` guarantees at least one Administrator exists even if no legacy user had `role: 'admin'`.

## Organizations, roles, and permissions

- A **User** is a global login identity. It does not own data directly.
- An **Organization** is the agency (The Website Guys, seeded once), a client, or a prospect.
- An **OrganizationMembership** connects a User to an Organization with a status (`invited`/`active`/`suspended`/`removed`) and a type (`employee`/`client`).
- A membership can hold multiple **Roles**; each Role grants a set of **Permissions**. Individual **MembershipPermissionOverride** rows can additionally grant or restrict a specific permission for one membership — a restriction always wins over a grant.
- Almost every protected API route resolves the caller's active organization from their own memberships (see `server/core/authorization/context.js`) and checks a specific permission via `requirePermission`/`requireAnyPermission`. The frontend's `*hasPermission` directive and route guards mirror this for UI purposes only — the server is the actual authorization boundary.

See `docs/leadzaro/adr/` for the reasoning behind this design.

## Invitations

Administrators invite employees or clients from **Administration → Invitations**, choosing a membership type and one or more roles. The invitee gets a link (logged to the server console in dev — see `EMAIL_PROVIDER` above) to `/accept-invite?token=...`. A brand-new email creates an account there and then; an email that already has an account requires logging in first, then reopening the same link to accept the additional membership.

## Sessions

Login issues a short-lived (15 min default) JWT access token, held only in memory by the frontend, plus an `HttpOnly` refresh cookie backing a revocable `AuthSession` row. A page reload silently exchanges the cookie for a fresh access token (see `provideAppInitializer` in `src/app/app.config.ts`) — no privileged token is ever written to `localStorage`. Users can view and revoke their own sessions, and administrators can force-sign-out another member of their organization, from **Administration → Sessions**.

## Impersonation ("View As Client")

Agency administrators can view the app as a client member for support purposes, from **Administration → View As Client**. It requires a typed reason, is fully audited (start and end), cannot be used to change the impersonated user's password, and is exited via the persistent banner shown while active.

## Running tests

Backend (Jest + supertest, against a disposable PostgreSQL database):

```bash
npm run test:backend
```

This drops and recreates the `<DB_NAME>_test` database and runs all migrations fresh before each run — it does not touch your development database. Requires the same PostgreSQL server as development (`docker compose up -d`).

Frontend (Karma/Jasmine):

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

## Building

```bash
npm run build
```

## Architecture

- `server/core/` — cross-cutting concerns: config validation, authentication (sessions/JWT), authorization (organization context, permissions), audit logging, notifications, security (token hashing).
- `server/modules/` — the newer, organization-aware domains: organizations, memberships, invitations, sessions, audit, notifications, roles, impersonation. Mounted under `/api/v1/*`.
- `server/{routes,controllers,services}/` — the original lead-search/CRM domain (auth, leads, saved leads, outreach, dashboard, subscriptions). Kept at `/api/*` for compatibility; also reachable at `/api/v1/auth/*`. These now call into the same authorization layer and are organization-scoped.
- `server/migrations/` — the schema/backfill history; see above.
- `src/app/core/` — auth, organization context, permission directive/guards, shared models/services.
- `src/app/features/administration/` — the members/invitations/sessions/audit/impersonation admin UI.
- `src/app/layout/` — the permission-aware sidebar/shell.

Known deferred work (see `docs/leadzaro/phase-1-completion-report.md` for the full list): normalized CRM entities (prospect orgs/contacts/opportunities), Stripe billing, projects, the website builder, deployment operations, and a real email provider are all out of scope for this phase — see the roadmap doc for when each lands.
