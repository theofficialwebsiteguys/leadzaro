# Phase 2 Continuation Plan — Website Audits

This overwrites the prior Phase 2 working plan (preserved in git history), which covered scoring and the sales dashboard. This document covers the next slice: item 3 from `docs/leadzaro/NEXT_PHASE_PROMPT.md`'s remaining-items list — "Website audits + shareable report."

## 1. Evidence audit

- No `WebsiteAudit` (or equivalent) model, table, or route existed anywhere in the codebase before this slice.
- The roadmap's "shareable report" language directly parallels Phase 1's invitation-link mechanism (`Invitation.tokenHash`, `server/core/security/tokens.js`'s `generateRawToken`/`hashToken`) — reused verbatim rather than inventing a second token scheme.
- `Lead` already carries `hasWebsite`, `website`, `rating`, `reviewCount`, `category` — enough to generate a genuinely useful report without needing any new data source.

## 2. Design decisions

- **No live fetch of the prospect's website.** Making the server issue outbound HTTP requests to an arbitrary lead/caller-supplied URL is a real SSRF surface (internal network/cloud-metadata access) — safely defending against that (hostname/IP allowlisting, per-redirect validation, timeouts) is substantial, security-critical work of its own, not something to bolt on as a side effect of a reporting feature. Per the standing external-services rule ("build the adapter interface + a real, useful mock/rule-based mode first, don't block on a live integration"), `server/core/crm/websiteAuditor.js` generates a genuinely useful report from data already on file (has-a-website, HTTPS scheme, Google review signals) in the same `{ score, summary, checks }` shape a future live-fetch implementation would return, so callers never need to change when that lands.
- **Regenerating an audit updates the same row and keeps the same share link working**, rather than minting a new link every time — a prospect's bookmarked/forwarded link shouldn't break just because the sales rep refreshed the report.
- **The share token is hashed at rest** (SHA-256, same as `Invitation.tokenHash`), which means the server can never redisplay a previously-issued raw token. This creates a real, deliberately-accepted UX trade-off: if the link is lost, the only way to get a working one again is `rotate-link`, which invalidates the old one — mirroring `invitationService.resendInvitation`'s token rotation exactly.
- **The public report route exposes only report fields** (business name, website, score, summary, checks, generated-at) — never `opportunityId`, `agencyOrganizationId`, assignee, or any other internal CRM identifier, verified by a dedicated test asserting the exact key set of the public response.

## 3. A real bug found and fixed along the way (not scope creep — it blocked this feature)

Manual browser verification of the new public report page (visited from a genuinely anonymous, cookie-less browser context, simulating a real prospect) found that it redirected straight to `/login` instead of rendering. Root cause: `src/app/core/interceptors/auth.interceptor.ts` had a `catchError` with two `if (err.status === 401)` checks — the second one fired unconditionally on **any** 401, including the silent bootstrap-refresh call every page load makes (`AuthService.bootstrap()`, wired into `app.config.ts`'s `provideAppInitializer`), which normally 401s for any anonymous visitor as its expected, correct outcome. That 401 was being treated as "your session just died, force a logout and redirect" for every public page load — landing, login, register, accept-invite, and now the audit report — not just this new one.

Fixed by making the exempt-endpoint check (`AUTH_RETRY_EXEMPT`, which already existed and already correctly covered `/api/v1/auth/refresh`) short-circuit before the forced-redirect branch, so an expected 401 from a background/anonymous call never triggers a logout or navigation. Added `src/app/core/interceptors/auth.interceptor.spec.ts` (no prior spec existed for this interceptor) covering: an exempt 401 does not redirect, a non-exempt 401 with no token does redirect, and a non-exempt 401 with a token attempts a silent refresh before giving up.

## 4. Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Rule-based audit (no live fetch) | `server/core/crm/websiteAuditor.js` | `crmWebsiteAudit.test.js` | Done |
| One audit per opportunity, regenerate-in-place | `websiteAuditService.generateAudit` | `crmWebsiteAudit.test.js` | Done |
| Share link hashed at rest, stable across regeneration | `WebsiteAudit.shareTokenHash` + `generateAudit` | `crmWebsiteAudit.test.js` | Done |
| Lost link recoverable via explicit rotation | `POST .../website-audit/rotate-link` | `crmWebsiteAudit.test.js` | Done |
| Public report exposes only report fields | `websiteAuditService.getPublicByToken` | `crmWebsiteAudit.test.js` (asserts exact key set) | Done |
| Public route reachable pre-authenticate | `routes.js` route ordering (mirrors invitations) | Real anonymous-browser-context verification | Done |
| Audit/generate/view scoped to caller's agency | `getOpportunityInAgency` | `crmWebsiteAudit.test.js` cross-agency test | Done |
| Public audit page renders for a real anonymous visitor | `PublicAuditComponent` | Real headless-Chrome session, isolated browser context | Done (after the interceptor fix above) |

## 5. Testing performed

- `npm run test:backend`: 52/52 passing (12 suites) — up from 48.
- `ng test`: 18/18 passing (up from 15 — added the interceptor spec).
- `ng build`: clean (only the pre-existing inherited landing-page budget warning).
- Real headless-Chrome sessions against an isolated, purpose-created synthetic agency: generated an audit, viewed it in the Pipeline UI, captured the share link, then opened that exact link in a **separate, fully isolated browser context** (no cookies at all) to simulate a genuine anonymous prospect — confirmed it renders the full report correctly. All synthetic data removed afterward.

## 6. Remaining Phase 2 backlog (unchanged, still deferred)

Public landing pages/inbound forms/UTM attribution, enrichment adapter, assisted outreach sequences, optional territories, saved search campaigns, Contact/Location management UI. See `docs/leadzaro/NEXT_PHASE_PROMPT.md`.
