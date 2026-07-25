# ADR 0002: Organization/membership model and multi-role, override-based authorization

## Status

Accepted (Phase 1).

## Context

The pre-Phase-1 system had a single global `User.role` enum (`user`/`admin`) and user-owned data (`SavedLead.userId`, etc.). The target product needs: multiple employees sharing a lead pool, client organizations with their own users, an employee holding several roles at once (a Designer who is also a Project Manager), and individual permission exceptions without inventing a new role for every edge case.

## Decision

1. **User is a bare login identity.** It owns nothing directly; all agency/client data hangs off an `Organization` via `OrganizationMembership`.
2. **Organization has a `type`** (`agency`/`client`/`prospect`) stored as a validated string, not a `DataTypes.ENUM`, per the architecture's explicit guidance to avoid enum churn for workflow-configurable concepts. Same for membership `status` and `membershipType`.
3. **Roles and Permissions are reference-table rows** (`Roles`, `Permissions`, `RolePermissions`), seeded by migration from a single source of truth (`server/core/authorization/catalog.js`), not hard-coded in application logic. A membership can hold multiple roles (`MembershipRole` is a join table, not a single foreign key).
4. **Individual overrides win over role grants.** `MembershipPermissionOverride` rows with `effect: 'grant'|'restrict'` are layered on top of the union of role permissions; the effective permission set is `role permissions ∪ grants − restrictions`, computed once per request in `resolveContext()` and cached on `req.context.permissionKeys`.
5. **The server never trusts a client-supplied organization id.** `X-Organization-Id` only selects among the caller's own active memberships (see ADR 0002 continuation in `server/core/authorization/context.js`); anything else is rejected with 403 before any permission check runs.

## Consequences

- Adding a new role or permission is a data change (a migration inserting a catalog row), not a code change to an enum or a switch statement.
- Multiple-roles-per-membership and per-membership overrides are directly testable in isolation (see `server/tests/rbac.test.js`) rather than being an emergent property of scattered `if (user.role === ...)` checks.
- This is more tables and one more join than a simpler `User.role` design would need — accepted deliberately, since the alternative (retrofitting multi-role support onto a single enum later) is strictly more expensive once client organizations and per-membership exceptions exist.
- Legacy `User.role` is preserved as a deprecated compatibility field (used only by the Phase 1 backfill migration to decide the initial role assignment) and is no longer read by any authorization check.
