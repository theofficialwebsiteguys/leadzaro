# ADR 0005: Keep legacy `/api/*` routes; add `/api/v1/*` for new foundation endpoints

## Status

Accepted (Phase 1).

## Context

The controller prompt requires existing routes to keep working during migration while new APIs use a consistent versioned convention. Rewriting `leads`/`savedLeads`/`outreach`/`dashboard`/`subscriptions` from scratch under a new prefix would break the existing Angular pages for no functional benefit, and risks exactly the kind of incidental regression the phase rules prohibit.

## Decision

- Existing routes stay at `/api/auth`, `/api/leads`, `/api/saved-leads`, `/api/outreach`, `/api/dashboard`, `/api/subscriptions`. Their controllers were updated in place to call the new `resolveContext()`/`requirePermission()` authorization layer and to scope queries by `req.context.organization.id` instead of only `req.user.id` — the routes and response shapes are unchanged, but the data returned is now organization-scoped and permission-checked.
- All genuinely new Phase 1 domains (organizations, memberships, invitations, sessions, audit, notifications, roles, impersonation) are mounted only under `/api/v1/*`.
- `server/routes/auth.js` (login/register/refresh/logout/password-reset/email-verification/profile/password) is mounted at *both* `/api/auth` (legacy) and `/api/v1/auth` (canonical) — one router, two prefixes — because it predates versioning but every new capability added to it this phase (refresh, logout, session-backed login, password reset, email verification) is meant to be reached through `/api/v1` going forward. The frontend calls `/api/v1/auth/*` exclusively; `/api/auth/*` remains a working alias.
- Two pre-Phase-1 hard-delete endpoints (`DELETE /api/saved-leads/:id`, `DELETE /api/outreach/:id`) were repointed to the new archive logic instead of being removed, so any caller still using them gets archived (recoverable) instead of destroyed data — a strict safety improvement, not a behavior change a caller would need to adapt to.

## Consequences

- No Angular page needed to change its HTTP call paths for the existing lead/CRM workflows; only the response *content* changed (now organization-scoped).
- New administrative UI exclusively targets `/api/v1/*`, giving a clean line between "pre-existing, compatibility-preserved" and "new, versioned" surface area without maintaining two parallel implementations of the same logic.
- Future phases should continue adding new domains under `/api/v1/*` (or a later `/api/v2/*` if a breaking change is ever unavoidable) rather than expanding the legacy `/api/*` surface.
