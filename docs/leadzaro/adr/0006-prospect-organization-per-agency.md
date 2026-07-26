# ADR 0006: Each agency gets its own prospect Organization per Lead (no sharing across agencies)

## Status

Accepted (Phase 2).

## Context

Phase 2 needed to decide how a canonical, globally-deduplicated `Lead` (deduplicated by `googlePlaceId`) becomes a CRM-manageable prospect record. The master architecture (`02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` § 7) describes a prospect `Organization` owning `Locations`/`Contacts`/`Opportunities`/etc., and `Organization.type` already included `'prospect'` from Phase 1, anticipating this.

Two materially different designs were possible:

- **Option A** — one canonical `Lead` maps to one prospect `Organization` globally; every agency that saves the same business shares that one prospect `Organization` row.
- **Option B** — each agency gets its own prospect `Organization` per `Lead` it has pursued; `Lead` stays a pure search-result cache with no reverse link.

This decision was escalated to an independent `fable-phase-reviewer` pass before any migration code was written, per CLAUDE.md's rule for major architecture/migration decisions.

## Decision

**Option B.** Each `(agencyOrganizationId, Lead)` pair gets its own prospect `Organization`, created fresh the first time an agency turns a `Lead` into an `Opportunity`. Nothing about a prospect `Organization` is shared across agencies.

The decisive reason: `Organization.type` is a single scalar field on one row, and the architecture requires a prospect to convert to a client without losing activity history (§5). Under Option A, one shared prospect `Organization` can only hold one `type` — if one agency converts it to `client`, every other agency's still-open pursuit of the same business would have its type silently changed underneath it. Option B has no such problem: each agency's prospect `Organization` converts independently. Multi-agency SaaS is also explicitly out of initial scope (§3), so the cross-agency-collision argument for sharing is nearly moot today, and Option B keeps the door open for it later without a structural conflict.

All new Phase 2 tables (`Opportunities`, `Contacts`, `Locations`) additionally denormalize `agencyOrganizationId` (copied from the prospect org's `managingAgencyOrganizationId` at creation time) rather than resolving the owning agency via a join through the prospect organization. Every authorization/query scope uses this denormalized column directly, matching the already-reviewed-and-tested pattern `SavedLead`/`LeadNote`/`OutreachActivity` established in Phase 1 (`where: { agencyOrganizationId: req.context.organization.id }`) — a join-based approach would be structurally untestable for correctness by a single-real-agency test suite if built wrong.

## Consequences

- The same real-world business can exist as N different prospect `Organization` rows (one per agency that has pursued it), each with its own pipeline stage, contacts, and locations. This is correct given the current single-agency-per-deployment scope, and was directly proven by a dedicated cross-agency isolation test (`server/tests/crm.test.js`, "opportunities are isolated between two different agency organizations") that creates two independent fixture agencies and confirms they each get their own prospect `Organization` for the identical `googlePlaceId`.
- The Phase 1→2 backfill migration (`20260725120011-backfill-opportunities-from-saved-leads.js`) must group by `(organizationId, leadId)`, not iterate `SavedLead` rows independently, since an organization can already hold both an archived and an active `SavedLead` for the same business (Phase 1's archive/restore feature) — a naive per-row migration would manufacture two prospect Organizations for one real prospect within the same agency. This is enforced at the database level by a partial unique index (`opportunities_agency_lead_active_unique` on `(agencyOrganizationId, sourceLeadId)` WHERE `archivedAt`/`deletedAt` are null), not just at migration-time correctness.
- If true multi-agency Leadzaro SaaS is built later and sharing canonical business data across agencies becomes desirable (e.g., a shared enrichment cache), that is a new, separate feature to design deliberately — not an emergent property of this data model, and not a reversal of this decision.
