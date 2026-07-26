# Claude Code Phase 3 Prompt — Stripe Billing and Client Conversion

Phase 2 (CRM foundation, scoring, dashboard, website audits, public acquisition, enrichment adapter) is complete, twice-reviewed at every slice, independently reviewed by `fable-phase-reviewer` twice for its highest-risk decisions, tested (60/60 backend, 18/18 frontend), and checkpointed — see `docs/leadzaro/phase-2-completion-report.md`. This is the first genuinely new phase boundary since Phase 1, scoped per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` § "Phase 3" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` § 9 ("Payment and client conversion") — re-read both, and the current repository, before trusting anything else in this prompt.

## What Phase 2 actually delivered (the foundation Phase 3 builds on — re-verify, don't assume)

- `Opportunity` is the pipeline object Phase 3's Payment Link generation hangs off of. It already has `stage` (validated reference list, `CLOSED_STAGES` includes `'Closed Won'`), `score`/`scoreReason`, `organizationId` (the prospect `Organization`), `agencyOrganizationId` (tenant scope — every new Phase 3 table needs this same denormalized column, not a join through the prospect org).
- The prospect `Organization` this opportunity belongs to is a real `Organization` row with `type: 'prospect'` and `managingAgencyOrganizationId`. "Convert organization to client" (architecture § 9) means changing `type` to `'client'` on this same row — re-read ADR 0006 before assuming otherwise; Option B (one prospect org per agency, never shared) means this conversion only ever affects the single agency that owns this prospect, which is exactly what makes it safe.
- `AuditLog`, `Notification`/`getEmailAdapter()`, and the adapter-interface pattern (`EmailAdapter`/`EnrichmentAdapter` in `server/core/notifications/` and `server/core/integrations/enrichment/`) are the established templates for building a `StripeAdapter` — typed interface, mock mode, production-safe default, never a silent failure.
- `Invitation`/`server/core/security/tokens.js` (hashed-at-rest tokens) is the established pattern for "invite the primary client user" — reuse it, don't build a second token scheme.
- Test helpers: `server/tests/helpers/factory.js`, `globalSetup.js` (fresh disposable DB per run) — reuse directly.
- `.env.example` already has `STRIPE_SECRET_KEY=sk_test_placeholder` / `STRIPE_WEBHOOK_SECRET=whsec_placeholder` — both are placeholders. No real Stripe credentials (even test-mode ones) exist in this environment. Per the standing external-services rule, build a `StripeAdapter` interface with a mock/simulated implementation first; do not block on missing credentials.

## Phase 3 primary outcomes (from the roadmap — verify scope against it directly)

- Internal service and plan catalog; configurable subscription plans; add-ons/entitlements.
- Stripe products/prices mapping; employee-generated Payment Links from an Opportunity.
- **Idempotent Stripe webhook processing + a webhook event ledger** — this is the phase's major gate ("the same Stripe event must never create duplicate clients, projects, subscriptions, or invitations"). Design the idempotency key/ledger table before writing any webhook handler code.
- Opportunity payment states.
- Automatic conversion (via the webhook flow above) and manual conversion (checks, cash, imported clients, custom agreements, or webhook recovery) — both must be genuinely idempotent, not just the automatic path.
- Organization transition from prospect to client (a `type` change on the existing prospect `Organization` row, not a new entity).
- Client billing account; Stripe customer portal link; subscription synchronization; failed payment states.
- Project creation from template; invitation of the primary client user (reuse the `Invitation` model/flow).
- A "conversion needs attention" workflow for the cases that can't complete cleanly (payment succeeded but something downstream failed, mismatched customer, etc.) — this is not optional polish, it is the safety valve the major gate depends on.

## Phase 3 non-goals (do not start these)

Full project/task board (Phase 4), website builder (Phase 5), code generation (Phase 6), production deployment (Phase 7), SEO (Phase 8). Real Stripe charges of any kind — CLAUDE.md permanently forbids "real Stripe charges" regardless of phase; everything here must run against Stripe test-mode credentials once provided, or the mock adapter until then.

## Before writing code

1. **Escalate the webhook-idempotency and conversion-flow design to `fable-phase-reviewer` before writing migration or webhook-handling code.** This is exactly the "major architecture/billing/migration" category CLAUDE.md's escalation rule names explicitly, and mirrors how Phase 2's prospect-organization-per-agency decision (ADR 0006) and the merge/duplicate-detection feature were each escalated before implementation, not after — both times real issues were caught before any code existed to unwind. At minimum, the escalation should resolve: the shape of the webhook event ledger (what makes an event "the same" — Stripe's event id alone, or event id + type + object id), how manual conversion and webhook-triggered conversion share one idempotent code path rather than two divergent ones, and what "needs attention" state machine actually looks like.
2. Re-run Phase 2's acceptance gates once more to confirm nothing has drifted (`npm run test:backend`, `ng test`, `ng build`) — a fresh phase boundary's job even if this prompt says they passed.
3. Produce `docs/leadzaro/current-phase-plan.md` (overwrite — it's a per-phase working document; every prior version is preserved in git history) with an evidence audit and acceptance matrix before writing the first migration.
4. Build the `StripeAdapter` interface (mirroring `EmailAdapter`/`EnrichmentAdapter`) with a mock/simulated mode before any real Stripe SDK call is wired in — this lets the entire internal workflow (plan selection → Payment Link → simulated webhook → idempotent conversion → project/user creation → portal invitation) be built and tested end-to-end without real credentials, exactly as Phase 2 did for email and enrichment.
5. Never charge a real card, never use live Stripe keys, never process a real webhook from production Stripe — CLAUDE.md is permanent and unconditional on this point regardless of what credentials eventually get configured.
