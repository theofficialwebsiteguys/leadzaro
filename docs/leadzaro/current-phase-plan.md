# Phase 2 Continuation Plan — Public Landing Pages, Inbound Forms, UTM Attribution

This overwrites the prior Phase 2 working plan (preserved in git history), which covered website audits. This document covers item 4 from `docs/leadzaro/NEXT_PHASE_PROMPT.md`'s remaining-items list — "Public landing pages + inbound forms + UTM/source attribution."

## 1. Evidence audit

- Master architecture § 20 ("Public acquisition") lists nine distinct offers ($99/month websites, custom websites, free audit, local services, restaurants, automotive, professional services, redesigns, ongoing management) and asks that submissions record landing page, UTM parameters, ad campaign, requested service, form progress, submission, payment link, conversion, and recurring revenue.
- Payment link/conversion/recurring-revenue are Stripe/billing concerns — explicitly Phase 3 scope, not built here. This slice covers capture and CRM funneling only.
- `Contact` and `Opportunity` already existed from the Phase 2 foundation with no management UI — this is the first real write path for `Contact` outside of the merge feature and test fixtures.
- `Opportunity.sourceLeadId` was already nullable ("manually-created opportunities may have none" — a comment written before this slice existed) — this is the first real use of that nullability: an inbound-form Opportunity has no canonical Google Place behind it.

## 2. Design decisions

- **One flexible landing-page component, not nine bespoke pages.** `server/core/crm/inboundCampaigns.js` / `src/app/core/models/inbound.model.ts` hold a validated reference list (slug, headline, subhead) — matching the pipeline-stage-catalog reasoning (a new campaign is a data change, not a code change). All nine offers from the architecture doc are represented as data.
- **Always resolves to a single default agency**, not a caller-selected one — a public visitor doesn't choose which agency they're contacting. `server/core/crm/defaultAgency.js` resolves it as "the oldest active agency-type Organization" rather than hard-coding a name/id, matching CLAUDE.md's standing instruction not to hard-code The Website Guys throughout domain logic. Verified by a dedicated test that creates other agencies afterward and confirms resolution is unaffected.
- **No canonical `Lead` for inbound submissions.** `opportunityService.createFromLead` always upserts a `Lead` (a Google Place); inbound submissions have no Google Place behind them, so a new, separate `inboundLeadService.submitInboundLead` creates the prospect Organization/Opportunity/Contact directly, with `sourceLeadId: null`.
- **The submitted contact becomes a real `Contact` row**, not a duplicated set of fields on a new table — reusing the Contact model built (but never written to outside tests) during the CRM foundation slice.
- **Honeypot instead of CAPTCHA.** A hidden, off-screen, `tabindex="-1"`, `aria-hidden` form field that must stay empty; if filled, the submission is silently discarded but reports the same success response, so a bot doesn't learn it was caught. Paired with a dedicated, stricter rate limiter (`publicFormLimiter`, 10/15 min) on top of the existing global one. No paid anti-spam service required for a v1, per the standing external-services rule.
- **A gap I found in my own review, not a request:** the whole point of capturing UTM/campaign attribution is for someone at the agency to actually see it, but the initial implementation never surfaced `InboundSubmission` through the existing opportunity list/detail endpoints. Fixed by adding it to `opportunityService.listForAgency`'s and `getInAgency`'s includes, and added a small "Inbound · {slug}" line under the business name in the Pipeline table (with UTM detail in a tooltip) — otherwise this feature would have captured data nobody could ever see.

## 3. Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Nine campaign landing pages, driven by data not bespoke code | `inboundCampaigns.js` / `inbound.model.ts` | Manual review of all nine entries | Done |
| Public, unauthenticated submission endpoint | `POST /api/v1/public/inbound-leads` | `publicInboundLead.test.js` | Done |
| Creates Organization + Opportunity + Contact + InboundSubmission | `inboundLeadService.submitInboundLead` | `publicInboundLead.test.js` | Done |
| Resolves to a single default agency, not hard-coded | `defaultAgency.js` | `publicInboundLead.test.js` | Done |
| Honeypot silently discards spam with an identical success response | `submitInboundLead` early-return | `publicInboundLead.test.js` | Done |
| UTM/referrer captured client-side and persisted | `InboundLeadService.captureAttribution` + `InboundSubmission` columns | `publicInboundLead.test.js` + real browser session with UTM query params | Done |
| Rate-limited against abuse | `publicFormLimiter` | Manual code review (not load-tested) | Done |
| Attribution actually visible to the agency | `listForAgency`/`getInAgency` includes + Pipeline UI badge | `publicInboundLead.test.js` (list + detail assertions) | Done |
| Public page reachable by a genuinely anonymous visitor | `PublicLandingComponent`, no guard | Real headless-Chrome session, cookie-less context | Done |

## 4. Testing performed

- `npm run test:backend`: 56/56 passing (13 suites) — up from 52.
- `ng test`: 18/18 passing (unchanged from the website-audit slice — no new frontend unit specs needed beyond what was already covered).
- `ng build`: clean (only the pre-existing inherited landing-page budget warning).
- Real headless-Chrome session against the actual dev database (unavoidable — the public endpoint always resolves to the real default agency, there's no synthetic-org escape hatch for this one): visited `/get-started/free-audit?utm_source=google&utm_medium=cpc&utm_campaign=smoketest-campaign` in a fresh, cookie-less browser context, confirmed it did not redirect to `/login` (re-confirming the auth-interceptor fix generalizes to this new public route too), submitted the form, confirmed the success state, then independently verified via direct model query that the resulting Contact/Opportunity/InboundSubmission were created correctly under the real "The Website Guys" agency with the right UTM values — and immediately deleted all of it. No trace left in real data.

## 5. Remaining Phase 2 backlog (unchanged, still deferred)

Enrichment adapter, assisted outreach sequences, optional territories, saved search campaigns, Contact/Location management UI (though this slice's inbound form is now the first real write path for Contact — a full management UI for editing/listing Contacts directly is still not built).
