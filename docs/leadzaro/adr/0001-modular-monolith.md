# ADR 0001: Modular monolith, not microservices

## Status

Accepted (Phase 1).

## Context

The master architecture (`docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md`) explicitly rules out microservices for the initial build: one engineering owner, transactional workflows that cross sales/billing/client/project boundaries, and a strong preference for fewer operational failure modes over premature scalability.

## Decision

Keep a single Express application and a single PostgreSQL database. Organize new code by domain module (`server/modules/<domain>/{service,controller,routes}.js`) rather than by technical layer, so each domain's logic stays together and could be extracted into a separate service later if it ever needs to be, without that being a goal now.

Existing lead-search/CRM code stays in its original flat `server/{routes,controllers,services}` layout rather than being force-migrated into `server/modules/` immediately — see ADR 0005 for why.

## Consequences

- One deployable, one database connection pool, one set of migrations — the simplest possible operational story for a single-developer team.
- Cross-domain transactions (e.g. invitation acceptance touching Users, OrganizationMemberships, and MembershipRoles together) can use a single Sequelize transaction instead of a distributed-transaction or saga pattern.
- Domain boundaries are enforced by convention (module folders, service functions) rather than by network/process boundaries — a future extraction would require deliberate refactoring, not a rewrite.
