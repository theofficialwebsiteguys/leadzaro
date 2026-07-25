# Phase 2 Implementation Plan — Lead Generation, Inbound Acquisition, and CRM

## 1. Repository evidence audit

### What Phase 1 left in place (verified against actual code, not assumed)

- `Lead` (`server/models/Lead.js`) remains the canonical, globally-deduplicated-by-`googlePlaceId` Google Places business record. Unchanged this phase.
- `SavedLead` (`server/models/SavedLead.js`) is organization-scoped (`organizationId`, `userId` as author, `status`/`priority` enums, `archivedAt`/`deletedAt` soft-delete, unique-while-active per `(organizationId, leadId)`). This is today's entire "CRM" — a single flat bookmark-with-status per business per organization.
- **`Organization.type` already includes `'prospect'`** (`server/models/Organization.js`, confirmed live: `Organization.TYPES → ['agency', 'client', 'prospect']`). This was deliberately anticipated in Phase 1 and is the single biggest architectural fact shaping this plan: prospect organizations are not a new tenant concept requiring a parallel model — they reuse the exact `Organization`/`OrganizationMembership` infrastructure already built, audited, tested, and permission-checked in Phase 1.
- Full RBAC foundation (`server/core/authorization/{catalog,context}.js`), audit (`server/core/audit/auditService.js`), notifications (`server/core/notifications/notificationService.js`), and sessions are all reusable as-is.
- Test infrastructure: `server/tests/helpers/{factory,globalSetup}.js` — reuse directly.
- No prior CRM entities exist: no Contact, Opportunity, Location, Campaign, Territory, Score, Assignment, WebsiteAudit, or public inbound-form model of any kind. This phase is greenfield for all of them.

### Key architectural decision: what is a "prospect organization"?

The master architecture (`docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` § 7) describes:

```
Organization (prospect)
├── Locations
├── Contacts
├── Opportunities
├── Search Campaign Memberships
├── Activities
├── Notes
├── Website Audits
├── Scores
├── Assignments
└── Conversion History
```

Given `Organization.type: 'prospect'` already exists, the only reasonable reading is: **a prospect organization is an `Organization` row**, and Phase 2's new entities (`Contact`, `Opportunity`, `Location`, campaign membership, score, assignment) are new tables that hang off `organizationId`, exactly the way Phase 1's `SavedLead`/`OutreachActivity`/`LeadNote` already do. This is not a new tenant/membership concept — a prospect organization typically has **no** `OrganizationMembership` rows at all (nobody logs in as a prospect) until/unless it converts to a client in Phase 3.

This directly resolves what would otherwise be the single biggest open architecture question for this phase, and is why the plan below does not need to invent a parallel "prospect" concept next to `Organization`.

### The remaining design question: how does a canonical `Lead`/`SavedLead` become a prospect `Organization`+`Opportunity`?

Two materially different approaches exist:

**Option A — One canonical Lead maps to one prospect Organization globally.** A `Lead.organizationId` (nullable, unique) FK is added; the first agency to save a Lead creates its prospect `Organization`; every other organization's `SavedLead`/`Opportunity` for that same `Lead` points at the *same* prospect `Organization`. This mirrors `Lead`'s existing global-canonical-record semantics.

**Option B — Each organization gets its own prospect Organization per Lead it has saved (no sharing).** A prospect `Organization` is really "how *this* agency organization sees this business," created fresh per (agency, Lead) pair; `Lead` stays a pure search-result cache with no reverse link.

**Recommendation: Option B — confirmed by `fable-phase-reviewer` (escalated per CLAUDE.md's rule for major architecture/migration decisions before writing any migration code).** The reviewer's justification is stronger than my original one: multi-agency SaaS is explicitly out of initial scope (`02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` § 3), so today there is exactly one agency organization and the cross-agency-collision argument is nearly moot. The decisive reason is the **prospect→client conversion state machine**: `Organization.type` is a single scalar field on one row, and the architecture requires "an organization may transition from prospect to client without losing activity history" (§5). Under Option A, one shared prospect `Organization` can only hold one `type` — if one agency converts it to `client`, every other agency's still-open pursuit of the same row would have its type silently changed underneath it. Option B has no such problem: each agency's prospect `Organization` converts independently, exactly like the seeded demo client already does via `managingAgencyOrganizationId`.

The review also surfaced three required corrections to the plan below (now incorporated): (1) the backfill must group by `(organizationId, leadId)`, not iterate `SavedLead` rows independently — Phase 1's archive/restore feature means a single organization can already have both an archived and an active `SavedLead` for the same business today, and a naive per-row migration would manufacture two prospect Organizations for one real prospect, directly violating this phase's "no duplicate prospect records" gate; (2) a real DB-level partial-unique constraint is needed going forward (not just correctness at migration time); (3) `Contact`/`Opportunity`/`Location` need a denormalized `agencyOrganizationId` column so their authorization/query pattern matches the one already reviewed and tested three times in this codebase (`where: { agencyOrganizationId: req.context.organization.id }`), rather than relying on an untested join through `managingAgencyOrganizationId` that the current single-real-agency test suite could not catch if built wrong.

## 2. Proposed data model (corrected per review)

New tables. Each carries **two** organization references, matching the reviewer's required correction: `organizationId` (the prospect `Organization` it belongs to) and a denormalized **`agencyOrganizationId`** (copied from the prospect org's `managingAgencyOrganizationId` at creation time). All authorization/query scoping uses `agencyOrganizationId`, exactly matching the already-reviewed-and-tested `where: { organizationId: req.context.organization.id }` pattern `SavedLead`/`LeadNote`/`OutreachActivity` use today — never a join through `managingAgencyOrganizationId`, which nothing in a single-real-agency test suite would catch if wrong.

- `Location` — a prospect can have multiple physical locations (address, phone, hours later). One is primary.
- `Contact` — person(s) at the prospect (name, title, email, phone, source).
- `Opportunity` — the actual pipeline object: `stage` (validated string, not enum — reference table like Phase 1's role/permission catalog, since the architecture explicitly wants a "configurable in the future" pipeline), `assignedToUserId`, `sourceLeadId` (nullable FK back to the canonical `Lead`), `score`, `scoreReason`, timestamps per stage transition. **`sourceLeadId` + `agencyOrganizationId` get a partial unique index (`WHERE "deletedAt" IS NULL`)** — the DB-level guarantee that prevents a duplicate prospect from ever being created for the same business by the same agency again, mirroring `SavedLeads`' own `(organizationId, leadId)` partial unique index from Phase 1.
- `SearchCampaign` / `SearchCampaignMembership` — saved search definitions (private/shared) and which prospects came from which campaign.
- `Territory` (optional per roadmap — build the column/table but no enforcement UI yet if time-constrained).
- `WebsiteAudit` — one per prospect, generated report data + shareable-link token (reuse the hashed-token pattern from Phase 1's invitations).
- Assignment/claim history reuses `AuditLog` (already real, tested, queryable) rather than a parallel table.

### Migration from `Lead`/`SavedLead` (the major gate)

Grouped by `(organizationId, leadId)` — **not** iterated per `SavedLead` row, per the review finding: an organization can already hold both an archived and an active `SavedLead` for the same business today (Phase 1's archive/restore feature), and a naive per-row migration would manufacture two prospect Organizations for one real prospect.

For each `(organizationId, leadId)` group in `SavedLeads`:
1. Create exactly one prospect `Organization` (`type: 'prospect'`, `managingAgencyOrganizationId: organizationId`, name from `Lead.name`, a disambiguated slug — plain name-slugs will collide across unrelated businesses sharing a name, since `Organization.slug` is globally unique).
2. Create exactly one `Opportunity` under it, with `agencyOrganizationId: organizationId`, `sourceLeadId: leadId`. If the group has an active (non-archived, non-deleted) `SavedLead`, its `status` drives `Opportunity.stage` and its `userId` drives `assignedToUserId`. If the group has only archived rows (no active one), the `Opportunity` is created in a closed/inactive stage reflecting that — archived rows never spawn a second `Opportunity` or `Organization`, they're historical trail only.
3. Preserve `SavedLead` itself, unchanged, as a compatibility record (strangler pattern, per ADR 0005) — **do not delete or stop writing to `SavedLead` in this phase**; existing lead-search-save-note-outreach-dashboard UI keeps working exactly as Phase 1 left it while the new CRM UI is built against `Opportunity`. Removal of `SavedLead` is a future phase's decision.
4. `LeadNote`/`OutreachActivity` stay as-is (already organization-scoped); the new CRM UI queries them by `organizationId` (the agency org — unchanged meaning) + `leadId` (shared with `Opportunity.sourceLeadId`), avoiding a data migration for every historical note/activity.

### Testing requirement added per review

A second, fixture-only agency organization must be added to the relevant Phase 2 test suite(s) specifically to exercise agency-to-agency isolation for `Contact`/`Opportunity`/`Location` — the same technique Phase 1's independent review used to catch the impersonation tenant-boundary bug. A single-agency test suite cannot prove this boundary holds.

## 3. Sequencing given the size of this phase

Per the roadmap, Phase 2 also includes public landing pages/inbound forms, assisted outreach sequences, enrichment adapters, and a sales dashboard — each independently substantial. Implementation order, safest/highest-value first:

1. Data model + migration/backfill for `Location`/`Contact`/`Opportunity` (the major gate — get this reviewed and correct before anything else).
2. Pipeline stage reference table + assignment (claim/manager-assign/round-robin) + activity timeline reusing existing audit/notes/outreach.
3. Duplicate detection/merge preview/audit/undo for prospect organizations (the second-highest-risk item — reuses the exact archive-not-delete + audit pattern Phase 1's migration 5 already established and tested).
4. Opportunity/engagement scoring with manual override + reason.
5. Sales dashboard.
6. Website audits.
7. Public landing pages + inbound forms + UTM/source attribution (lowest technical risk, but a genuinely separate surface — public-facing Angular routes with no auth, feeding the same CRM).
8. Enrichment adapter (external API — interface + mock/disabled mode only, per the standing external-services rule).
9. Assisted outreach sequences requiring employee approval.

Items 6–9 will be deferred to a documented backlog if this phase runs out of safe stopping room before reaching them — the phase will not be declared complete with a broken or half-built item 1–3, but a coherent stop after item 3 or 4 (data model + pipeline + dedup, the actual "major gate") with 5–9 clearly documented as deferred is preferable to a rushed, unreviewed attempt at all nine.
