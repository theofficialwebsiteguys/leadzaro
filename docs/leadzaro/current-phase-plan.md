# Phase 7 — Production Website Operations: working plan

Scope per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` "Phase 7" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` §§16 (source control and deployment), 17 (shared website services), 18 (forms), 19 (hybrid analytics half only — SEO itself is Phase 8).

Major gate: **a failed or unhealthy production deployment must restore the prior live build without losing the domain, configuration, or form functionality.**

This plan was drafted, then escalated to `fable-phase-reviewer` for a pre-implementation design review (mirroring Phases 5 and 6). The review returned 13 findings, 7 of them must-fix-before-implementation — concrete, code-verified problems in the draft's riskiest new mechanism (the first genuine anonymous/public write surface this codebase has ever exposed) and in the literal wording of this phase's own major gate. Every decision below reflects that review; corrections are marked explicitly. CLAUDE.md rule 8 governs this entire phase: every domain/DNS/hosting action stays behind Mock/Disabled adapters in this environment — nothing here ever touches a real registrar or a real cPanel account.

## 1. Evidence audit — what already exists that this phase builds on

- `WebsiteRepository`/`WebsiteDeployment` (Phase 6) already carry the source-control and preview-deploy half of architecture §16. `WebsiteDeployment.environment` (`'preview'|'production'`) was added specifically so this phase extends the same table rather than duplicating it — confirmed still correct (§2b below).
- **Verified during review**: `WebsiteDeployment` rows are created exactly once, at their terminal status (`'live'` or `'failed'`), inside `deployToBranch` (`server/modules/websites/websiteDeploymentService.js`) — never updated in place after creation. This is a real, load-bearing invariant this phase must preserve, not just a style preference (§2b).
- **Verified during review**: `Website.currentPublishedVersionId` (Phase 5) is the design-review "approved" pointer, set by the publish workflow — it is a different concept from "which version is actually serving live production hosting right now," which does not yet exist anywhere in the schema. Conflating the two was the root cause of review finding #5 (§2c below).
- **Verified during review**: `submitTestForm` (`websiteService.js`) — the only existing form-dispatch code — requires an authenticated `context`/`getWebsite` call chain and a non-null `ClientRequest.submittedByUserId` (`allowNull: false`). Neither holds for a real anonymous visitor. The draft's original "reuse the exact same dispatch logic" claim does not hold against the actual code (§2d).
- The public, unauthenticated precedent (`server/modules/public/routes.js`'s `POST /inbound-leads`, Phase 3): `publicFormLimiter` + honeypot + no auth + a direct, explicitly-scoped model write. The *shape* (rate limit + honeypot + no auth) is correct precedent to reuse; the specific limiter *instance* is not (§2e — it's a single-tenant, 10/15min, IP-only limiter never designed for per-website, per-purpose traffic).
- ADR 0007's guard (`visibilityGuard.js`) throws unconditionally on any unscoped query against a guarded model — **verified this throws in practice**, it is not merely an architectural discouragement. A public endpoint can never do a raw `Website.findOne(...)`; it must go through a new, explicitly documented exception function in `clientVisibleModels.js`, exactly like the two existing exceptions (`getNextVersionNumberForWebsite`, `pruneOldAutosaveVersions`) (§2e).
- The adapter-interface pattern (now used 7 times, most recently `GitHubAdapter`) is the mandatory shape for this phase's two new adapters (§2a).
- `websiteDevelopmentHandoffService`'s role-slot-filtered `notify()` loop (notify every `WebsiteEditorAssignment` matching a given set of role slots) is the established pattern for "notify responsible roles" (architecture §21) — reused directly for rollback/rollback-failure notifications (§2c).

## 2. Core models and corrected design decisions

### 2a. Namecheap and cPanel adapters (7th/8th in this codebase)

`NamecheapAdapter` (abstract base + `MockNamecheapAdapter`/`DisabledNamecheapAdapter`/`LiveNamecheapAdapter`, cached factory keyed by `NAMECHEAP_PROVIDER`). Operations: `checkAvailability(domain)`, `registerDomain(domain, years)`, `getDomainInfo(domain)`, `updateDnsRecords(domain, records)`, `renewDomain(domain, years)`, `initiateTransfer(domain)`. Mock simulates a real in-memory domain registry (registered domains, expiry dates, DNS record sets) — same stateful-mock precedent as `MockGitHubAdapter`, since renewal/transfer/DNS-update behavior needs real state to test meaningfully.

`CPanelAdapter` (same shape, `CPANEL_PROVIDER`). Operations: `uploadBuild(account, files)`, `backupCurrentFolder(account)` → backup id, `restoreFromBackup(account, backupId)`, `healthCheck(url)`, `mapDocumentRoot(account, domain, path)`. Mock maintains an in-memory "current live folder" plus a backup history keyed by backup id, so `restoreFromBackup` provably reverts the simulated folder's contents — the major gate's own rollback guarantee needs to be real against the mock, matching `MockGitHubAdapter`'s merge test precedent.

**Correction (review finding #9)**: the *Live* `CPanelAdapter.uploadBuild` contract is explicitly left undefined for the actual dist-bundle-production step. This phase's Mock/Disabled path commits generated source via Phase 6's `commitGeneratedFiles` boundary and simulates receiving a build artifact structurally — it does not run a real Angular CLI (`ng build`) production build. A real `ng build` step producing an actual static dist bundle for a genuine `LiveCPanelAdapter` is a **named, deliberate deferral**, not an oversight: no live cPanel credentials will ever exist in this environment (CLAUDE.md rule 8), so there is nothing to validate a real build pipeline against here. Recorded as a known limitation for whenever real credentials are added outside this session.

### 2b. `WebsiteDeployment` extension — never mutate a row after creation

**Correction (review finding #4)**: the original draft proposed reaching back into a prior `WebsiteDeployment` row and flipping its `status` to `'superseded'` after a new deploy succeeds. This directly contradicts the verified invariant in §1 — every deploy action creates exactly one new row, once, at its terminal status. Fixed by never touching a prior row again; "current" is derived from an explicit pointer instead.

- **`Website.currentLiveProductionDeploymentId`** (new column, nullable, references `WebsiteDeployment.id`) — set **only** on a successful production deploy (health check passed), in the same write as creating that deployment row. Mirrors `currentPublishedVersionId`'s existing pointer precedent. Never set, and never touched, on a failed/rolled-back/rollback-failed attempt or on any preview deploy — this is what makes rollback's "don't lose form functionality" guarantee (§2c) fall out for free, with no separate revert step.
- **`WebsiteDeployment` widened**: `status` gains `'rolled_back'` and `'rollback_failed'` (alongside the existing `'pending'|'building'|'live'|'failed'`); new columns `previousLiveDeploymentId` (self-referential, nullable — snapshot of `Website.currentLiveProductionDeploymentId` at the moment this attempt started, so every attempt has an explicit, queryable predecessor) and `backupRef` (the cPanel adapter's own backup id for this attempt, nullable — null for preview deploys, which never back up or roll back).
- No new table for backups (unchanged from the draft, review raised no objection) — a backup is 1:1 with the production deployment attempt it was taken immediately before.

### 2c. Production deploy + rollback pipeline — the major gate, all three parts

**Correction (review findings #5 and #6)**: the original draft's rollback only restored the build artifact. The gate names three things that must survive: the build, the domain/configuration, and form functionality. Resolved as three independent, explicit guarantees rather than one mechanism assumed to cover all three:

1. **Build** — `adapter.restoreFromBackup(account, backupRef)` on health-check failure, as originally drafted.
2. **Form functionality** — falls out of §2b's pointer design: the public form-submission endpoint (§2e) always dispatches against whichever `WebsiteVersion` `Website.currentLiveProductionDeploymentId` currently resolves to. A failed/rolled-back attempt never updates that pointer, so the live public form target and the live (restored) build agree automatically — there is nothing to separately "revert," because nothing was ever pointed at the failed attempt in the first place.
3. **Domain/configuration** — scoped out of the deploy action **by explicit design, not by omission**: domain registration, DNS updates, and document-root mapping (§2a's `NamecheapAdapter`/`CPanelAdapter.mapDocumentRoot`) are only ever performed by dedicated domain-management actions (slices 1 and 8), never as an implicit side effect of a production deploy (slices 3-4). A deploy therefore never mutates domain/DNS state, so a deploy's rollback never needs to either — this closes that leg of the gate by scope, stated explicitly here so it is a decision, not a gap.

`productionDeployService.deployToProduction(context, projectId, versionId, actorUserId)`:
1. `previousLiveDeploymentId = website.currentLiveProductionDeploymentId` (read before anything else).
2. Generate files via Phase 6's `buildGeneratedFiles`.
3. `backupRef = adapter.backupCurrentFolder(account)`.
4. `adapter.uploadBuild(account, files)`.
5. `healthy = adapter.healthCheck(liveUrl)`.
6. **If healthy**: in one write, create the new `WebsiteDeployment` row (`status: 'live'`, `environment: 'production'`, `previousLiveDeploymentId`, `backupRef`) and set `website.currentLiveProductionDeploymentId` to its id.
7. **If unhealthy**: attempt `adapter.restoreFromBackup(account, backupRef)`.
   - Restore succeeds → create the new `WebsiteDeployment` row with `status: 'rolled_back'`; `website.currentLiveProductionDeploymentId` is left untouched (still points at the prior live deployment). Notify responsible roles (developer/PM role slots on the project, reusing the Phase 6 handoff notify-loop pattern) with a normal-priority "deploy failed and was rolled back" notification.
   - Restore itself throws → create the new `WebsiteDeployment` row with `status: 'rollback_failed'` (finding #6 — a distinct terminal state; this must never be silently presented as a normal handled rollback). Fire a **high-priority** notification to the same responsible roles — this is the one scenario in this whole phase that requires urgent human intervention, since the system genuinely does not know what state the live site is in.
8. Every branch creates exactly one `WebsiteDeployment` row, once, at its final status — no path in this service ever calls `.update()` on a previously-created row, preserving §2b's invariant.

### 2d. `WebsiteDomain` and `WebsiteAnalyticsEvent` — visibility, decided explicitly

**`WebsiteDomain`**: `id, websiteId (unique), organizationId, agencyOrganizationId, provider ('namecheap'), domain, status ('pending'|'active'|'expired'|'transferring'), registeredAt, expiresAt, autoRenew, dnsRecords (JSONB), createdByUserId`.

**Correction (review finding #8)**: the draft left client visibility as an open question ("leaning yes, via a narrow client-visible projection"). Resolved as **fully employee-only**, matching `WebsiteDeployment`/`WebsiteDevelopmentHandoff`'s Phase 6 precedent — registrar/DNS internals are sensitive (DNS records can expose verification tokens and subdomain layout) and `expiresAt`/`autoRenew` are billing-adjacent. This codebase has consistently preferred whole-model employee/client splits over conditional per-field visibility (the exact type-vs-instance granularity mistake Phase 6's own review caught for `SectionDefinition.state`/`detached` — a partial-field guard branch here would be the same class of error applied to visibility instead of state). If a renewal-approaching signal needs to reach a client, it's a `Notification` with just the domain name and date, never row access — mirroring how `WebsiteDevelopmentHandoff` stays employee-only while a client can still be notified "your site's preview is ready."

**`WebsiteAnalyticsEvent`**: `id, websiteId, organizationId, agencyOrganizationId, eventType, path, sessionId (anonymous, client-generated, no PII), metadata (JSONB), createdAt`. Written by anonymous public traffic (§2e).

**Correction (review finding #7)**: the draft made raw events employee-only-only, which contradicts architecture §19's explicit requirement that "client dashboards show business-focused summaries." Resolved with two accessor functions over the same table, matching this codebase's established pattern of deciding visibility per accessor rather than per model: `listWebsiteAnalyticsEventsForRequester` stays employee-only (raw, session-level rows are an internal/spam-review concern); a new `getWebsiteAnalyticsSummaryForRequester(context, websiteId, { rangeDays })` runs a tenant-scoped aggregate query (`GROUP BY date, eventType`, counts only — no `sessionId`/`metadata` in the result) and is reachable by both employees and clients, satisfying §19 without exposing raw visitor-level data.

**Guided Google Analytics connection** (finding #12 — the draft named this in the slice list with no design content): a single nullable `googleAnalyticsMeasurementId` column on `Website` (validated `G-XXXXXXXXXX` format), employee-settable only (`builder.manage`) — Leadzaro never provisions a GA account, it only stores a measurement ID the agency/client already has. The generator emits the `gtag.js` snippet into generated pages only when this field is set.

### 2e. The public, unauthenticated surface — corrected mechanism, not just corrected language

**Correction (review finding #1)**: "bypass the guard" (the draft's own phrasing) is not a real option — `Website`'s guard hook throws on any unscoped query unconditionally, with no carve-out. The actual, implementable pattern is a new named function in `clientVisibleModels.js`, following the `getNextVersionNumberForWebsite`/`pruneOldAutosaveVersions` documented-exception precedent exactly: `getLiveWebsiteForPublicSubmission(websiteId)` calls `scoped({ where: { id: websiteId, currentLiveProductionDeploymentId: { [Op.ne]: null } } })` and returns only the minimal fields the write path needs (`id`, `currentLiveProductionDeploymentId`, `organizationId`, `agencyOrganizationId`) — never the full row, never anything reflecting draft-only or non-production state. This is the *only* place in this phase's code allowed to look up a `Website` outside a requester context.

**Correction (review finding #2)**: `submitTestForm`'s dispatch logic cannot literally be reused (§1) — `ClientRequest.submittedByUserId` is `NOT NULL` and there is no `User` row for an anonymous visitor. Rather than making that column nullable (which would let unverified, honeypot-only-filtered anonymous rows land directly in the same operational queue employees already trust as real, authenticated client requests — a genuine trust-boundary conflation), a small new model keeps the anonymous-write surface and the trusted internal queue separate:

**`WebsitePublicFormSubmission`**: `id, websiteId, organizationId, agencyOrganizationId, websiteVersionId (the live version targeted, from currentLiveProductionDeploymentId), pageId, sectionId, values (JSONB), status ('pending_review'|'converted'|'discarded'|'spam'), convertedToClientRequestId (nullable FK), createdAt`. Employee-only visibility. An employee triages a pending row and either discards it or promotes it via the existing `requestService.createRequest` (category `'form'`, `submittedByUserId` = the promoting employee — a real, accountable actor for the resulting `ClientRequest`; the `WebsitePublicFormSubmission` row remains the permanent record of the true anonymous origin), setting `convertedToClientRequestId` and `status: 'converted'`.

**Correction (review finding #3)**: the literal `publicFormLimiter` instance is not reused. Two new, purpose-built limiters: `publicWebsiteFormLimiter` (same 10/15min shape, but `keyGenerator: (req) => `${req.ip}:${req.params.websiteId}`` so one shared/NAT IP submitting to two different clients' sites doesn't share a budget) and `publicAnalyticsLimiter` (materially higher — normal browsing generates many events per session; a generous per-IP-per-website ceiling, e.g. 300/15min, tuned during implementation against realistic multi-page browsing volume, not the form-submission budget).

**Correction (review finding #10, hardening)**: `Website.id` is a UUID, so ID-guessing enumeration isn't practically feasible from keyspace alone — not a Critical finding — but both public endpoints return an identical, generic 404 for "no such website," "website exists but not live in production," and any other not-found reason, never a distinguishable status that would confirm a draft-only or not-yet-deployed site's existence.

Routes: `POST /api/v1/public/websites/:websiteId/submit-form`, `POST /api/v1/public/websites/:websiteId/analytics-event` — both rate-limited per above, both honeypot-protected (mirroring `/inbound-leads`'s undocumented `website` field convention and its silent-fake-success-on-honeypot-hit behavior), both resolving the target website exclusively through `getLiveWebsiteForPublicSubmission`.

### 2f. Shared website-services scope (finding #13, named explicitly)

This phase implements **forms + hybrid analytics** as the first, foundational slice of architecture §17's shared website-services API. Appointment requests, newsletter signup, file uploads, structured dynamic content, blog/events, and generic outbound webhooks (also named in §17) are **explicitly deferred beyond Phase 7** — a deliberate scope-down consistent with how prior phases named their own deferrals, not an oversight.

## 3. Permission summary

No new client-facing permission. Domain registration/renewal/transfer, production deploy trigger, rollback trigger, deployment-log access, and website export are all agency-management-tier actions and reuse the existing `builder.manage` permission (administrator + project_manager) — consistent with Phase 6's own boundary, where `builder.develop` (developer + advanced_designer) covers preview/development-branch work but never production-facing actions. `WebsitePublicFormSubmission` triage (list/convert/discard) also reuses `builder.manage`. The two public routes require no permission at all by definition (anonymous), gated instead by rate limiting + honeypot + the explicit live-website-only lookup in §2e.

## 4. Testing priorities

1. Raw unscoped query throws, for every new guarded model (`WebsiteDomain`, `WebsiteAnalyticsEvent`, `WebsitePublicFormSubmission`).
2. `WebsiteDomain`/raw `WebsiteAnalyticsEvent`/`WebsitePublicFormSubmission` employee-only visibility — direct regression tests; `getWebsiteAnalyticsSummaryForRequester` reachable by both employee and client roles, proven with both.
3. **The major gate, all three parts**: (a) a failed health check triggers `restoreFromBackup` against the mock and the mock's simulated folder contents actually revert; (b) `Website.currentLiveProductionDeploymentId` is left untouched on any non-`'live'` outcome, proven by asserting the public form endpoint still dispatches against the prior version after a simulated failed deploy; (c) a `restoreFromBackup` failure itself produces `'rollback_failed'` (not `'rolled_back'`) and a distinct, high-priority notification.
4. `WebsiteDeployment` invariant: no code path in `productionDeployService` ever calls `.update()` on a previously-created row — every branch creates exactly one row at its terminal status.
5. `getLiveWebsiteForPublicSubmission`: returns null/not-found for a non-existent website, a draft-only website, and a website whose only deployments are `'preview'` environment — and the controller returns an identical generic 404 for all three.
6. `WebsitePublicFormSubmission` → `ClientRequest` promotion: the resulting `ClientRequest.submittedByUserId` is the promoting employee, `convertedToClientRequestId` is set, and the original anonymous submission row is preserved (never deleted).
7. `publicWebsiteFormLimiter`/`publicAnalyticsLimiter` are independent instances, keyed by IP+websiteId — a client at the limit for website A can still submit to website B.
8. `MockNamecheapAdapter`/`MockCPanelAdapter` stateful lifecycles: a domain's `getDomainInfo` reflects a prior `registerDomain`/`updateDnsRecords`/`renewDomain` call; a `backupCurrentFolder` → `uploadBuild` → `restoreFromBackup` cycle provably reverts the simulated live folder's contents.
9. Cross-agency isolation for every new table (the standard suite-wide pattern).

## 5. Suggested slice order

1. `NamecheapAdapter` (mock/disabled first) + `WebsiteDomain`, employee-only.
2. `CPanelAdapter` (mock/disabled first) + document-root mapping.
3. Production build + manual deploy pipeline: `WebsiteDeployment` extension (`previousLiveDeploymentId`, `backupRef`, widened `status`) + `Website.currentLiveProductionDeploymentId` pointer + `productionDeployService.deployToProduction`'s happy path (backup exists before slice 4 needs to roll back to it).
4. Health check + automatic rollback, all three parts of the major gate (§2c) — including the `'rollback_failed'` path and its dedicated notification.
5. Deployment logs/history surfaced to `builder.manage` roles.
6. Public, unauthenticated form-submission endpoint + `WebsitePublicFormSubmission` + spam protection + employee triage/promote-to-`ClientRequest` flow.
7. Hybrid analytics events (raw employee-only + client-visible aggregate summary) + guided Google Analytics connection.
8. Domain renewal tracking (expiry-approaching notifications, employee + client-facing per §2d).
9. Cancellation export/domain transfer workflow + employee-controlled full website export.
10. Final full-phase review (major-gate-all-three-parts focus, mirroring Phase 5/6's own closing pass) + completion report.
