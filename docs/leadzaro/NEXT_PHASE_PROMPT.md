# Claude Code Phase 2 Prompt — Lead Generation, Inbound Acquisition, and CRM

Execute Phase 2 under the rules in `docs/planning/03_CLAUDE_MASTER_CONTROLLER_PROMPT.md`, scoped per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` § "Phase 2", and tailored to the actual Phase 1 result below (verified against `docs/leadzaro/phase-1-completion-report.md` — re-read the current repository before trusting anything in this prompt, per the standing rule that prior reports are evidence, not live truth).

## What Phase 1 actually delivered (the foundation Phase 2 builds on)

- Every request resolves an organization-scoped context: `req.context = { user, organization, membership, permissionKeys, availableMemberships }`, set by `resolveContext()` in `server/core/authorization/context.js`. Every new Phase 2 route must call this (via `authenticate` + `resolveContext()`) before any `requirePermission()`/`requireAnyPermission()` check.
- The permission/role catalog lives in `server/core/authorization/catalog.js` — a single source of truth seeded by migration. Phase 2 needs new permissions for CRM concepts (e.g. `crm.manage_pipeline`, `leads.assign`, `leads.merge` — the latter already reserved as a catalog entry but unused). Add new catalog entries and a migration that seeds them via `INSERT ... ON CONFLICT DO NOTHING`, following the pattern in `server/migrations/20260725120004-seed-website-guys-and-rbac.js`. Do not hand-edit already-applied migrations — add a new one.
- `Lead` remains the canonical, globally-deduplicated (by `googlePlaceId`) business record. `SavedLead` is now organization-scoped (`organizationId`, unique-while-active per `(organizationId, leadId)`) with `archivedAt`/`deletedAt` soft-delete columns. Phase 2's prospect-organization/contact/opportunity model needs to either extend this or introduce new tables alongside it with a compatibility adapter — re-read `docs/leadzaro/adr/0005-compatibility-route-strategy.md` before deciding; the same "keep legacy working, add new alongside" pattern that let Phase 1 avoid a big-bang rewrite of `/api/leads`/`/api/saved-leads` should apply here too.
- Audit (`server/core/audit/auditService.js`), notifications (`server/core/notifications/notificationService.js` + `emailAdapter.js`), and sessions are all in place and reusable — CRM assignment/claim/merge actions should call `recordAudit()` and, where a person is directly affected (assigned a lead, merged out of one), `notify()`.
- The frontend has `OrganizationContextService` (permission cache), `HasPermissionDirective`/`requireAnyPermissionGuard` (UI-only gating — server is the real boundary), and an Administration shell. New CRM screens should follow the same pattern: permission-gated nav entries, organization-scoped services, no client-side authorization decisions treated as real.
- Test infrastructure: `server/tests/helpers/factory.js` (createOrganization/createRoleAssignedMember/loginAs) and `server/tests/helpers/globalSetup.js` (drops/recreates the test DB fresh every run — do not switch this back to `db:migrate:undo:all` without first checking whether any new migration's `down()` can fail against realistic data, the way `20260725120007`'s did). Reuse these helpers for Phase 2 tests rather than rebuilding equivalent setup.

## Phase 2 primary outcomes (from the roadmap doc — verify scope against it directly)

- Temporary discovered search results; saved search campaigns (private/shared).
- Prospect organizations, multiple locations, contacts, opportunities.
- Default pipeline (`Discovered → New Lead → Researching → Attempting Contact → Contacted → Engaged → Qualified → Proposal or Offer Prepared → Payment Link Sent → Closed Won/Lost → Nurture → Do Not Contact`) with a configurable-in-the-future architecture (reference table, not an enum — same reasoning as Phase 1's `Organization.type`/membership `status`).
- Assignment: manual claim, manager assignment, round-robin.
- Optional territories.
- Activity timeline; opportunity/engagement scoring with manual adjustment + reason.
- Duplicate detection, merge preview, merge audit, restore/undo safety — this is the highest-risk item; Phase 1's migration-5 auto-merge-with-audit-and-archive-not-delete pattern is a directly applicable precedent, read it before designing this.
- Website audits + shareable report.
- Manual/optional enrichment adapter (external API — build the adapter interface + mock/disabled mode first, per the standing "external services" rule; do not block on missing credentials).
- Assisted outreach sequences requiring employee approval.
- Public Website Guys landing pages + inbound forms feeding the same CRM.
- Source/UTM/ad attribution.
- Sales employee dashboard and performance tracking.
- Migration from `Lead`/`SavedLead` compatibility records — the major gate: **no data loss, no duplicate prospect records** during this transition.

## Phase 2 non-goals (do not start these)

Stripe/billing (Phase 3), projects/tasks/client requests (Phase 4), website builder (Phase 5), code generation/GitHub (Phase 6), production deployment (Phase 7), SEO (Phase 8).

## Before writing code

1. Re-run the Phase 1 acceptance gates once more to confirm nothing has drifted (`npm run test:backend`, `ng test`, `ng build`, `tsc --noEmit`) — this is a fresh session's job even if the prior report says they passed.
2. Produce `docs/leadzaro/current-phase-plan.md` (overwrite — it's a per-phase working document, not a historical log) with the same evidence-audit-and-acceptance-matrix structure Phase 1 used.
3. Do not begin normalizing `Lead`/`SavedLead` before that plan exists and the migration/backfill risk (major gate above) has an explicit, reviewed design — this is exactly the kind of migration-safety decision `docs/planning/03_CLAUDE_MASTER_CONTROLLER_PROMPT.md` and `CLAUDE.md`'s escalation rule call for `fable-phase-reviewer` on, given it is the "major architecture, migration" category. Escalate before implementing if the merge/dedup design has more than one materially different reasonable approach.
