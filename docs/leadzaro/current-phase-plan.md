# Phase 2 Continuation Plan — Scoring and Sales Dashboard

This overwrites the prior Phase 2 working plan (preserved in git history), which covered items 1–3 (data model/migration, opportunity pipeline, duplicate detection/merge/undo) and is now fully delivered, twice-reviewed, and checkpointed — see `docs/leadzaro/phase-2-completion-report.md`. This document covers the next slice: items 4 (scoring) and 5 (sales dashboard) from `docs/leadzaro/NEXT_PHASE_PROMPT.md`'s remaining-items list.

## 1. Evidence audit

- `Opportunity.score`/`scoreReason` existed since the Phase 2 foundation migration but were always `null` — nothing ever set them except a fully manual `PUT /opportunities/:id` call, and the frontend never exposed a way to do that. "Scoring with manual override" was schema-only, not a real feature.
- `PUT /api/v1/crm/opportunities/:id` had no body validation at all for `stage`/`score`/`scoreReason` — a real, independently-discovered gap (see completion report's review pass 1) that needed closing regardless of the scoring work, and was closed as part of this slice.
- No existing "sales dashboard" or team-performance view exists anywhere in the CRM module. The legacy `/app/dashboard` (`DashboardComponent`/`dashboard.service.ts`) is `SavedLead`-based, per-user, and predates Phase 2 — it is not migrated or touched by this slice, per the standing "preserve working behavior" rule; `SavedLead` continues to coexist with `Opportunity` as established in Phase 2's foundation.

## 2. Design decisions

- **Scoring is a rule-based heuristic, not ML.** `server/core/crm/scoring.js` combines: product-fit (no website is a strong signal — that's literally what Website Guys sells), business establishment (review count/rating as a rough proxy for whether the business has a budget), pipeline progress, and activity recency, into a 0–100 score with a human-readable reason string naming every contributing factor. This is deliberately simple, explainable, and easy to retune later — not a black box.
- **Auto-score never silently overwrites a human's manual override.** It's computed once at creation, and only recomputed again through an explicit "Recalculate" action the user chooses to click — never on a background job or as a side effect of some other action.
- **The dashboard lives inside the existing Pipeline screen, not a new competing page.** Per the standing "do not introduce a separate competing workflow" rule and the next-phase prompt's own guidance to reuse the dashboard pattern "where sensible" — a team performance dashboard is a materially different scope (team-wide visibility) than the legacy per-user dashboard, so it was added as a new "Pipeline Overview" section at the top of `crm-pipeline.component` rather than either overloading the legacy dashboard or creating a second, disconnected dashboard route.
- **Team-wide visibility is gated by `leads.assign`, not `crm.manage_pipeline`.** This was a real mistake caught by my own test suite while building it: `crm.manage_pipeline` is granted broadly to every `sales_representative` (so they can manage their own pipeline), so gating the team breakdown on it would have shown every rep every other rep's individual numbers. `leads.assign` is only granted to `sales_manager`/`administrator` and is the correct signal for "this person manages others." Every caller always sees the agency-wide stage distribution and their own stats regardless of role — only the per-rep breakdown table is manager-gated.

## 3. Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Auto-score computed at opportunity creation | `opportunityService.createFromLead` + `scoring.js` | `crmScoring.test.js` | Done |
| Recalculate action (explicit, not automatic) | `POST /opportunities/:id/recalculate-score` | `crmScoring.test.js` | Done |
| Manual override persists exactly as given | Existing `PUT /opportunities/:id` (score/scoreReason already supported it) | `crmScoring.test.js` | Done |
| Score validated 0–100; stage/reason validated | `express-validator` on `PUT /opportunities/:id` | `crmScoring.test.js` | Done |
| Score badge + inline edit + recalculate in UI | `crm-pipeline.component.*` | Real headless-Chrome session (isolated synthetic org) | Done |
| Validation-error detail surfaced to the user | `formatError()` in `crm-pipeline.component.ts` | Found live via the same browser session, then fixed | Done |
| Pipeline stage distribution, win rate | `dashboardService.getPipelineSummary` | `crmDashboard.test.js` | Done |
| Caller's own stats always visible | Same endpoint, `myStats` | `crmDashboard.test.js` | Done |
| Team breakdown manager-gated (not leaked to every rep) | `leads.assign` check in `dashboardController` | `crmDashboard.test.js` (caught the `crm.manage_pipeline` mistake) | Done |
| Dashboard summary is agency-scoped | Same `agencyOrganizationId` pattern as everything else | `crmDashboard.test.js` cross-agency test | Done |

## 4. Testing performed

- `npm run test:backend`: 48/48 passing (11 suites) — up from 42 at the end of the prior slice.
- `ng test`: 15/15 passing.
- `ng build`: clean (only the pre-existing inherited landing-page budget warning).
- Real headless-Chrome sessions against isolated, purpose-created synthetic agencies (never the real dev database or any pre-existing data this time, having learned from the prior slice's incident): one for scoring (create → auto-score → manual override → recalculate), one for the dashboard (a manager + rep pair, verifying the rep sees no team breakdown and the manager does, with exact KPI values matching the seeded data). All synthetic accounts/orgs/data removed afterward.

## 5. Remaining Phase 2 backlog (unchanged from the completion report, still deferred)

Website audits, public landing pages/inbound forms/UTM attribution, enrichment adapter, assisted outreach sequences, optional territories, saved search campaigns, and Contact/Location management UI. See `docs/leadzaro/NEXT_PHASE_PROMPT.md` for sequencing guidance on these.
