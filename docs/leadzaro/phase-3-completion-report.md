# Phase 3 Completion Report

## Phase

- Phase number/name: Phase 3 — Stripe Billing and Client Conversion
- Branch/checkpoint: `main`, commits `7399247`, `377dff9`, and this phase's closing commit
- Started: 2026-07-25
- Completed: 2026-07-26
- Overall result: **Complete**, with a documented, deliberate deferral to Phase 4 (project creation from template — see "Legacy/architecture boundary" below) and a small UI backlog item, neither blocking.

## Scope delivered

A complete internal-service-catalog-to-Stripe-billing pipeline, entirely separate from the legacy public-SaaS `UserSubscription` model (left untouched), covering every stage from "employee generates a Payment Link" through "client is fully onboarded with a portal invitation":

1. **Adapter boundary**: `StripeAdapter` (mock/disabled/live), mirroring the `EmailAdapter`/`EnrichmentAdapter` pattern already established in this codebase. No real Stripe credentials exist in this environment; the mock adapter carries the entire internal workflow, including synthetic webhook event builders for every handled event type.
2. **Internal service/plan catalog**: `ServicePlan` (validated string key, not enum), seeded with four starting plans, with a manual Stripe product/price mapping endpoint for when real credentials exist.
3. **Employee-generated Payment Links**: `PaymentLinkRequest`, with base + add-on service plans, gated by `crm.manage_pipeline` (a deliberate choice: acting on one's own opportunity, not a manager-only action).
4. **Idempotent webhook processing**: a `WebhookEvents` ledger keyed by a unique `stripeEventId`, handling `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`. A never-re-throw-past-the-ledger-insert design, with a manual `processWebhookEventById` recovery path for the failure cases that design creates (added after independent review caught that the original "Stripe dashboard resend" recovery assumption doesn't actually work against this ledger).
5. **Race-proof idempotent conversion**: `convertOpportunityToClient`, using a `SELECT ... FOR UPDATE` row lock plus a database-level partial unique index as an independent backstop — proven by directly racing two concurrent calls, not just exercised through the lock's happy path. Used identically by both the webhook path and manual conversion (checks, cash, imported clients, webhook recovery).
6. **Prospect → client conversion**: an in-place `Organization.type` flip (never a copy), with `mergeService` now refusing to merge/undo-merge any opportunity whose organization has already converted — a gap the independent review caught that this feature's own tests wouldn't otherwise have exercised.
7. **Client billing account and subscriptions**: `BillingAccount` + `Subscription` (deliberately named/kept separate from the legacy `UserSubscription`), with add-on plans carried through onto the resulting Subscription, and a Stripe customer portal link endpoint.
8. **Subscription lifecycle sync and failed-payment visibility**: the four lifecycle webhook handlers keep `Subscription.status`/period fields current after the initial checkout, including a `past_due` state that previously would have been invisible; a manager-visible "Billing — Past-Due Subscriptions" dashboard card.
9. **Conversion-needs-attention workflow**: a payment event that can't be resolved to an opportunity (or any other conversion failure) is recorded as `needs_attention`, not silently dropped or thrown as an unhandled error, with a manager-visible worklist.
10. **Automatic client-user invitation**: once a conversion genuinely completes (never on a duplicate no-op), the client organization's primary contact is invited as a `client_owner` portal user via the existing invitation machinery — using a seeded, non-loginable system user as the actor when a webhook (not a person) triggers it.
11. **Frontend**: a Billing panel in the Pipeline UI (Payment Link creation, manual conversion), plus manager-visible "needs attention" and "past-due subscriptions" worklists in the pipeline dashboard.

## Legacy/architecture boundary: "project creation from template" deliberately deferred to Phase 4

The Phase 3 roadmap outcome list includes "project creation from template." This phase deliberately creates **no project-shaped row at all** — an independent architecture review (recorded in `docs/leadzaro/current-phase-plan.md` § 2d) found that a placeholder `ClientProject` stub, created before Phase 4 designs the real `Project` schema (owner/team roles, milestones, tasks, requests, channels, files, activity history — see master architecture § 7/§ 10), would become a permanent artifact Phase 4 would have to awkwardly extend or migrate away from data that was never semantically real. Instead, `ConversionAttempt.projectSetupPending` records the plain fact that project setup is pending, and Phase 4's first migration is documented (both there and in this report) as owning the creation of a real `Project` row for every client organization that doesn't have one yet, including every client converted during Phase 3 before Phase 4 existed. This is a scope boundary, not a missing feature — re-confirmed sound in the final phase review below.

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Same Stripe event never processed twice | `WebhookEvents` unique `stripeEventId`, insert-before-process | `billing.test.js` (duplicate delivery no-op) | Done |
| Same opportunity never converted twice, even under concurrency | Row lock + partial unique index in `convertOpportunityToClient` | `billing.test.js` (direct `Promise.all` race test) | Done |
| Manual and webhook conversion converge on one outcome | Single shared `convertOpportunityToClient` code path | `billing.test.js` (manual-after-webhook no-op, webhook-after-manual implied by the same guard) | Done |
| Unresolvable payment event never silently dropped or unhandled-errors | `recordNeedsAttention`, nullable `ConversionAttempt.opportunityId` | `billing.test.js` | Done |
| Merge/undo-merge refuse a converted client's opportunity | `mergeService` prospect-only guard | `crmMerge.test.js` | Done |
| Cross-agency isolation for every new agency-scoped entity | `agencyOrganizationId` scoping throughout | `billing.test.js` (payment links, conversion attempts, subscriptions worklist) | Done |
| Conversion also flips Opportunity.stage to Closed Won | `convertOpportunityToClient` | `billing.test.js` | Done |
| Subscription lifecycle sync (succeeded/failed/updated/deleted) | `webhookService.js` handlers | `billing.test.js` (5 lifecycle tests + unknown-subscription failure test) | Done |
| A failed lifecycle webhook event is recoverable | `processWebhookEventById`, `billing.manage_webhooks` permission | `billing.test.js` (reprocess success + guard tests) | Done |
| Primary contact invited as client user on conversion, exactly once | `clientInvitationService.triggerClientInvitationIfNew` | `billing.test.js` (5 invitation tests incl. ambiguity and no-double-invite) | Done |
| Add-on plans reach the resulting Subscription | `Subscription.addOnServicePlanIds` | `billing.test.js` | Done |
| PaymentLinkRequest reflects real payment completion | `status: 'paid'` on checkout completion | `billing.test.js` | Done |
| Stripe product/price mapping is administrable | `PATCH /billing/service-plans/:id/stripe-mapping`, `billing.manage_service_plans` | `billing.test.js` | Done |

## Repository changes

### Backend

- Modules/services: `server/modules/billing/` (`conversionService`, `webhookService`, `webhookController`, `paymentLinkService`, `billingController`, `clientInvitationService`, `routes`); `server/core/integrations/stripe/stripeAdapter.js`; `server/core/constants/systemUser.js`; a prospect-only guard added to `server/modules/crm/mergeService.js`.
- Routes/APIs: `/api/v1/billing/*` (service-plans + Stripe mapping, conversion-attempts, subscriptions, webhook-events + reprocess, portal-link), plus opportunity-scoped `/api/v1/crm/opportunities/:id/{payment-links,convert}`. `/api/v1/billing/webhooks/stripe` (unauthenticated, Stripe-signature-verified).
- Authorization: new permissions `billing.manage_webhooks`, `billing.manage_service_plans` (administrator + the Phase-1 placeholder `billing` role); existing `crm.manage_pipeline`/`leads.assign`/`leads.read` reused for the rest, matching established scope (acting on one's own opportunity vs. manager oversight).
- Jobs/events: none (Stripe webhooks are the only external event source this phase introduces; no background job scheduler yet).

### Frontend

- Routes/screens: Billing panel + needs-attention/past-due worklists added to the existing Pipeline screen (no new route).
- State/services: `src/app/core/services/billing.service.ts`, `src/app/core/models/billing.model.ts`.
- Permission behavior: Billing panel actions gated by `crm.manage_pipeline`; worklists gated by `leads.assign` — enforced server-side, frontend only hides the affordance.
- Mobile/accessibility: reuses the Pipeline screen's existing mobile-usable table/card patterns; no new dedicated mobile layout needed.

### Database

- New tables: `ServicePlans`, `WebhookEvents`, `PaymentLinkRequests`, `ConversionAttempts`, `BillingAccounts`, `Subscriptions`.
- Changed tables: `ConversionAttempts` (+`clientInvitationStatus`, +`invitationId`), `Subscriptions` (+`addOnServicePlanIds`), `Users` (+1 seeded system row).
- Indexes/constraints: partial unique index `conversion_attempts_opportunity_completed_unique` on `(opportunityId) WHERE status='completed'` — the actual database-level guarantee behind the phase's major gate. Unique `stripeEventId` on `WebhookEvents`. Unique `stripeSubscriptionId` on `Subscriptions`.
- Backfills: none required (new tables only; the one `Users` row is a fresh seed, not a backfill).
- Rollback behavior: every schema migration has a working `down()`; reference-data seeds (permissions/role grants, the system user) are documented as intentionally not reversed, matching this repo's established precedent (migrations 4 and 12).

## Legacy compatibility

- Preserved workflows: the legacy `SubscriptionPlan`/`UserSubscription` public-SaaS billing model (`server/routes/subscriptions.js`) is untouched — verified directly against current code, not assumed from the repository audit.
- Compatibility adapters: none needed; this is new functionality, not a migration of existing behavior.
- Deprecated fields/routes: none.
- Planned removal phase: N/A.

## Security and privacy

- Secret handling: `.env.example` documents `STRIPE_PROVIDER`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` with placeholder values only; `validateEnv()` refuses to boot in production with `STRIPE_PROVIDER=live` and a missing/placeholder key. No real credentials anywhere in this repository.
- Authentication/session changes: none.
- Authorization/isolation tests: every new agency-scoped entity has a dedicated cross-agency isolation test (`billing.test.js`); the past-due-subscriptions worklist specifically tests the `Subscription -> BillingAccount -> Organization` join that an independent review flagged as a real cross-tenant leak risk if implemented naively.
- Input/file/webhook protections: the Stripe webhook route is signature-verified (`stripe.webhooks.constructEvent` in live mode) and mounted with `express.raw()` before the global JSON parser so signature verification runs against the exact signed bytes.
- Impersonation/audit behavior: every state-changing billing action (payment link creation, manual conversion, Stripe mapping update, webhook reprocessing) is recorded via `recordAudit`.

## Validation commands run

- Dependency install: `npm install stripe` (reviewed diff: 20 lines, zero attributable vulnerabilities via `npm audit --json`).
- Frontend build: `ng build` — clean (only the pre-existing inherited landing-page budget warning).
- Type check/lint: `tsc --noEmit -p tsconfig.app.json` — clean.
- Backend checks: `node -c` syntax check on every new/modified file before each migration run.
- Unit tests: `npm run test:backend` — 87/87 passing (15 suites).
- Integration tests: included in the same backend suite (`billing.test.js`, 26 tests covering payment links, webhook idempotency, the conversion race (both the lock path and the DB-constraint backstop directly), lifecycle sync, invitation, mapping, multi-Payment-Link disambiguation, cross-agency isolation).
- Migration tests: `server/tests/migrations.test.js` — updated for the new seeded system user, passing; migrations applied cleanly to the real dev database (`npx sequelize-cli db:migrate`).
- End-to-end/manual checks: two real headless-Chrome browser sessions against isolated synthetic agencies (first slice: Payment Link creation + manual conversion; this closing pass: full checkout-to-invitation-to-past-due lifecycle, screenshot-and-text-verified), each with synthetic data removed afterward.

## Review pass 1 — architecture and engineering

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | Original conversion-idempotency design was a plain SELECT-then-act check — a real TOCTOU race under concurrency (webhook racing manual conversion) | Row lock (`SELECT ... FOR UPDATE`) + independent DB-level partial unique index backstop | Direct `Promise.all` race test in `billing.test.js` |
| Medium | Proposed `ClientProject` stub risked a bad Phase 4 migration/backfill for data that was never semantically real | Dropped entirely; `projectSetupPending` flag instead; Phase 4 documented as owning real Project creation, including backfill for pre-Phase-4 conversions | Recorded in `current-phase-plan.md` § 2d/7 |
| Medium | `mergeService` had no guard against merging/undoing a converted client's opportunity | Added explicit `organization.type !== 'prospect'` guard to preview/merge/undo-merge | `crmMerge.test.js` |
| High | The "reprocess via Stripe dashboard resend" recovery assumption for a failed webhook event doesn't work — this app's ledger dedupe swallows a resend without ever re-invoking the handler | `processWebhookEventById` manual recovery path, bypassing the ledger's create-based dedupe | `billing.test.js` (reprocess success + not-currently-failed guard) |
| High | Webhook-triggered client invitation had no valid `invitedByUserId` actor (NOT NULL, no system user existed) | Seeded a fixed-id, non-loginable system User | `billing.test.js`, end-to-end browser verification |
| Medium | A naive past-due-subscriptions query would leak every agency's client subscriptions across tenants (`Subscription` has no `agencyOrganizationId` of its own) | Required `Subscription -> BillingAccount -> Organization` join, filtered on `managingAgencyOrganizationId` + `type: 'client'` | `billing.test.js` cross-agency isolation test |
| Low | `MockStripeAdapter.verifyAndParseWebhookEvent` didn't handle the `Buffer` type `express.raw()` actually delivers | Explicit `Buffer.isBuffer` check before `JSON.parse` | Surfaced by integration test, now covered by every webhook test in the suite |

## Review pass 2 — security, QA, final full-phase pass

Completed via a dedicated final-phase `fable-phase-reviewer` pass covering the entire phase (not just the closing increment), specifically re-checking the three gap fixes added after the second slice's own review (payment-link status, add-on carry-through, Stripe mapping endpoint) for any remaining cross-tenant/authorization gap, confirming the roadmap outcome list is now satisfied end-to-end, and confirming the major gate is proven by tests rather than merely designed for.

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | An opportunity can have more than one `PaymentLinkRequest` (a rep re-quoting a different plan); `handleCheckoutCompleted` matched by "most recently created," which would attach the wrong plan/add-ons to the resulting `Subscription` and flip the wrong link's status if an older link was the one actually paid | Match by real Stripe's own `session.payment_link` field against `PaymentLinkRequest.stripePaymentLinkId` when present, falling back to "most recent" only when absent (mock checkouts with no explicit link) | New test: two Payment Links on one opportunity, the older one paid, asserts the correct plan/link is used and the newer link is untouched |
| High | The partial unique index backstop (`conversion_attempts_opportunity_completed_unique`) was never actually exercised by any test — the existing concurrency test only ever exercises the row lock (the second call blocks on the lock and resolves via a plain `findOne` check, never reaching the `INSERT` the index guards) | Added a dedicated test that bypasses `convertOpportunityToClient` (and its lock) entirely, racing two raw `ConversionAttempt.create` calls directly against the table | New test asserts one insert succeeds, one is rejected with `SequelizeUniqueConstraintError`, and exactly one `completed` row survives |
| Medium | The existing concurrency test omitted `servicePlanId`, so no `Subscription` was created in either branch — the "no duplicate subscriptions" half of the major gate had no direct test evidence | Added `servicePlanId` to the existing race test and asserted exactly one `Subscription` row results | Same test, extended |
| Medium | `handleCheckoutCompleted`'s single `try` wrapped both the conversion and the new `linkRequest.update({status:'paid'})` step; a failure in the latter (after a real, successful conversion) would record a spurious `needs_attention` `ConversionAttempt`, misrepresenting a genuine success on the manager-facing worklist | Narrowed the `try` to wrap only `convertOpportunityToClient`; the status-flip step now has its own isolated try/catch that logs and continues rather than retroactively flagging a successful conversion | Code review; existing webhook tests continue to pass unchanged |
| Medium | The new Stripe product/price mapping endpoint had no explicit tenant-scope decision recorded, unlike its three sibling endpoints from the same slice (`ServicePlan` has no `agencyOrganizationId`, so this is intentional platform-global behavior, not a leak — but undocumented) | Added an explicit in-code comment recording the same platform-global reasoning already used for `WebhookEvents`/`listWebhookEvents` | Code review |
| Medium (documentation) | The completion report needed to state explicitly, not silently omit, that "project creation from template" (a listed Phase 3 roadmap outcome) is deliberately deferred to Phase 4 | Already addressed by this report's "Legacy/architecture boundary" section above; re-confirmed sound by this review with no new information changing that judgment | N/A |

No Critical findings. All High findings resolved and verified above; `npm run test:backend` re-run at 87/87 passing (was 85) after these fixes.

## Regression verification

Every Phase 1/2 test suite re-run unchanged and passing alongside the new Phase 3 suites: authentication/sessions, organization isolation, RBAC combination/overrides, invitations, impersonation, CRM (opportunities, merge, scoring, dashboard, website audit, enrichment), public inbound leads, and the full migration test suite (empty-DB apply, full rollback/re-migrate, two legacy-collision backfill scenarios). 87/87 backend, 18/18 frontend.

## Data migration evidence

- Empty DB result: all migrations through this phase's closing migration apply cleanly to an empty database (`migrations.test.js`).
- Legacy DB result: N/A — this phase introduces no legacy-data backfill (new tables only).
- Record counts before/after: N/A for the same reason.
- Duplicate/loss checks: the partial unique index and the direct concurrency test are the duplicate-prevention evidence for this phase's actual gate.
- Rollback test: `migrations.test.js`'s full-rollback-and-re-migrate test now expects the two permanently-seeded users (demo-client + system), verified against the real re-migrated schema.

## Manual configuration required

See `docs/leadzaro/setup/stripe-setup.md` for the full walkthrough. Summary: create a real Stripe account, set `STRIPE_PROVIDER=live` + real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in the untracked `.env`, register the webhook endpoint for the five handled event types, and map each `ServicePlan` to a real Stripe product/price via `PATCH /billing/service-plans/:id/stripe-mapping`. No secret values are or will be committed.

## Deferred backlog

### Medium priority

- A dedicated frontend screen for the Stripe product/price mapping (currently a tested, permission-gated API endpoint only — a one-time, rarely-changed setup step, not a day-to-day workflow).

### Low priority

- None currently tracked.

### Deliberately deferred to later phase

- Project creation from template (see "Legacy/architecture boundary" above) — Phase 4's first obligation, including backfilling a real `Project` for every client organization converted during Phase 3.
- Full entitlements/feature-gating consuming add-on plans (Phase 3 carries add-ons through to the `Subscription` row; which features an add-on actually unlocks is Phase 8's "entitlement-gated SEO dashboard" territory and later phases' own gated modules).

## Known risks

- Stripe's exact Invoice/Subscription field-path assumptions (`invoice.subscription`, `current_period_start/end`) have not been exercised against a real Stripe account (no credentials in this environment) and should be re-verified against whichever Stripe API version this integration is eventually pinned to.
- If a lifecycle webhook event references a `stripeSubscriptionId` this app has never seen (out-of-order delivery, or a subscription created outside this app's own Payment Link flow), it is recorded as a failed `WebhookEvent` for manual reprocessing rather than automatically reconciled — an accepted, documented scope boundary, not a silent gap.

## Documentation updated

- README: not applicable (no root README changes needed for this phase).
- Architecture decisions: `docs/leadzaro/current-phase-plan.md` §§ 1–8 (evidence audit, both reviewed design passes, implementation results).
- API docs: none formal; routes are documented inline via the phase plan and this report's acceptance matrix.
- Migration docs: inline comments in each new migration explaining its purpose and idempotency guarantee.
- User/admin instructions: `docs/leadzaro/setup/stripe-setup.md` (new).

## Readiness for next phase

- Ready: Yes
- Blocking reasons: none
- Recommended next-phase starting point: Phase 4 — Agency Operations and Website Guys Client Portal. First obligation: backfill a real `Project` row for every existing client `Organization` (including every Phase 3 conversion, tracked via `ConversionAttempt.projectSetupPending`).
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (to be rewritten for Phase 4 immediately after this report is finalized).
