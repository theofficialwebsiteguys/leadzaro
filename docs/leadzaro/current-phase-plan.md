# Phase 8 — Premium SEO and Advanced Services: working plan

Scope per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` "Phase 8" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` §19 (analytics and SEO), §24 (integration priority), §25 (engineering quality requirements). This is the **last phase** in the documented roadmap.

Major gate: **SEO access and recurring work must be unavailable without the proper entitlement while the base website remains fully functional.**

This plan was drafted, then escalated to `fable-phase-reviewer` for a pre-implementation design review (mirroring Phases 5–7). The review returned 9 findings, 3 must-fix (all resolved below) plus 6 worth-noting corrections, all incorporated before any migration was written. CLAUDE.md rule 8 applies to this phase's billing half exactly as it has since Phase 3 — no real Stripe charge is ever processed for the SEO add-on.

## 1. Evidence audit — what already exists that this phase builds on

- `Subscription.addOnServicePlanIds` (Phase 3, JSONB array of `ServicePlan` ids) is the real, billing-driven mechanism for "a client's subscription includes this add-on." **Correction (review finding, must-fix)**: `Subscription` has no `organizationId` column — only `billingAccountId` (FK to `BillingAccount`, which has `organizationId`), and `BillingAccount hasMany Subscription`. Resolving "does this organization have an active SEO entitlement" therefore requires: find the org's `BillingAccount` → check **all** of its `Subscription` rows for `status === 'active'` **and** `addOnServicePlanIds` containing the seeded `seo_addon` `ServicePlan`'s id — never a single `Subscription.findOne({ where: { organizationId } })`, which would throw against the real schema.
- `Website.googleAnalyticsMeasurementId` (Phase 7) is the direct precedent for this phase's Google Search Console connection: a single employee-settable field, Leadzaro never provisions/authenticates the underlying account.
- No background job scheduler exists anywhere in this codebase — Phase 7's `checkRenewal` (an explicit, employee-triggered action rather than a cron) is this phase's own precedent for every "recurring" outcome.
- The adapter-interface pattern (8 uses: Stripe, Google Calendar, GCS, GitHub, Namecheap, cPanel, ...) is reused once more this phase for real-external-capability audit checks (§2c below) — and explicitly **not** reused for an AI provider this phase (§2e).
- **Verified during review**: `WebsiteVersion.schema` genuinely is immutable-in-practice — the only `.update()` calls against a `WebsiteVersion` instance (`websiteService.js`) touch `status`/`publishedAt` only; `restoreVersion` always creates a new row, never mutates an old one's `schema`. This justifies keeping SEO page metadata in a separate, non-versioned model (§2a) rather than inside the schema JSONB.
- **Verified during review**: `authorizeAndClassifySchemaChange` treats page add/remove/reorder as an allowed structural change — pages genuinely can be deleted via an ordinary draft edit, which the separate, non-versioned SEO-metadata model (§2a) must account for explicitly (§2b).
- Every existing guarded model denormalizes `organizationId`/`agencyOrganizationId` directly onto its own row (never resolved via an `include` of another guarded model — ADR 0007's documented include-bypass gap). **Correction (review finding, must-fix)**: the original draft's field lists for `WebsitePageSeoSettings`, `WebsiteRedirect`, and `WebsiteSeoAudit` omitted these columns; all three now include them, populated from the resolved `Website` at row-creation time exactly like `findOrCreateWebsiteDomainForRequester` already does.
- `recordAudit()`/`Notification`/`notify()` are the established patterns for this phase's own "manual add-on activation... with audit" requirement and for surfacing audit/task-cycle events.

## 2. Core models and corrected design decisions

### 2a. Entitlement architecture — the phase's own novel authorization primitive

Every prior phase's gate has been role/permission-based. This is the first phase where access instead depends on what a specific **organization** has paid for — a resource-scoped check, not a role-scoped one.

**`SeoEntitlementGrant`** (new, employee-only): `id, organizationId, agencyOrganizationId, grantedByUserId, reason, expiresAt (nullable = indefinite), revokedAt (nullable), createdAt`. Write-gated to a new permission `seo.manage_entitlements` (administrator + billing roles, mirroring `billing.manage_service_plans`'s existing population).

`hasSeoEntitlement(organizationId)` = (an active `Subscription` under the org's `BillingAccount` whose `addOnServicePlanIds` includes the seeded `seo_addon` `ServicePlan`'s id) **OR** (an active `SeoEntitlementGrant` row: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`).

**Correction (review finding, must-fix — resolves the draft's own open question)**: `requireSeoEntitlement` is **not** Express middleware mirroring `requirePermission`. Verified during review: `resolveContext()` only loads the *requester's own* membership/permission data, never the *target resource's* owning organization; for an employee actor, `req.context.organization` is the *agency*, not the specific client org that owns the target website, so "does this website's org have an active entitlement" cannot be answered from `req.context` alone — it requires resolving `projectId → website.organizationId` first, which the service layer already does. Building this as middleware would either duplicate that resolution or require inventing a new "attach resolved resource to `req` for downstream reuse" convention this codebase doesn't have.

Resolved instead as a **service-layer assertion**: `assertSeoEntitlement(context, website)`, called from inside each SEO service function immediately after the website has already been resolved via the existing tenant-scoped accessor — one entitlement lookup, no duplicate resource resolution, matching how every other "additional per-resource condition" in this codebase already lives in the service/accessor layer (`WebsiteVersion`'s client-draft-hiding logic, `Task.isClientVisible`, `WebsiteComment.isInternal`), never generic middleware. The "can't forget to add it to a new route" risk this would otherwise create is mitigated by a mandatory test-suite pattern (§4) — a dedicated regression test asserting every single SEO route 403s for a non-entitled organization, the same rigor already required for "raw unscoped query throws" on every guarded model.

Manual grant creation **and** revocation both call `recordAudit` explicitly (review finding — "audit" in the roadmap's "reason/expiration/audit" is a call into the existing immutable audit-event mechanism, not just the grant row's own mutable fields).

### 2b. `WebsitePageSeoSettings` — model split, orphan handling, and visibility

`WebsitePageSeoSettings`: `id, websiteId, organizationId, agencyOrganizationId, pageId, metaTitle, metaDescription, canonicalUrl, robotsDirective ('index,follow'|'noindex,follow'|'noindex,nofollow'), schemaJson (JSONB), updatedByUserId`. Kept separate from `WebsiteVersion.schema` (current, mutable operational data, not versioned design content — see evidence audit) rather than embedded inside it.

**Correction (review finding, worth-noting — resolved explicitly rather than left implicit)**: because pages can be deleted via an ordinary draft edit and this model has no version tie, an orphaned settings row for a deleted page is a real, designed-for case, not a hypothetical: every consumer (sitemap.xml/robots.txt generation, any "list this page's SEO settings" UI) **always iterates the live draft schema's actual page list and left-joins against `WebsitePageSeoSettings`** — never iterates settings rows independently. A `restoreVersion` that reintroduces an old page structure therefore needs no special interaction with current SEO settings either: whichever pages exist in the live draft after a restore are exactly what gets iterated, and settings rows for pages that no longer exist are simply never surfaced, with no explicit cleanup migration needed.

**Correction (review finding, worth-noting)**: client editability is **not** coupled to Phase 5's `editingLevel` tier system. That system is a content-authoring trust axis, unrelated to "has this organization paid for the SEO add-on" — a client whose site is otherwise Basic-tier can still have paid for SEO. The gate is simply: SEO entitlement (already required to reach this screen at all) plus an ordinary client role check, no additional editing-level condition.

### 2c. Redirects and technical audits

**`WebsiteRedirect`**: `id, websiteId, organizationId, agencyOrganizationId, fromPath, toPath, statusCode (301|302), createdByUserId`.

**Correction (review finding, worth-noting)**: the original draft proposed CRUD-only storage with no runtime enforcement, reasoning by analogy to Phase 6/7's Live-adapter deferrals. The review correctly distinguished this: those deferrals exist because of a genuine *credentials* blocker (no live cPanel/Namecheap account); a redirect is pure generated Angular routing code with no such blocker. **Resolved**: the Phase 6/7 generator emits real Angular redirect routes from `WebsiteRedirect` rows — genuinely functioning client-side redirects, verified the same way Phase 6/7 verified generated output (`ng build` plus a router-config unit test asserting the redirect route exists and points correctly). A server/hosting-level 301 (`.htaccess`/cPanel-level rule) remains an explicitly-named deferral pending live cPanel credentials, mirroring the Live `CPanelAdapter.uploadBuild` deferral precedent exactly — but that deferral does not swallow the client-side redirect, which ships for real this phase.

**Technical audits — structural vs. adapter split (review-confirmed sound, no correction needed)**: heading-order and alt-text-coverage checks run directly against `WebsiteVersion.schema` (a real, mechanical, fully-testable structural check — no adapter). Broken-link and performance checks need real external capability and get a new **`SeoAuditAdapter`** (Mock/Disabled/Live, the 9th use of this pattern) — `checkLinks(urls)`, `checkPerformance(url)`. **Addition (review finding, minor)**: the mock models three outcomes, not two — a link/page can be `ok`, `broken`, or `inconclusive` (adapter couldn't determine an answer), so an audit's handling of "couldn't check this" surfaces as its own distinct finding rather than silently passing as a false "ok" (architecture §25's "no silent failures").

**`WebsiteSeoAudit`**: `id, websiteId, organizationId, agencyOrganizationId, websiteVersionId, runByUserId, runAt, findings (JSONB — list of {check, severity, pageId, message})`. One row per audit run, matching `WebsiteDeployment`'s audit-trail-per-attempt convention.

### 2d. Recurring SEO tasks — a real idempotency guarantee, not check-then-create

Reuses Phase 4's existing `Task`/`ProjectAssignment` machinery directly for the tasks themselves (no new task model) — an explicit, employee-triggered "generate this cycle's SEO tasks now" action, matching Phase 7's `checkRenewal` no-scheduler precedent.

**Correction (review finding, worth-noting)**: the original draft's proposed double-generation guard ("check for an existing incomplete Task with a matching label") is check-then-create and inherently racy — two concurrent triggers of the same cycle could both pass the pre-check before either commits. Architecture §25 requires idempotent jobs, and a manually-triggered "run this now" action producing real rows is the same class of requirement as a webhook handler. Resolved with a small tracking model, **`SeoTaskCycle`**: `id, websiteId, organizationId, agencyOrganizationId, cyclePeriod (e.g. '2026-07'), generatedByUserId, createdAt`, with a **database-level unique constraint on `(websiteId, cyclePeriod)`** — a genuine constraint violation on a concurrent duplicate attempt, not an app-level race.

### 2e. Google Search Console connection, reporting, and the AI provider interface

**Google Search Console**: a single `Website.googleSearchConsolePropertyUrl` field (nullable string), mirroring `googleAnalyticsMeasurementId` exactly — Leadzaro never provisions/authenticates a GSC property.

**Client reports/activity summaries and owner executive reporting**: no new model — both are read-only aggregate service functions over existing data (`WebsiteSeoAudit` history, SEO-tagged `Task` completion, Phase 7's `WebsiteAnalyticsEvent` summaries), matching `getWebsiteAnalyticsSummaryForRequester`'s precedent.

**Addition (review finding — closes a named gap)**: an explicit **`getSeoDashboardForRequester(context, websiteId)`** aggregate (entitlement status, most recent audit summary, open/recent SEO task counts, GSC connection state) — the concrete answer to the roadmap's "entitlement-gated SEO dashboard" outcome, mirroring how Phase 7 named `getWebsiteAnalyticsSummaryForRequester` as its own concrete dashboard-data answer, rather than leaving dashboard assembly implicit in several separate frontend calls.

**AI provider interface — correction (review finding, must-fix reversal of the draft's own "leaning")**: the draft proposed building the adapter shape only, no real call site. The review recommends going further: **deferred entirely this phase**, not even a shape-only stub. Every other adapter in this codebase was built because a named, concrete roadmap outcome required it end-to-end, even in Mock form; architecture §24 explicitly ranks AI last and "never a core dependency," and no concrete Phase 8 outcome actually depends on it — an adapter with no call site proves nothing testable and is speculative infrastructure. Named as a deliberate deferral (mirroring the Live `CPanelAdapter` build-contract deferral), to be picked up only once a real, named AI-consuming feature is scoped.

## 3. Permission summary

New permission `seo.manage_entitlements` (administrator + billing roles) gates manual SEO entitlement grant/revoke. Every other SEO action reuses `builder.manage` for employee-side operations (page metadata, redirects, audits, task-cycle generation, GSC connection) — consistent with Phase 7's own "no new permission, reuse `builder.manage`" precedent for agency-management-tier actions — **plus** the resource-scoped `assertSeoEntitlement` check (§2a), which is orthogonal to role/permission and applies regardless of which role is calling. Client-side page-metadata editing is gated by SEO entitlement + an ordinary client role check (§2b), never `builder.manage` or any editing-level tier.

## 4. Testing priorities

1. Raw unscoped query throws, for every new guarded model (`SeoEntitlementGrant`, `WebsitePageSeoSettings`, `WebsiteRedirect`, `WebsiteSeoAudit`, `SeoTaskCycle`).
2. **The major gate, both directions**: every SEO route/service function 403s (via `assertSeoEntitlement`) for an organization with no active entitlement — a dedicated regression test per route, not just one representative case, mitigating the "forgot to add the check to a new route" risk the middleware-vs-service-layer decision (§2a) explicitly accepted; **and** the base website (builder, forms, hosting, analytics — everything from Phases 1–7) remains fully functional for that same non-entitled organization, proving the gate is additive, not something that degrades unrelated functionality.
3. `hasSeoEntitlement`: true via an active `Subscription` addon, true via an active `SeoEntitlementGrant`, false once a grant's `expiresAt` has passed or it's been `revokedAt`-ed, false once a `Subscription`'s status is no longer `active` — proven against the real `BillingAccount hasMany Subscription` join, not a simplified single-row assumption.
4. `WebsitePageSeoSettings` orphan handling: a page deleted from the draft after having SEO settings never appears in sitemap/settings-list output; a `restoreVersion` call correctly reflects only currently-live pages' settings.
5. Redirects: the generator emits a real Angular route with the correct `redirectTo`/`pathMatch`/status semantics for a `WebsiteRedirect` row, verified via `ng build` plus a router-config unit test.
6. `SeoAuditAdapter`: structural checks (heading/alt-text) catch a real missing-alt-text case directly against a schema fixture; the mock adapter's three-outcome (ok/broken/inconclusive) contract is exercised for both link and performance checks.
7. `SeoTaskCycle`'s unique constraint: two concurrent "generate this cycle" attempts for the same `(websiteId, cyclePeriod)` — the second genuinely fails at the DB level, not just app logic.
8. Manual entitlement grant/revoke both produce a `recordAudit` entry.
9. `getSeoDashboardForRequester` returns correct aggregate counts against real underlying rows, not a stub.
10. Cross-agency isolation for every new table (the standard suite-wide pattern).

## 5. Suggested slice order

1. Entitlement architecture: `SeoEntitlementGrant`, `seo_addon` `ServicePlan` seed, `hasSeoEntitlement`/`assertSeoEntitlement`, manual grant/revoke routes with audit — the major gate's own mechanism, needed before any other SEO route can be meaningfully gated.
2. Page metadata/canonical/robots/schema controls (`WebsitePageSeoSettings`) + sitemap.xml/robots.txt generation (live-draft-iterating, orphan-safe).
3. Redirects (`WebsiteRedirect`) + real generator-emitted Angular redirect routes.
4. Technical audits — structural checks (heading/alt-text against schema) first, since they need no adapter.
5. `SeoAuditAdapter` (mock/disabled first, three-outcome contract) — broken-link + performance checks; `WebsiteSeoAudit`.
6. Recurring SEO tasks (`SeoTaskCycle` + real DB-level idempotency) + cycle-generation action.
7. `getSeoDashboardForRequester` + client reports/activity summaries + owner executive reporting.
8. Guided Google Search Console connection (`Website.googleSearchConsolePropertyUrl`).
9. Final full-phase review (major-gate-both-directions focus, mirroring every prior phase's own closing pass) + completion report.
10. Final cross-phase end-to-end regression report + overall `/goal` implementation summary — this is the last phase in the documented roadmap; no Phase 9 kickoff prompt follows.

AI provider interface: explicitly deferred, not a slice (§2e).
