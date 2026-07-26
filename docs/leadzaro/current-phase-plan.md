# Phase 2 Continuation Plan — Enrichment Adapter

This overwrites the prior Phase 2 working plan (preserved in git history), which covered public landing pages/inbound forms. This document covers item 5 from `docs/leadzaro/NEXT_PHASE_PROMPT.md`'s remaining-items list — "Manual/optional enrichment adapter."

## 1. Evidence audit

- No enrichment concept existed anywhere in the codebase. The roadmap explicitly scopes this as "external API — interface + mock/disabled mode only, per the standing external-services rule; do not block on missing credentials," i.e. this slice is deliberately not a real vendor integration.
- `server/core/notifications/emailAdapter.js` already establishes the exact pattern to reuse: an abstract base class, concrete mock/disabled implementations, and a cached factory function gated by env config with a production-safety fallback.

## 2. Design decisions

- **Mirrors the email adapter pattern exactly**: `EnrichmentAdapter` (abstract) → `MockEnrichmentAdapter` / `DisabledEnrichmentAdapter`, selected by `ENRICHMENT_PROVIDER` via `getEnrichmentAdapter()`.
- **Production defaults to disabled, not mock.** Unlike a missing email provider (which just means notifications silently don't send — a availability concern), showing *fabricated* business data to a real sales team as if it came from a real vendor would actively mislead them. `env.ENRICHMENT_PROVIDER` defaults to `'disabled'` in production and `'mock'` in development/test, with an explicit warning logged if an operator overrides it to `'mock'` in production anyway.
- **The mock adapter's output is self-labeling.** Every mock result includes a `note` field stating plainly that it's demonstration data with no real provider configured — this is surfaced directly in the UI, not just buried in a field nobody reads.
- **One `Enrichment` row per opportunity, regenerated in place** — same pattern as `WebsiteAudit`.
- **Never throws for "not configured"/"no data."** `enrich()` returns a structured `{ status, provider, data }` result for every normal outcome; only genuinely unexpected failures should throw. This matches the standing external-services rule's "structured errors, no silent failures" requirement while keeping "we don't have a provider yet" from looking like a bug.

## 3. Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Typed adapter interface, not tightly coupled to a vendor | `EnrichmentAdapter` base class | `crmEnrichment.test.js` (unit) | Done |
| Mock mode, clearly labeled as demo data | `MockEnrichmentAdapter` | `crmEnrichment.test.js` (unit + integration) | Done |
| Disabled mode (production default), no fabricated data | `DisabledEnrichmentAdapter` + `env.ENRICHMENT_PROVIDER` default | `crmEnrichment.test.js` (unit) | Done |
| One enrichment per opportunity, regenerate-in-place | `enrichmentService.enrichOpportunity` | `crmEnrichment.test.js` | Done |
| Tenant-scoped (agency isolation) | `getOpportunityInAgency` | `crmEnrichment.test.js` cross-agency test | Done |
| Surfaced in the Pipeline UI, not just the API | `crm-pipeline.component.*` toggleable panel | Real headless-Chrome session, isolated synthetic org | Done |

## 4. Testing performed

- `npm run test:backend`: 60/60 passing (14 suites) — up from 56.
- `ng test`: 18/18 passing (unchanged — no new frontend unit specs needed).
- `ng build`: clean (only the pre-existing inherited landing-page budget warning).
- Real headless-Chrome session against an isolated, purpose-created synthetic agency: requested enrichment, confirmed the mock provider badge, the demo-data disclaimer note, and the industry field all rendered correctly. Synthetic data removed afterward.

## 5. Remaining Phase 2 backlog (unchanged, still deferred)

Assisted outreach sequences, optional territories, saved search campaigns, Contact/Location management UI.
