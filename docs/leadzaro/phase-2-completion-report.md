# Phase 2 Completion Report (Final)

This supersedes the earlier version of this report (preserved in git history at commit `d2442a5`), which covered only the first three slices of this phase. This version covers Phase 2 in its entirety, at the point it is being declared complete.

## Phase

- Phase number/name: Phase 2 — Lead Generation, Inbound Acquisition, and CRM
- Branch/checkpoint: `main`, commits `ad3c23b` through `ad1903d` (13 commits)
- Started: 2026-07-25
- Completed: 2026-07-26
- Overall result: **Complete**, with a clearly documented, lower-priority backlog deferred to a future phase or continuation (see below) — not a partial/blocked result.

## Scope delivered

A complete CRM foundation and public acquisition funnel, replacing the single-user `SavedLead` bookmark model with a real multi-employee sales pipeline, while leaving `SavedLead` itself fully intact and working (strangler pattern, ADR 0005):

1. **Data model**: prospect `Organization` per `(agency, Lead)` pair (ADR 0006), `Opportunity`/`Contact`/`Location` all denormalizing `agencyOrganizationId` for tenant-scoped authorization.
2. **Migration**: every legacy `SavedLead` backfilled into exactly one prospect `Organization` + `Opportunity`, grouped by `(organizationId, leadId)` to avoid manufacturing duplicates from archived/active history. Verified against the real development database, not just synthetic fixtures.
3. **Opportunity pipeline**: create (from a Lead, manually, or from a public inbound submission), list/filter, stage update, claim, manager-assign, round-robin auto-assign (load-balanced, excluding closed deals), archive/restore.
4. **Duplicate detection, merge, and undo**: N-way normalized-name grouping, preview, merge (archive-not-delete + full audit snapshot), undo-merge.
5. **Rule-based engagement scoring**: computed at creation and on-demand recalculation, with a full manual-override path; a human's override is never silently clobbered.
6. **Sales pipeline dashboard**: stage distribution, win rate, and personal stats visible to everyone; a per-rep team breakdown visible only to managers/admins.
7. **Website audits**: rule-based (no live fetch — a deliberate SSRF-avoidance decision), with a hashed, rotatable, publicly shareable report link.
8. **Public acquisition**: nine campaign landing pages feeding the same CRM through a rate-limited, honeypot-protected public endpoint, with full UTM/referrer/landing-page attribution surfaced back to the agency.
9. **Enrichment adapter**: a typed provider interface with mock (clearly self-labeled demo data) and disabled (production default) modes — no real vendor integrated, per the standing external-services rule.
10. **Frontend**: a single, mobile-usable Pipeline screen housing all of the above — filterable table, inline stage/score editing, assignment controls, a duplicates/merge panel, a pipeline-overview dashboard section, and toggleable website-audit/enrichment panels per opportunity.

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Prospect org per (agency, Lead), not shared across agencies | `opportunityService.createFromLead`, backfill migration | Cross-agency isolation tests (`crm.test.js`, `crmMerge.test.js`, `crmDashboard.test.js`, `crmWebsiteAudit.test.js`, `crmEnrichment.test.js`, `publicInboundLead.test.js`) | Done |
| No duplicate active Opportunity per (agency, lead) | DB partial unique index + service pre-check | `crm.test.js` | Done |
| Pipeline stage validated reference list | `pipelineCatalog.js` | `crm.test.js` | Done |
| Claim/assign/round-robin, permission-gated, fairness-correct | `opportunityService.js` | `crm.test.js` (incl. closed-stage exclusion) | Done |
| Archive/restore, merge-aware (can't bypass undo-merge) | `opportunityService.restore` | `crmMerge.test.js` | Done |
| Duplicate detection/merge/undo, audited | `mergeService.js` | `crmMerge.test.js` (7 tests) | Done |
| Auto-score at creation + on-demand recalculation, manual override never silently overwritten | `scoring.js`, `opportunityService.js` | `crmScoring.test.js` | Done |
| Dashboard: stage counts, win rate, personal stats, manager-only team breakdown | `dashboardService.js` | `crmDashboard.test.js` (incl. the permission-gating fix) | Done |
| Website audit: rule-based, no live fetch, hashed rotatable share link, public report exposes only report fields | `websiteAuditor.js`, `websiteAuditService.js` | `crmWebsiteAudit.test.js` (7 tests) | Done |
| Nine inbound campaign pages, public endpoint, UTM/referrer capture, honeypot, rate-limited, resolves to single default agency, attribution surfaced back to agency | `inboundCampaigns.js`, `inboundLeadService.js` | `publicInboundLead.test.js` (5 tests) | Done |
| Enrichment: typed adapter, mock/disabled modes, production-safe default | `enrichmentAdapter.js`, `enrichmentService.js` | `crmEnrichment.test.js` (4 tests) | Done |
| Mobile-usable, permission-gated frontend throughout | `crm-pipeline.component.*` | Multiple real headless-Chrome sessions (see below) | Done |

## Repository changes

### Backend

- Modules: `server/modules/crm/{opportunityService,opportunityController,mergeService,mergeController,dashboardService,dashboardController,websiteAuditService,websiteAuditController,enrichmentService,enrichmentController,routes}.js`, `server/modules/public/{inboundLeadService,inboundLeadController,routes}.js`
- Core: `server/core/crm/{pipelineCatalog,scoring,websiteAuditor,inboundCampaigns,defaultAgency,slugify}.js`, `server/core/integrations/enrichment/enrichmentAdapter.js`
- Routes/APIs: `/api/v1/crm/*` (opportunities, dashboard, duplicates, merge, website-audit, enrich), `/api/v1/crm/public-audit/:token` (public), `/api/v1/public/inbound-leads` (public)
- Authorization: `leads.read`/`leads.save`/`leads.archive` (reused from Phase 1), `crm.manage_pipeline`/`leads.assign` (Phase 2) — verified that team-wide dashboard visibility is gated on `leads.assign` specifically, not the much more broadly-held `crm.manage_pipeline`, after catching that exact mistake in my own test suite.
- New env config: `ENRICHMENT_PROVIDER` (documented in `.env.example`), production-safe default.

### Frontend

- Routes/screens: `/app/pipeline` (all authenticated CRM functionality), `/audit/:token` (public website-audit report), `/get-started/:slug` (public inbound campaign pages)
- Services: `CrmService`, `InboundLeadService`
- Fixed a real, previously-undetected bug in `auth.interceptor.ts` that redirected every anonymous visitor away from every public page (landing, login, register, accept-invite) to `/login` — found via manual browser verification of the website-audit public report, not by unit tests. This interceptor had no prior test coverage at all; it now does (`auth.interceptor.spec.ts`, 3 tests).

### Database

- New tables: `Opportunities`, `Contacts`, `Locations`, `WebsiteAudits`, `InboundSubmissions`, `Enrichments`
- Changed tables: `Opportunities.mergedIntoOpportunityId`
- Migrations `20260725120010` through `20260725120016` (7 total this phase). Schema migrations all have real, tested `down()`s; the two data-only migrations (backfill, permission seed) are intentionally irreversible and documented as such, matching Phase 1's established precedent — not silently omitted.

## Legacy compatibility

- `SavedLead`/`LeadNote`/`OutreachActivity` and their routes/UI are completely untouched and fully functional throughout this entire phase (`leadsRegression.test.js` unchanged and passing at every commit).
- No existing route or workflow was removed or repurposed.

## Security and privacy

- No new secrets/credentials introduced. `ENRICHMENT_PROVIDER` is a mode string, not a credential.
- Every public, unauthenticated endpoint (`public-audit/:token`, `public/inbound-leads`) exposes only the minimum fields required and was verified by a dedicated test asserting the exact response key set — never internal CRM identifiers.
- Website audits and the enrichment adapter both deliberately avoid making the server fetch an arbitrary caller/lead-supplied URL — a real SSRF surface that would need substantial dedicated security work of its own, not something to take on as a side effect of a reporting feature.
- Public inbound submissions are rate-limited (`publicFormLimiter`, stricter than the generic API limiter) and honeypot-protected.
- Cross-tenant isolation re-proven for every new agency-scoped entity introduced this phase (Opportunity, Contact, Location, WebsiteAudit, InboundSubmission, Enrichment) via dedicated two-fixture-agency tests, not assumed from the pattern alone.

## Validation commands run (final)

- `npm run test:backend`: **60/60 passing, 14 suites** (was 0 CRM-specific tests before this phase; legacy suites unchanged).
- `ng test`: **18/18 passing** (was 15 before this phase; +3 for the auth-interceptor bug found and fixed).
- `ng build`: clean (only the pre-existing inherited `landing.component.scss` budget warning, unrelated to this phase).
- Migration tests: apply-to-empty-database, full-rollback-and-re-migration, legacy-duplicate-merge, and Phase-2-backfill-correctness all passing against the complete, final migration set (16 total).
- Real headless-Chrome sessions (six separate verification passes across this phase, each against an isolated synthetic org except where the feature itself always targets the real default agency): CRM pipeline basic UI, opportunity scoring, sales dashboard (rep vs. manager views), website audits (including a genuine anonymous-visitor session that first exposed the interceptor bug), public inbound landing pages (against the real dev database, since that endpoint has no synthetic-org escape hatch — verified and immediately cleaned up), and the enrichment panel.

## Review passes (both structured passes, across the whole phase)

### Pass 1 — architecture and engineering (findings across all slices, all fixed)

| Severity | Finding | Resolution |
|---|---|---|
| Medium | Round-robin load count included closed deals, skewing fairness | Excluded `CLOSED_STAGES` from the count |
| Medium | Merge had no defense-in-depth guard against an already-archived winner/loser | Explicit checks added, ordered so "already merged" (409) wins over generic "already archived" (422) |
| High | `GET /merge/preview` had no query-param validation (Sequelize silently drops `undefined` where-keys) | `express-validator` checks added |
| High | `restore()` could bypass undo-merge on a merged-away opportunity, orphaning moved Contacts/Locations | Rejected (409), pointing the caller at undo-merge |
| High | `undoMerge()` silently under-restored if its own audit entry was missing | Fails loudly (409) instead |
| Medium | CRM opportunity list had no pagination ceiling, didn't reuse the shared `getPagination` util | Switched to it (clamps 1–100) |
| Medium | Team dashboard breakdown gated on `crm.manage_pipeline` (held by every rep), leaking every rep's numbers to every other rep | Gated on `leads.assign` (manager/admin only) instead |

### Pass 2 — security, QA, accessibility, usability (findings across all slices, all fixed)

| Severity | Finding | Resolution |
|---|---|---|
| High | `auth.interceptor.ts` forced a logout/redirect on *any* 401, including the silent bootstrap-refresh call every anonymous page load makes — breaking every public page in the app | Exempt endpoints now short-circuit before the forced redirect; added the interceptor's first-ever test file |
| Low | Score-edit validation-error handler dropped `express-validator`'s `details` array, showing a bare "Validation failed" | Now surfaces the specific field/reason |
| Low (deferred) | Contact/Location tenant isolation during merge is correct today but rests on an unenforced application-level invariant (no Contact/Location management UI exists yet to violate it) | Documented for the future Contact/Location UI slice, not fixed now — no exploitable path exists |
| Low (deferred) | Invisible-overlay badge-selects have no `aria-label` (pre-existing Phase 1 pattern, not newly introduced) | Deferred, covers both instances together |
| Low (deferred) | No dedup of Contact/Location rows during merge | Deferred, cosmetic |
| Low (deferred) | `findPossibleDuplicates` has no pagination | Deferred, fine at current scale |
| Low (deferred) | Low-probability concurrent-double-merge race (no row locking) | Deferred, no data loss, requires an unusual double-click |

An independent `fable-phase-reviewer` pass (read-only agent) was used twice during this phase: once during architecture planning (validating the prospect-organization-per-agency decision, ADR 0006, and catching the backfill duplicate-record risk before any migration code was written), and once specifically for the merge/duplicate-detection feature given its cross-organization data movement — both times it found real, actionable issues that were fixed and covered by regression tests. Later slices in this phase (scoring, dashboard, website audits, inbound forms, enrichment) did not independently rise to the "major architecture/authorization/migration" bar CLAUDE.md reserves for that escalation — each was reviewed by my own two structured passes plus real browser verification instead, which is where the interceptor bug, the permission-gating mistake, and several others were actually caught.

## Regression verification

`leadsRegression.test.js`, `auth.test.js`, `organizationIsolation.test.js`, `rbac.test.js`, `invitations.test.js`, `impersonation.test.js` — all unchanged and passing at every commit throughout this entire phase.

## Data migration evidence

- Empty DB and legacy-DB migration runs both pass.
- Real dev database backfill: 11 `SavedLeads` → 11 distinct `(organizationId, leadId)` groups → exactly 11 `Opportunities` → exactly 11 prospect `Organizations`. Clean 1:1:1:1.
- The real dev database happened to contain a genuine pre-existing 3-way name-duplicate ("Premier dentist"), correctly surfaced by the duplicate-detection feature during manual verification, merged, then reversed via undo-merge and independently confirmed restored to its exact prior state.
- The public inbound-lead endpoint was verified against the real dev database directly (it has no synthetic-org escape hatch — it always resolves to the real default agency) and the resulting test records were independently verified then immediately deleted.

## Manual configuration required

None. No new external service credentials, DNS, or provider configuration required by anything delivered in this phase. `ENRICHMENT_PROVIDER` and the (unused-until-Phase-3) Stripe placeholders remain the only unconfigured integration points, both already documented in `.env.example`.

## Deferred backlog

### Medium priority

- Contact/Location management UI (create/edit/list), with a service-layer tenant-isolation assertion designed in from the start rather than relying on the currently-unenforced invariant.

### Low priority

- `aria-label` on invisible-overlay badge-selects (both the CRM one and the pre-existing Phase 1 one).
- Contact/Location dedup during merge.
- Pagination/windowing for `findPossibleDuplicates` if agency opportunity volume grows significantly.
- Row-locking for the concurrent-double-merge race, if ever observed in practice.

### Deliberately deferred to a later continuation (per the roadmap, not started this phase)

- Assisted outreach sequences requiring employee approval.
- Optional territories.
- Saved search campaigns (private/shared).
- A real enrichment vendor integration (mock/disabled adapter only, by design).

## Known risks

- The concurrent-double-merge race (Low, no data loss).
- Contact/Location tenant isolation depends on every future write path correctly deriving `agencyOrganizationId` — flagged so the next slice that builds Contact/Location management doesn't silently regress it.
- The public inbound-lead endpoint always resolves to a single default agency; true multi-agency public SaaS would need a deliberate redesign of that resolution, not an extension of it.

## Documentation updated

- Architecture decisions: `docs/leadzaro/adr/0006-prospect-organization-per-agency.md`.
- `.env.example`: `ENRICHMENT_PROVIDER` documented.
- `docs/leadzaro/current-phase-plan.md`: reflects the most recent slice (enrichment); prior slices' plans are preserved in git history at each commit.
- This report supersedes the mid-phase version.

## Readiness for next phase

- Ready: **Yes.**
- Blocking reasons: none. No unresolved Critical/High finding remains anywhere in this phase's scope; all acceptance criteria pass; builds/tests/migrations pass; the backlog above is documented rather than silently expanding scope.
- Recommended next-phase starting point: Phase 3 (Stripe/billing), per the roadmap and the product owner's explicit direction to proceed there next. The deferred Phase 2 backlog above (outreach sequences, territories, saved search campaigns, Contact/Location UI) remains available as a future continuation whenever prioritized, but does not block Phase 3.
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (rewritten for Phase 3 alongside this report).
