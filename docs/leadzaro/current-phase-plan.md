# Phase 3 Implementation Plan — Stripe Billing and Client Conversion

## 1. Evidence audit

### What already exists (verified against current code, not assumed)

- `SubscriptionPlan` (`server/models/SubscriptionPlan.js`) and `UserSubscription` (`server/models/UserSubscription.js`) are the **legacy public-SaaS self-serve billing model** from before the pivot to an agency-operations platform: `SubscriptionPlan.name` is a hard enum (`'Free Trial'|'Starter'|'Pro'|'Agency'`), and `UserSubscription` is owned by a `User` (not an `Organization`), with `organizationId` explicitly documented in-model as "a documented temporary association, not the final billing model." `server/routes/subscriptions.js` / `server/controllers/subscriptionController.js` back the legacy `/api/subscriptions/*` routes; `upgradePlan` has never done anything real with Stripe (per the original repository audit, it returned 501).
- Per the repository audit and CLAUDE.md: "The old public SaaS behavior should be feature-flagged or archived, not mixed into agency billing." **This phase does not touch, extend, or migrate the legacy model.** It is left exactly as Phase 1 left it (organization-scoped for compatibility, still self-service, still ungated) per the strangler pattern (ADR 0005) — untouched legacy code, not a new dependency. Independently re-verified (not just asserted): `subscriptions.js` is gated only by the universally-granted `profile.manage` permission (self-service, ungated), consistent with leaving it alone.
- Master architecture § 7 ("Client and project domain") describes billing as a sub-entity of a **Client Organization**: `Billing Account`, `Subscriptions`, and `Projects` all hang off the organization once it becomes a client — mirroring exactly how Phase 2's CRM entities hang off a prospect organization. This is the real, current-architecture billing model Phase 3 must build, entirely separate from the legacy `UserSubscription`.
- No `Project` model exists anywhere in the codebase yet — "projects, templates, stages" is explicitly Phase 4 scope. See § 2d for the resolved boundary (Phase 3 creates no project-shaped row at all).
- No Stripe SDK call has ever been made from this codebase. `.env.example` has only placeholder Stripe keys — no real test-mode credentials exist in this environment.
- Existing adapter-interface precedent to reuse directly: `server/core/notifications/emailAdapter.js` and `server/core/integrations/enrichment/enrichmentAdapter.js`. `StripeAdapter` follows this exact pattern.
- `Invitation` + `server/core/security/tokens.js` (hashed-at-rest tokens) is the established pattern for inviting a new user — reused directly for "invitation of the primary client user."
- `AuditLog` + `recordAudit()` is the established pattern for immutable action history — reused for conversion history, per master architecture § 7's "Conversion History" being listed under the prospect Organization.
- `resolveContext()`/`loadActiveMemberships()` never inspects `organization.type` when loading memberships, and `impersonationService` scopes purely by `type`/`managingAgencyOrganizationId`/`status` — confirmed nothing assumes "prospect implies no memberships," so § 2c's in-place `type` flip needs no authorization-layer changes.

## 2. Key architecture decisions — reviewed by `fable-phase-reviewer` before any migration/webhook code was written; this section reflects the corrected, accepted design

### 2a. The webhook event ledger and idempotency key — accepted as proposed

A `WebhookEvents` table keyed by a **unique** `stripeEventId`. Processing a webhook is a genuine `INSERT ... ON CONFLICT (stripeEventId) DO NOTHING` / catch-unique-violation *before* any side-effecting work runs — not a `SELECT exists` followed by a conditional insert, which would itself race. Only after that insert succeeds does the handler proceed, updating the same row's `status` to `'processed'`/`'failed'` at the end.

### 2b. One idempotent conversion code path — accepted with a required correction (the review found a real TOCTOU race here)

The webhook ledger in 2a only prevents the *same Stripe event id* from processing twice. It does nothing to stop two *different* events (e.g. `checkout.session.completed` and `payment_intent.succeeded` for the same purchase, or a manual "mark paid by check" racing a webhook) from each passing their own ledger check and then racing on a shared plain-SELECT business-level check — a textbook race that could produce two conversions for one opportunity, i.e. exactly the phase's major gate failing.

**Corrected design:**
1. `convertOpportunityToClient` locks the `Opportunity` row at the start of its transaction (`SELECT ... FOR UPDATE`) so concurrent calls for the same `opportunityId` serialize instead of interleaving.
2. A database-level backstop independent of the lock: a **partial unique index on `ConversionAttempts(opportunityId) WHERE status = 'completed'`**, mirroring the existing `opportunities_agency_lead_active_unique` pattern. The lock prevents the race in the common case; the constraint guarantees correctness even if the lock is bypassed or a future code path forgets it.
3. `convertOpportunityToClient` catches that unique-violation and returns the existing completed `ConversionAttempt` instead of erroring — the same "someone else already did this, return their result" shape the webhook ledger uses.
4. **`convertOpportunityToClient` also transitions `Opportunity.stage` to `'Closed Won'` inside the same transaction** — the review flagged that leaving this unstated risks a converted client whose opportunity still shows an earlier stage, which would look like a CRM bug and skew the dashboard's win-rate/stage-count numbers.

### 2c. The prospect→client transition — accepted as proposed, with one required follow-on fix elsewhere

A `type` change (`'prospect'` → `'client'`) on the same `Organization` row. Confirmed safe by reading the actual authorization code (see § 1). **Required correction found by the review**: `mergeService.previewMerge`/`merge`/`undoMerge` never check `organization.type` — once an organization converts, nothing stops an employee from later "merging" that live client's opportunity as a winner or loser, silently moving Contacts/Locations onto/off a real client or archiving the opportunity that represents a completed conversion. Fix: add an explicit guard rejecting any winner or loser whose `organization.type !== 'prospect'` in all three merge-service functions.

### 2d. The Phase 3/Phase 4 boundary — the proposed `ClientProject` stub is rejected; Phase 3 creates nothing project-shaped

The review's reasoning, which this plan accepts in full: Phase 4 owns the actual shape of a Project (§7's `Owner and Team Roles / Milestones and Stages / Tasks / Requests / Channels / ... / Activity History` tree), which doesn't exist yet. A placeholder `ClientProject(organizationId, name, status: 'pending_setup')` row created on every conversion becomes a permanent artifact Phase 4 must either awkwardly extend against a shape it didn't choose, or backfill/migrate away for data that was never semantically real. Phase 4 will need to write a migration creating real `Project` rows for every already-converted client anyway (since some clients convert during Phase 3, before Phase 4 exists) — that migration is better owned entirely by Phase 4, at the point the real schema is actually being designed.

**Resolved: conversion records "project setup is pending" as a plain fact** (a field on `ConversionAttempt`, not a stub table) and Phase 4's kickoff prompt will document that its first migration owns creating the initial Project for every client organization that doesn't have one yet, including pre-Phase-4 conversions.

### 2e. Payment Link metadata — accepted with a required clarification

`leadzaroOpportunityId`/`leadzaroAgencyOrganizationId` embedded in Stripe metadata at Payment Link creation is right for the **bootstrap event only** (mapping the very first Checkout Session/PaymentIntent back to an Opportunity). **Clarification required by the review and now part of the design**: every subsequent lifecycle event (`invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`) is matched by the already-stored `stripeSubscriptionId`/`stripeCustomerId` on the `Subscription`/`BillingAccount` rows, never by re-deriving from event metadata — Stripe does not guarantee Payment-Link metadata propagates to every downstream event type.

**Additional required handling**: a payment-completed event whose Checkout Session/PaymentIntent has no resolvable `leadzaroOpportunityId` (Dashboard-created invoice, customer self-serve portal action, missing metadata) is a real, foreseeable input — not hypothetical. `ConversionAttempt.opportunityId` is nullable specifically to record this case as `needs_attention` with a clear `failureReason` rather than silently no-op'ing or throwing an unhandled error.

**Documented, explicitly out of scope**: if a Payment Link is reused/forwarded and paid twice, the app-level idempotency design correctly prevents a duplicate client/subscription, but Stripe will still have processed a real duplicate charge to the customer. That's a business/ops refund concern, not a code defect this phase addresses — noted here so a future support ticket about it isn't mistaken for an idempotency failure.

### 2f. New models — accepted as proposed, minus `ClientProject` (see § 2d), plus the nullable-opportunity handling from § 2e

- `ServicePlan` — internal service/plan catalog (validated string `key`, not enum). `stripeProductId`/`stripePriceId` nullable until synced.
- `PaymentLinkRequest` — one per employee-initiated Payment Link; `opportunityId`, `agencyOrganizationId`, `servicePlanId`, `stripePaymentLinkId`/`Url`, `status`.
- `WebhookEvent` — the ledger described in § 2a.
- `ConversionAttempt` — `opportunityId` (**nullable** — see § 2e), `agencyOrganizationId` (nullable when the opportunity can't be resolved), `status: 'completed' | 'needs_attention' | 'failed'`, `failureReason`, `resultingClientOrganizationId`, `projectSetupPending` (boolean, replaces the rejected `ClientProject` stub). Partial unique index on `(opportunityId) WHERE status = 'completed'` (§ 2b).
- `BillingAccount` — one per client Organization; `stripeCustomerId`.
- `Subscription` — belongs to a `BillingAccount`; `stripeSubscriptionId`, `status`, `currentPeriodStart/End`. Deliberately named differently from the legacy `UserSubscription`.

## 3. Testing priorities

1. Webhook idempotency: the same `stripeEventId` delivered twice must never process twice.
2. **The corrected § 2b race**: two concurrent conversion attempts for the same opportunity (simulating a webhook racing a manual conversion) must result in exactly one completed `ConversionAttempt`, proven against the partial unique index, not just against the row lock (a test that bypasses/races past the lock should still hit the constraint).
3. Manual conversion after a webhook already converted the same opportunity is a no-op, and vice versa.
4. A payment event with no resolvable opportunity produces a `needs_attention` `ConversionAttempt` with a null `opportunityId`, not a silent no-op or an unhandled error.
5. `mergeService` rejects merging a winner/loser whose organization has already converted to `type: 'client'`.
6. Cross-agency isolation re-proven for every new agency-scoped entity (`ServicePlan`, `PaymentLinkRequest`, `ConversionAttempt`).
7. Converting an opportunity also transitions its stage to `'Closed Won'` atomically.
8. Regression: every Phase 1/2 workflow continues to pass unchanged.

## 4. External services

No real Stripe credentials exist in this environment. `server/core/integrations/stripe/stripeAdapter.js` follows the `EmailAdapter`/`EnrichmentAdapter` pattern: a typed interface, a `MockStripeAdapter` that simulates Payment Link creation and can synthesize a matching webhook event for end-to-end testing, selected by config, production-safe default, never a silent failure. The full internal workflow is built and tested against the mock before any real Stripe call exists.

## 5. Implementation results (this slice: Payment Links, webhook processing, idempotent conversion)

- All six corrected decisions (§ 2a–2f) implemented as designed; every testing-priority item in § 3 has a passing test, including the corrected race (two concurrent `convertOpportunityToClient` calls for the same opportunity resolve to exactly one `completed` `ConversionAttempt`, proven by directly racing the service function with `Promise.all`, not just exercised through the lock's happy path).
- A real bug surfaced by browser/integration testing, not just unit tests: `MockStripeAdapter.verifyAndParseWebhookEvent` only handled a JSON string or an already-parsed object, but the real webhook route (mounted with `express.raw()`, required so Stripe's signature check runs against the exact signed bytes) hands it a `Buffer` — which was silently treated as if it were already the parsed event, producing `undefined` ids that only surfaced as a confusing generic validation error several layers downstream. Fixed to explicitly handle `Buffer`/string/object.
- The webhook route (`app.post('/api/v1/billing/webhooks/stripe', express.raw(...), ...)`) had to be mounted in `app.js` *before* the global `express.json()` middleware — the first genuinely new wiring pattern in this codebase's `app.js`, documented in-line.
- A deliberate failure-handling decision made during implementation, not explicitly spelled out in the original plan: once the `WebhookEvents` ledger insert succeeds, `processWebhook` never re-throws, even if the handling logic afterward fails unexpectedly. Re-throwing at that point would make the caller return an error status, Stripe would retry the same event, and that retry would immediately hit the ledger's own duplicate-suppression path and no-op — turning a transient failure into a permanently unprocessed event instead of a retried one. A failure past that point is recorded as `status: 'failed'` on the ledger row for a human to investigate; only a signature-verification failure (before any ledger row exists) still propagates as an HTTP error.
- Manual conversion and Payment Link creation are gated by `crm.manage_pipeline` (the same permission every sales rep already holds for managing their own pipeline), not a manager-only permission — a deliberate choice, not an oversight: a rep closing their own deal (including recording a check/cash payment) is normal expected activity, materially different from the Phase 2 dashboard mistake (which was about leaking *other people's* data to every rep, not about a rep acting on their own opportunity).
- `getCustomerPortalLink` reuses the exact tenant-scoping pattern already proven for impersonation (`managingAgencyOrganizationId` + `type: 'client'`) rather than a new pattern; not given its own dedicated test given how directly it mirrors already-tested code, but flagged here for visibility rather than silently assumed safe.
- Verified with a real headless-Chrome session against an isolated synthetic agency: created an opportunity, opened the new Billing panel, created a Payment Link (mock, with a copyable URL), and manually converted the opportunity to a client — independently confirmed via direct model query that the organization's `type` flipped to `client`, the opportunity's `stage` flipped to `Closed Won`, and the `ConversionAttempt` recorded `status: 'completed', source: 'manual'`. Synthetic data removed afterward.
- `npm run test:backend`: 68/68 passing (15 suites, +7 for this slice). `ng test`: 18/18 passing (no new frontend unit specs needed — covered by the real browser session instead, matching this codebase's established convention). `ng build`: clean (only the pre-existing inherited landing-page budget warning).
