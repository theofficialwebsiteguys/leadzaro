# Phase 2 Completion Report

## Phase

- Phase number/name: Phase 2 — CRM foundation (prospect organizations, opportunity pipeline, duplicate detection/merge)
- Branch/checkpoint: `main`, checkpoint commits `ad3c23b` → `47d9e91` → `f6cb0c4` → `2f6b1fe` → (this report's commit)
- Started: 2026-07-25 (continuing directly from Phase 1 completion, same session)
- Completed: 2026-07-25
- Overall result: **Partial** — items 1–3 of the phase's own sequencing plan (data model/migration, pipeline+assignment, duplicate detection/merge/undo) plus a working basic frontend UI are complete, reviewed twice, and tested. Items 4 (full scoring workflow beyond the raw fields), 5–9 (sales dashboard, website audits, public landing pages/inbound forms, enrichment adapter, assisted outreach sequences) are deliberately deferred to a documented backlog, per this phase's own plan (`docs/leadzaro/current-phase-plan.md` § "Sequencing"): "a coherent stop after item 3 or 4 ... is preferable to a rushed, unreviewed attempt at all nine."

## Scope delivered

A working, end-to-end CRM slice sitting on top of Phase 1's organization/RBAC/audit foundation:

1. **Data model**: prospect `Organization` per `(agency, Lead)` pair (ADR 0006), with `Opportunity`/`Contact`/`Location` denormalizing `agencyOrganizationId` for tenant-scoped authorization, matching the pattern already established for `SavedLead`/`LeadNote`/`OutreachActivity`.
2. **Backfill**: every existing `SavedLead` becomes exactly one prospect `Organization` + `Opportunity`, grouped by `(organizationId, leadId)` to avoid manufacturing duplicates from Phase 1's archive/restore history. Verified against the real development database (see Data migration evidence below), not just synthetic fixtures.
3. **Opportunity pipeline**: create (from a Lead or manual entry), list/filter (stage, assignee, archived), stage update with score/reason, claim, manager-assign, round-robin auto-assign (load-balanced, excluding closed deals), archive/restore — all server-authorized, all audited.
4. **Duplicate detection, merge, and undo**: normalized-name duplicate grouping (N-way, not just pairwise), preview (shows exactly which Contacts/Locations would move), merge (archives the loser, never deletes, moves Contacts/Locations, writes a full audit snapshot), and undo-merge (reverses a merge using that snapshot).
5. **Frontend**: a basic, mobile-usable Pipeline screen — filterable table, inline stage changes, claim/assign/auto-assign, archive/restore, a manual "New Opportunity" form, and a duplicates panel with one-click merge into the kept record.

## Acceptance matrix

| Requirement | Implementation | Tests | Status | Notes |
|---|---|---|---|---|
| Prospect org created per (agency, Lead), not shared across agencies | `opportunityService.createFromLead`, migration `20260725120011` | `crm.test.js` cross-agency isolation test | Done | ADR 0006 |
| No duplicate active Opportunity for the same (agency, lead) | DB partial unique index `opportunities_agency_lead_active_unique` + service pre-check | `crm.test.js` duplicate-create-rejected (409) | Done | |
| Pipeline stage is a validated reference list, not an enum | `server/core/crm/pipelineCatalog.js` | `crm.test.js` bad-stage rejected (422) | Done | |
| Claim/manager-assign/round-robin, permission-gated | `opportunityService.js`, `routes.js` (`leads.save`, `leads.assign`) | `crm.test.js` (3 tests) | Done | Round-robin excludes closed-stage load |
| Archive/restore (soft-delete lifecycle) | `opportunityService.archive/restore` | `crm.test.js` | Done | `restore` now rejects a merged-away record (see findings) |
| Duplicate detection (N-way, not just pairs) | `mergeService.findPossibleDuplicates` | `crmMerge.test.js` | Done | |
| Merge preview shows exactly what will move | `mergeService.previewMerge` | `crmMerge.test.js` | Done | |
| Merge archives (never deletes) + full audit snapshot | `mergeService.merge` | `crmMerge.test.js` | Done | |
| Undo-merge reverses a merge exactly | `mergeService.undoMerge` | `crmMerge.test.js` (+ new missing-audit-entry test) | Done | |
| Cross-agency isolation re-proven for every new agency-scoped entity | Contact/Location moves scoped via already-agency-checked winner/loser | `crmMerge.test.js` cross-agency test | Done | Reviewer-independently verified safe |
| Basic pipeline UI, mobile-usable | `src/app/features/crm-pipeline/*` | Real headless-Chrome session against real dev DB (see below); `ng test` 15/15 | Done | |
| Opportunity/engagement scoring | `score`/`scoreReason` fields, settable via stage-update API+UI | Covered incidentally by stage-update test | Partial | No dedicated scoring algorithm/UI beyond manual entry — deferred |
| Sales dashboard, website audits, public landing pages, enrichment, outreach sequences | — | — | Deferred | See Deferred backlog |

## Repository changes

### Backend

- Modules/services: `server/modules/crm/{opportunityService,opportunityController,mergeService,mergeController,routes}.js`, `server/core/crm/pipelineCatalog.js`
- Routes/APIs: `/api/v1/crm/opportunities` (CRUD, claim, assign, round-robin-assign, archive, restore), `/api/v1/crm/duplicates`, `/api/v1/crm/merge`, `/api/v1/crm/merge/preview`, `/api/v1/crm/opportunities/:id/undo-merge`
- Authorization: `leads.read`/`leads.save`/`leads.archive` (reused from Phase 1), new `crm.manage_pipeline` and `leads.assign` permissions (migration `20260725120012`), granted to `administrator`/`sales_manager`/`sales_representative` only — never to client-scoped roles (independently verified)
- Jobs/events: none new; reuses Phase 1's `recordAudit`/`notify`

### Frontend

- Routes/screens: `/app/pipeline` (`CrmPipelineComponent`), added to sidebar nav (`leads.read`-gated)
- State/services: `CrmService` (`src/app/core/services/crm.service.ts`), `crm.model.ts`
- Permission behavior: `*hasPermission` gates mirror backend routes (`crm.manage_pipeline`, `leads.assign`, `leads.save`, `leads.archive`) — UI convenience only, server remains the authorization boundary
- Mobile/accessibility: verified via a real headless-Chrome session at a 390×844 viewport; native `<button>`/`<select>`/`<input>` throughout; labeled form fields. The stage-badge-select has no `aria-label`, matching a pre-existing Phase 1 pattern (`status-badge-select`) — not a new regression, logged in backlog.

### Database

- New tables: `Opportunities`, `Contacts`, `Locations`
- Changed tables: `Opportunities.mergedIntoOpportunityId` added (migration `20260725120013`)
- Indexes/constraints: partial unique index `opportunities_agency_lead_active_unique` on `(agencyOrganizationId, sourceLeadId)` WHERE `archivedAt`/`deletedAt` null
- Backfills: migration `20260725120011` — every legacy `SavedLead` becomes exactly one prospect `Organization` + `Opportunity`, grouped by `(organizationId, leadId)`
- Rollback behavior: schema migrations (`20260725120010`, `20260725120013`) have real, tested `down()`s. The backfill (`20260725120011`) and permission seed (`20260725120012`) are intentionally irreversible reference-data/data-generation migrations, documented as such in-file, matching Phase 1 migration 4's precedent — not silently omitted.

## Legacy compatibility

- Preserved workflows: `SavedLead`/`LeadNote`/`OutreachActivity` and their existing routes/UI are completely untouched and still fully functional (`leadsRegression.test.js` passes unchanged).
- Compatibility adapters: none needed yet — `Opportunity` is additive; `SavedLead` is not migrated away from in this phase (per ADR 0005's strangler pattern and the phase plan's explicit "do not delete or stop writing to SavedLead").
- Deprecated fields/routes: none yet.
- Planned removal phase: `SavedLead` removal/consolidation is an explicit future-phase decision, not part of Phase 2.

## Security and privacy

- Secret handling: no new secrets/credentials introduced; no external services integrated this phase.
- Authentication/session changes: none — reuses Phase 1's session/auth stack unchanged.
- Authorization/isolation tests: `crm.test.js` and `crmMerge.test.js` each include a dedicated two-fixture-agency cross-tenant isolation test (opportunity list/detail invisible across agencies; the same canonical Lead independently becomes a different prospect Organization per agency; cross-agency merge/preview rejected with 404).
- Input/file/webhook protections: no file/webhook handling introduced. All CRM routes validate body/query parameters via `express-validator` (including a gap found and fixed on `GET /merge/preview`, see below) and are scoped through `resolveContext()`.
- Impersonation/audit behavior: every state-changing CRM action (create, stage update, claim, assign, round-robin, archive, restore, merge, undo-merge) writes an `AuditLog` entry via the existing `recordAudit`/direct `AuditLog.create` pattern.

## Validation commands run

- Dependency install: no new dependencies added this phase; existing `node_modules` reused.
- Frontend build: `npx ng build` — clean (only the pre-existing inherited `landing.component.scss` budget warning remains, documented in the Phase 1 report).
- Type check/lint: covered by `ng build`'s strict TypeScript compilation.
- Backend checks: `node --check` on every new/modified backend file.
- Unit tests: `npx ng test --watch=false --browsers=ChromeHeadless` — 15/15 passing.
- Integration tests: `npm run test:backend` (Jest+supertest) — **42/42 passing, 9 suites** (was 35 before this phase; +7 new CRM tests, all pre-existing suites still green).
- Migration tests: `migrations.test.js` — migrations apply cleanly to an empty DB, full rollback/re-migration is safe, and a dedicated Phase 2 backfill test proves exactly one prospect Organization/Opportunity is created even when an organization has both an archived and an active `SavedLead` for the same business.
- End-to-end/manual checks: a real headless-Chrome (Puppeteer, system Chrome) session against **both dev servers and the real development database** — login, Pipeline list, create (including a deliberate duplicate-name second entry), stage update, duplicate detection, merge (with confirm dialog), archived view showing Undo Merge, and a mobile-viewport (390×844) pass. See "Data migration evidence" for how a real pre-existing 3-way duplicate in that database was involved and safely reversed.

## Review pass 1 — architecture and engineering

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| Medium | Round-robin load count included Closed Won/Closed Lost opportunities, making a rep with only closed deals look busier than one with open work | Excluded `CLOSED_STAGES` from the load-count query in `opportunityService.roundRobinAssign` | New test in `crm.test.js` |
| Medium | `previewMerge`/`merge` had no defense-in-depth check rejecting an already-archived winner/loser reached outside the duplicates UI's own active-only list | Added explicit archived/already-merged checks in `previewMerge`, ordered so the more specific "already merged" 409 is checked before the generic "already archived" 422; removed now-redundant duplicate check from `merge()` | New test in `crmMerge.test.js` |
| High | `GET /merge/preview` had no query-param validation — Sequelize silently drops `undefined` where-keys, so omitting `winnerId`/`loserId` returned an arbitrary opportunity instead of a clean error | Added `express-validator` checks + `validate` middleware | New test in `crmMerge.test.js` |

## Review pass 2 — security, QA, accessibility, usability (own pass + independent `fable-phase-reviewer`)

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | `opportunityService.restore()` could un-archive a merged-away opportunity directly (bypassing undo-merge), leaving `mergedIntoOpportunityId` dangling and its Contacts/Locations permanently misattributed on the winner | Added a guard rejecting restore (409) when `mergedIntoOpportunityId` is set, pointing the caller at undo-merge | New test in `crmMerge.test.js`: restore attempt on a merged record returns 409, record remains merged/archived |
| High | `mergeService.undoMerge()` silently proceeded with empty defaults (no error, 200 response) if its own `opportunity.merged` audit entry was missing, leaving Contacts/Locations stranded and stage/score unrestored | Throws a clear 409 if the audit entry is not found, instead of degrading silently | New test in `crmMerge.test.js`: audit entry deleted, undo-merge returns 409, record remains merged/archived |
| Medium | CRM opportunity list endpoint accepted an unbounded, unvalidated `limit`/`page` directly from the query string instead of the shared `getPagination` util already used by `savedLeadController.js` | Switched `opportunityController.list`/`opportunityService.listForAgency` to `getPagination`/`formatPaginatedResponse` (clamps limit to 1–100, guards non-numeric input) | Manual verification against existing pagination tests' pattern; full suite still green |
| Medium | Contact/Location tenant isolation during merge is correct today but rests on an unenforced application-level invariant (no DB-level composite constraint tying their `agencyOrganizationId` to the parent prospect Organization's managing agency) | Not fixed this phase — no exploitable path exists yet (no Contact/Location management UI/routes exist to violate the invariant) | Deferred to backlog: bake an explicit service-layer assertion into the future Contact/Location management slice |
| Low | Invisible-overlay `stage-badge-select` has no `aria-label` | Not fixed — identical pre-existing pattern (`status-badge-select`) in Phase 1's `saved-leads` component; fixing only the new instance would be inconsistent | Deferred to backlog (covers both instances) |
| Low | No dedup of Contact/Location rows during merge (identical contact on both sides yields two after merge) | Not fixed — cosmetic, and Contact/Location have no management UI yet | Deferred to backlog |
| Low | `findPossibleDuplicates` loads all active opportunities for an agency into memory with no pagination | Not fixed — fine at current single-agency scale | Deferred to backlog (scaling limit) |
| Low | A low-probability race: two concurrent merge requests for the same loser could both pass the "not already merged" check before either commits (no row locking), producing a duplicate audit entry and last-write-wins on `mergedIntoOpportunityId` | Not fixed — no data loss, requires an unusual double-click race; fixing correctly needs `SELECT ... FOR UPDATE` | Deferred to backlog |

An independent `fable-phase-reviewer` pass (agent, read-only) was run specifically because this slice moves data across organization boundaries (Contact/Location reassignment during merge) — the same class of risk that caught real issues during Phase 1's impersonation feature. It confirmed all three of my own pass-1 fixes were correctly closed, confirmed the migrations are sound (real `down()`s where reversible, intentional irreversibility documented where not), confirmed Contact/Location tenant isolation is safe today (traced every write path), and found the two High findings above plus the two Medium findings — all incorporated into this report.

## Regression verification

- `leadsRegression.test.js` (demo search → save → note → outreach → dashboard, archive/restore, permission enforcement) — unchanged, passing.
- `auth.test.js`, `organizationIsolation.test.js`, `rbac.test.js`, `invitations.test.js`, `impersonation.test.js` — all unchanged, passing (Phase 1 regression suite fully green).
- `ng test` — 15/15 passing (no new component specs added this phase, matching the existing project convention of relying on backend integration tests + manual/real-browser verification for feature components rather than per-component unit specs).

## Data migration evidence

- Empty DB result: `migrations.test.js` "migrations apply cleanly to an empty database" — passing.
- Legacy DB result: **run against the real, previously-existing development database** (not just synthetic fixtures) — `npx sequelize-cli db:migrate` completed cleanly through `20260725120013`.
- Record counts before/after (real dev DB): 11 `SavedLeads` → 11 distinct `(organizationId, leadId)` groups → exactly 11 `Opportunities` → exactly 11 prospect `Organizations`. Clean 1:1:1:1, confirming the backfill introduced no duplicate prospect records.
- Duplicate/loss checks: the real dev database happened to contain a genuine pre-existing 3-way name-duplicate ("Premier dentist" — three separate canonical `Lead` records for what is evidently the same real business, saved across different search sessions) surfaced correctly by the new duplicate-detection feature during manual browser verification. One of the three was merged as part of that manual test; it was then reversed via `undo-merge` and independently confirmed restored to its exact prior state (`archivedAt: null`, `mergedIntoOpportunityId: null`, `stage: 'New Lead'`, duplicate-group size back to 3). All synthetic smoke-test data and the temporary test account created for the browser verification session were removed afterward.
- Rollback test: `migrations.test.js` "full rollback and re-migration is safe" — passing (via full drop/recreate in `globalSetup.js`, not `db:migrate:undo:all`, per the Phase 1-established pattern for avoiding down-migration fragility against accumulated data).

## Manual configuration required

None. No new external service credentials, DNS, or provider configuration required by this phase's delivered scope.

## Deferred backlog

### Medium priority

- Contact/Location management UI and routes (create/edit/list), including a service-layer tenant-isolation assertion baked in from the start (see Review pass 2 finding above) rather than relying on the current unenforced invariant.

### Low priority

- `aria-label` on the invisible-overlay stage/status badge-selects (both the new CRM one and the pre-existing Phase 1 one).
- Contact/Location dedup during merge.
- Pagination/windowing for `findPossibleDuplicates` if agency opportunity volume grows significantly.
- Row-locking (`SELECT ... FOR UPDATE`) for the concurrent-double-merge race, if it's ever observed in practice.

### Deliberately deferred to later phase (per this phase's own sequencing plan)

- Dedicated opportunity/engagement scoring algorithm or UI beyond the existing manual `score`/`scoreReason` fields.
- Sales dashboard.
- Website audits.
- Public landing pages + inbound forms + UTM/source attribution.
- Enrichment adapter (external API — interface + mock/disabled mode only, per the standing external-services rule, when built).
- Assisted outreach sequences requiring employee approval.

## Known risks

- The concurrent-double-merge race documented above (Low severity, no data loss, requires an unusual double-click).
- Contact/Location tenant isolation depends on every future write path correctly deriving `agencyOrganizationId` from the parent prospect Organization — flagged so the next slice that builds Contact/Location management doesn't silently regress it.

## Documentation updated

- README: no changes needed (setup/architecture docs from Phase 1 remain accurate; no new external services or setup steps introduced).
- Architecture decisions: added `docs/leadzaro/adr/0006-prospect-organization-per-agency.md`.
- API docs: none maintained separately from code in this repository (consistent with Phase 1).
- Migration docs: migrations are self-documenting via in-file comments, per Phase 1's established convention.
- User/admin instructions: none needed — the Pipeline screen is self-explanatory and gated by existing permission-based navigation.

## Readiness for next phase

- Ready: Yes, for a continuation of Phase 2's own deferred backlog (items 4–9) or for Phase 3, at the product owner's discretion.
- Blocking reasons: none. No unresolved Critical/High finding remains; all delivered acceptance criteria pass; builds/tests/migrations pass; backlog is documented rather than silently expanding scope.
- Recommended next-phase starting point: either (a) continue Phase 2's own remaining sequencing items (scoring UI, sales dashboard, website audits, public landing pages, enrichment, outreach sequences) as a documented continuation, or (b) proceed to Phase 3 per the roadmap if the product owner judges the CRM foundation sufficient to build billing/conversion on top of. This is a product-priority decision, not a technical blocker either way.
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (updated alongside this report).
