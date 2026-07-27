# Phase 5 — Website Builder Foundation: working plan

Scope per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` "Phase 5" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` §§ 13 (files/content scopes) and 14 (website builder). § 15 (Angular code generation) is read only for the schema-stability boundary Phase 6 depends on — this phase does not generate or run any Angular code.

Major gate: the schema, preview renderer, and version history must be stable before Phase 6 (Angular code generation) is introduced. Secondary gate carried from this phase's own outcome list: Basic/Professional/Advanced editing-level enforcement must be server-side, never frontend-hidden — exactly CLAUDE.md rule 4, applied to a graduated permission model instead of Phase 4's binary one.

This plan was drafted, then escalated to `fable-phase-reviewer` for a pre-implementation design review (a draft plan is not sufficient justification on its own for a phase this architecturally significant — see CLAUDE.md's escalation rule). The review returned 7 resolved open questions and 10 additional findings, three of which required revising the draft before any migration could be written. Every decision below reflects that review; corrections are marked explicitly, matching Phase 4's own completion-report convention of naming what changed and why.

## 1. Evidence audit — what already exists that this phase builds on

- Every client `Organization` has exactly one `Project` (Phase 4). A `Website` belongs to a `Project` 1:1 in this phase — no multi-site-per-project support yet (a documented scope boundary, not an oversight; see § 5 below).
- ADR 0007's client-visibility architecture (`visibilityGuard.js` + `clientVisibleModels.js`) is the only sanctioned way any guarded model is read. Every new Phase 5 model reachable by a client request uses it.
- `File.SCOPES` already includes `'website_asset'`, added in Phase 4 in anticipation of this phase, but deliberately excluded from `File.CLIENT_FACING_SCOPES` at the time ("no inherent tie to a specific client-visible context" — see `clientVisibleModels.js`'s `filterClientVisibleFiles` comment). This phase supplies that context.
- `advanced_designer` and `developer` employee roles have existed since Phase 1 with only `PLACEHOLDER_EMPLOYEE_PERMISSIONS` — this is explicitly the module they were reserved for.
- The `ProjectAssignment` pattern (a per-project role-slot table, separate from the global permission catalog) is the established precedent for "broad permission gates the route; a narrower assignment-style table carries the finer distinction within it." Phase 5's editing-level enforcement reuses this shape.
- Phase 4's own history contains two lessons this phase must not relearn the hard way: (a) `Meeting` originally shipped with no denormalized tenant columns, caught only by a mid-phase review; (b) `Message`/`ProjectChannel` originally let a visibility function trust its caller's order of operations instead of independently re-deriving the parent's visibility, causing a real (pre-commit) leak. Both are treated as up-front design rules below, not risks to rediscover in this phase's own closing review.
- Phase 4's own *closing* review additionally found that `ProjectAssignment.addAssignment` didn't verify its target user actually belonged to the project's tenant — a cross-tenant PII exposure via the assignment-listing endpoint. `WebsiteEditorAssignment` (this phase's analogous table) builds that check in from the start.

## 2. Core models and corrected design decisions

### 2a. `DesignSystem` (design tokens + starting templates)

`id, agencyOrganizationId (nullable), organizationId (nullable), name, tokens (JSONB: colors/fonts/spacing/radii/shadows), isLibraryTemplate (boolean), forkedFromDesignSystemId (nullable, self-FK, lineage only — never consulted at runtime), createdByUserId`.

- A **library template** row has `agencyOrganizationId` set (or null for a platform-provided base library) and `organizationId: null` — visible only to employees (browsing to start a new client site), never to a client directly.
- A **client instance** row has both `organizationId` and `agencyOrganizationId` set, created by **forking** (copying) a library template's `tokens` at `Website` creation time — never a live reference to the library row.
- **Correction (review Q7)**: the original draft left open whether a client's design system should reference the library template directly with an override layer, or fork it. Fork was chosen: a live reference would let a later edit to the shared library template *retroactively and silently* change an already-published client site's tokens outside that client's own version/review/publish workflow — breaking the version-history immutability guarantee (a "published" `WebsiteVersion` snapshot would stop accurately representing what was actually live). `forkedFromDesignSystemId` is kept for lineage/reporting only.
- Reuses `tenantWhereForRequester` directly, unmodified: a client-membership query matches on `organizationId` (only their own forked instance ever matches — library rows have `organizationId: null` and are automatically invisible to any client, with no extra logic needed); an employee-membership query matches on `agencyOrganizationId` (their own library templates *and* every client instance under them, exactly like `Project`).

### 2b. `Website`

`id, projectId (unique), organizationId, agencyOrganizationId, designSystemId, name, startingMode ('template'|'page_kit'|'guided'|'blank'), draftSchema (JSONB), currentPublishedVersionId (nullable FK to WebsiteVersion), createdByUserId`.

- 1:1 with `Project` (unique index on `projectId`) — a documented scope boundary (§ 5).
- `draftSchema` is the mutable, autosaved working state — the schema-first source of truth, shaped per architecture § 14's own example (`pages[].sections[]`, plus the content-scope keys added in § 2f below).
- **Correction (review Q2)**: `Page`/`Section` are deliberately **not** normalized into their own tables this phase — they live entirely inside `draftSchema`/`WebsiteVersion.schema`, matching § 14's literal "the primary source of truth is a structured versioned website definition." The one required discipline: every page/route lookup goes through a single accessor function (e.g. `findPageInSchema(schema, route)`) from slice 1, even though it's just parsing JSON today — so that if a later phase (domain routing, SEO) needs a real indexed `Page` table for performance, that becomes an internal change behind an existing seam, not a call-site rewrite.
- Standard guard (`installVisibilityGuard`), `tenantWhereForRequester` — no additional client/internal split needed at the `Website` row level itself (the split that matters is on `WebsiteVersion`, § 2c).

### 2c. `WebsiteVersion`

`id, websiteId, organizationId, agencyOrganizationId (denormalized — correction below), versionNumber, label (nullable), schema (JSONB, immutable once created), isAutosave (boolean), status ('draft'|'pending_review'|'approved'|'published'), createdByUserId, publishedAt (nullable)`.

- **Correction (review Q1, approved as drafted)**: a full immutable JSONB snapshot per version, not a diff/event-log. `compare` = diff two known-good full documents at request time; `restore` = create a *new* version copying an old one's schema, never rewriting history — matching this codebase's existing immutable-audit-trail convention (`AuditLog`, `ConversionAttempt`). Autosave pruning (keep the N most recent per website; never prune named/published ones) bounds storage growth. This is explicitly *not* the operational-transform live-editing model § 14 rules out — those are orthogonal concerns (storage representation vs. real-time collaboration transport).
- **Correction (review finding #2 — tenant denormalization)**: `organizationId`/`agencyOrganizationId` are denormalized directly onto this table, exactly like every other Phase 4 child table (`Task`, `Message`, `Meeting` after its own mid-phase fix) — never resolved via an `include` of the guarded `Website` model (ADR 0007's first empirically-found gap).
- **Correction (review finding #1 — re-derived on reflection, not just tenant scoping)**: on closer analysis prompted by the review's caution, `WebsiteVersion` *does* have a genuine non-tenant visibility axis, the same shape as `Message`'s channel-visibility split: a client should see the currently published/approved version(s) and their own submitted versions (to track their own request's status), but **not** another user's in-progress draft/autosave work (e.g. a designer's unfinished Professional-tier changes). The guarded accessor therefore applies, for a client membership: `status IN ('published','approved') OR createdByUserId = context.user.id`, on top of tenant scoping — mirroring `taskWhereForRequester`'s `isClientVisible` addition and `channelWhereForRequester`'s `visibility` addition exactly. An employee membership sees every version, matching § 2d's "any active employee at the owning agency" precedent.
- Every route that takes both a `websiteId` and a `versionId` path parameter re-validates `version.websiteId === websiteId`, matching the existing `Task`/`Channel` convention (`if (!task || task.projectId !== projectId) throw invalid(...)`).

### 2d. `SectionDefinition` (component/section library catalog)

`id, agencyOrganizationId (nullable — null means platform-provided/system-defined), name, componentKey, category, settingsSchema (JSONB — see § 2e), variants (JSONB), state ('managed'|'extended'|'registered_custom'|'detached'), previewImageUrl, isSystemDefined (boolean), createdByUserId (nullable for system rows)`.

- **Correction (review finding #10)**: tenancy was left unspecified in the draft. Decision: agency-scoped, not a single global catalog — the phase's own "library governance" outcome implies agencies curate their own section libraries. `agencyOrganizationId: null` rows are platform-provided defaults visible to everyone; non-null rows are a specific agency's own custom/registered components, visible to that agency's employees and (read-only, for rendering their own site) clients under it.
- Guarded, but with an OR-scoped accessor rather than plain `tenantWhereForRequester` equality: `listSectionDefinitionsForRequester(context)` matches `agencyOrganizationId IS NULL OR agencyOrganizationId = <the requester's own agency>` — for an employee, `context.organization.id`; for a client, `context.organization.managingAgencyOrganizationId` (already available on the loaded `Organization` row from `resolveContext()`). This is new shape, not a reuse of the existing helper, and must be reviewed for correctness in its own dedicated test the same way `taskWhereForRequester`'s addition was.
- Component **states** (`managed`/`extended`/`registered_custom`/`detached`) are represented as data only in this phase — no real Angular code is generated or executed. Registered/detached rows are placeholders for Phase 6 to give real meaning to.

### 2e. Per-property editing-level and review classification (the secondary major gate)

**Correction (review finding #3 — the most load-bearing fix from the review)**: the original draft proposed a single `minEditingLevel` scalar per `SectionDefinition` (per section, not per property). The review identified this as a genuine server-side authorization gap in the unsafe direction: a section that's mostly Basic-editable but exposes one Professional-tier property (e.g. background positioning on an otherwise-simple hero) would force a choice between wrongly blocking a legitimate Basic edit or wrongly *allowing* a Basic-assigned editor to change that one Professional-tier property.

Fixed by moving classification to the property level. `SectionDefinition.settingsSchema` shape:

```json
{
  "heading": { "type": "text", "editingLevel": "basic", "requiresReview": false },
  "backgroundImage": { "type": "image", "editingLevel": "basic", "requiresReview": false },
  "gridColumns": { "type": "number", "editingLevel": "professional", "requiresReview": false },
  "customAnimationScript": { "type": "code", "editingLevel": "advanced", "requiresReview": true }
}
```

`requiresReview` is independent of `editingLevel` — per architecture § 13's own wording ("design, navigation, pages, legal copy, and other sensitive changes require employee review" regardless of who's editing), a Basic-tier field can still be flagged `requiresReview: true` (e.g. a legal-copy text field), and a Professional-tier field could in principle publish immediately if explicitly marked so. Sensible defaults: `editingLevel: professional|advanced` implies `requiresReview: true` unless explicitly overridden; navigation-structure and page-structure changes (adding/removing/reordering pages, not just editing a page's content) always require review regardless of level, enforced as a dedicated check in the mutation service, not just a per-property flag (since these are structural changes to `draftSchema.pages` itself, not a single section's settings).

**Enforcement mechanism**: every mutating builder endpoint diffs the incoming patch against the prior state (`draftSchema` or the version being edited), classifies each *changed key* against its `SectionDefinition.settingsSchema` entry, and rejects (403) if any changed key's `editingLevel` exceeds the requester's own effective level (§ 2g) — not a single whole-section check. If any changed key (or a structural page/navigation change) has `requiresReview: true`, the resulting `WebsiteVersion.status` is forced to `pending_review` rather than `published`, regardless of who made the change.

### 2f. Content scopes (architecture § 13's three named tiers)

**Correction (review finding #5)**: the draft addressed page/section content (nested in `draftSchema.pages[].sections[].content`, already implied) and effectively website-global content, but left "organization content" entirely unaddressed. Decision, made explicit rather than left silently absent:

- **Page/section content**: `draftSchema.pages[].sections[].content` (already in architecture § 14's own example).
- **Website-global content**: a top-level `draftSchema.siteSettings` key (site title, global header/footer content, shared across every page).
- **Organization content**: a top-level `draftSchema.organizationContent` key — reusable named content items (e.g. business NAP data, a reusable testimonial block) referenced by key from any section's `content`, scoped to the single `Website` this phase supports rather than a separate cross-site table. **Documented deliberate simplification**: if a later phase ever supports multiple websites per client organization, this would need promotion to its own `OrganizationContentBlock` table shared across those sites — out of scope here since this phase is explicitly 1:1 `Project`↔`Website`.

Client publishing behavior per § 13 ("some fields publish immediately; design, navigation, pages, legal copy... require review") is the `requiresReview` mechanism in § 2e, applied uniformly across all three content scopes — there is no separate content-scope-specific review mechanism.

### 2g. Editing-level enforcement, permissions, and roles

Two authorization layers, mirroring Phase 4's own "broad permission + fine-grained scoping" pattern:

1. **`builder.edit`** (broad route-level gate): `designer`, `advanced_designer`, `developer` (employee); `client_owner`, `marketing`, `content_editor` (client) — deliberately narrower than the "everyone except viewer" pattern used for messages/requests/meetings, since editing a live client website is a materially bigger action. `project_contact`/`billing_contact` do not get it.
2. **`builder.publish`** (narrower — approving a `pending_review` version to `published`): `administrator`, `project_manager`, `advanced_designer`, `developer`. No client role ever gets this, matching `cancellations.manage`'s "business decision, not day-to-day work" precedent.
3. **`WebsiteEditorAssignment`** (new table, mirroring `ProjectAssignment`): `id, websiteId, organizationId, agencyOrganizationId, userId, editingLevel ('basic'|'professional'|'advanced'), assignedByUserId`, unique on `(websiteId, userId)`.
   - **Correction (review Q3)**: a new table, not an `editingLevel` field bolted onto `ProjectAssignment`. `ProjectAssignment`'s unique key is `(projectId, userId, roleSlot)` — a single user can hold multiple role-slot rows on one project, so there is no principled single answer for "this user's editing level" if it lived there. Editing level is a genuinely distinct axis (what you may touch on the *website*) from role slot (what function you serve on the *project*); conflating them was exactly the risk the draft itself flagged and the review confirmed.
   - **Correction (review finding #9)**: before creating an assignment, the target user must have an active `OrganizationMembership` at the website's own `organizationId` (client assignee) or `agencyOrganizationId` (employee assignee) — the exact check Phase 4's closing review had to retrofit onto `ProjectAssignment.addAssignment` after finding it missing. Built in from the start here.
   - **Correction (review finding #8)**: the assignment-creation path explicitly rejects `editingLevel: 'advanced'` whenever the target user's membership is `client` — Advanced tier is explicitly developer/employee territory per § 14 ("registered components," "controlled developer functionality"), and nothing in the original draft stopped a client from being assigned it by mistake or malice.
   - Employee roles get an editing level *implicitly* from their role (`developer`/`advanced_designer` → advanced; `designer` → professional) without needing an explicit assignment row for the common case — an explicit `WebsiteEditorAssignment` is required only for client-side collaborators (and the rare case of restricting a specific employee below their role default). This mirrors Phase 4's "employee project access is implicit by agency membership" precedent.

### 2h. `WebsiteComment` (visual feedback anchored to versions/components)

**Correction (review finding #4)**: entirely absent from the original draft despite being a named, required outcome in both § 14 ("comments") and the roadmap ("visual feedback anchored to versions/components") — not deferred, simply missing. Minimal shape added now, since the major gate requires the schema stable before Phase 6, not stabilized-then-broken-again:

`id, websiteId, organizationId, agencyOrganizationId, versionId (nullable — a comment can be anchored to a specific version or to the current draft), anchorKey (a path into the schema — e.g. a page route + section id, mirroring `WebsiteEditLock.sectionKey`), authorUserId, body, isInternal (boolean, default false — mirrors `ProjectChannel`'s client/internal split so employees can leave client-invisible internal notes), resolvedAt (nullable)`.

Client-visibility accessor hides `isInternal: true` rows, matching the internal-channel-message precedent exactly. The comment *workflow* (threading, notifications) is intentionally thin this phase — only the anchored-feedback shape itself is required to satisfy the stability gate.

### 2i. `WebsiteEditLock` and presence

`WebsiteEditLock`: `id, websiteId, organizationId, agencyOrganizationId, sectionKey, lockedByUserId, lockedAt, expiresAt` — a heartbeat-renewed TTL lock (renew = update `expiresAt`; a lock past `expiresAt` is simply treated as available at read/acquire time, no cleanup job needed).

`WebsitePresence`: `id, websiteId, organizationId, agencyOrganizationId, userId, sectionKey (nullable), lastSeenAt` — updated via a lightweight heartbeat call from the frontend every few seconds; a row is "present" if `lastSeenAt` is within a short window, filtered at read time, no cleanup job needed.

**Correction (review Q6, approved as drafted)**: short-TTL poll-based presence, not real-time push. No WebSocket/SSE infrastructure exists anywhere in this codebase; § 14 explicitly rules out full operational-transform live editing "initially"; and this is orthogonal to the major gate (schema/renderer/version-history stability), so introducing real-time infrastructure now would be a disproportionate addition for "Foundation" scope. Both tables use plain tenant scoping (no client/internal split needed — knowing who's editing what, within a project everyone involved already has access to, isn't sensitive).

### 2j. Form builder (client-editable forms)

**Correction (review finding #7)**: the draft's slice order mentioned this but defined no shape at all, despite Phase 7 ("form submissions and routing") needing to route real submissions against whatever shape this phase defines. Decision, reserved now: a `SectionDefinition` with `componentKey: 'form'`, whose `content` shape is `{ fields: [{ key, label, type, required, options? }], submitTarget: { type: 'client_request'|'email'|'webhook', config: {} } }`. `client_request` reuses Phase 4's existing `ClientRequest` machinery (a form submission becomes a `ClientRequest` with a category derived from the form) — the only submission target this phase needs to actually wire up end-to-end; `email`/`webhook` are reserved shape for Phase 7, not implemented here.

### 2k. Files: `website_asset` becomes client-facing

**Correction (review Q4)**: `website_asset` is added to `File.CLIENT_FACING_SCOPES`, with a `relatedId` re-check mirroring `task_attachment`/`message_attachment` exactly — `filterClientVisibleFiles` gets a new branch: `else if (file.scope === 'website_asset') { if (await getWebsiteByIdForRequester(context, file.relatedId)) results.push(file); }`. No new scope value is introduced; the existing one is completed, exactly as Phase 4 anticipated.

### 2l. Image optimization

**Correction (review Q5, approved as drafted)**: architecture § 13's own wording ("optimized responsive variants without requiring a paid image-transformation service") is read literally — an in-process library (`sharp`) invoked at upload time inside `StorageProvider.upload()`'s existing call path, producing a small set of responsive variants alongside the original (never discarding it). No new adapter/interface; this is a transformation step, not a storage concern, so it does not belong in the `StorageProvider` interface itself.

### 2m. Breakpoint overrides

**Correction (review finding #6, resolved alongside § 2e)**: no dedicated column — reserved as a documented shape within any section's `settings`: `{ base: { ...values }, breakpoints: { mobile: { ...overrides }, tablet: { ...overrides } } }`. Both the version-compare diff (§ 2c) and the per-property editing-level classification (§ 2e) must be aware of this nested shape when walking a settings object, rather than treating `settings` as a flat key-value map.

### 2n. Starting modes and library governance

Four starting modes (`template`, `page_kit`, `guided`, `blank`) are represented as `Website.startingMode`, recorded for provenance; only `blank` and `template` need to produce a real starting `draftSchema` in this phase's first slice (a template's schema is copied in at creation time, same fork-not-reference principle as § 2a). `page_kit` (a partial, page-level starting point) and `guided` (a wizard-driven assembly) are deferred to a later slice once the section library (§ 2d) and starting-schema-generation path exist to build on. Library governance (curating/publishing/deprecating platform- or agency-level `DesignSystem`/`SectionDefinition` templates) is its own late slice, gated by `builder.manage` — a new permission granted to `administrator` + `project_manager` only, matching `projects.change_stage`'s "significant, not day-to-day" precedent.

## 3. Permission/role summary

| Permission | Grantees |
|---|---|
| `builder.edit` | designer, advanced_designer, developer (employee); client_owner, marketing, content_editor (client) |
| `builder.publish` | administrator, project_manager, advanced_designer, developer |
| `builder.manage` (library governance, editor assignments) | administrator, project_manager |

## 4. Testing priorities (informed directly by ADR 0007's own history)

1. Raw unscoped query throws, for every one of the 7 new guarded models.
2. `WebsiteVersion`'s client-visibility split (published/approved/own-submissions only) — a direct regression test analogous to the one that caught Message's original bug, written *before* any caller could rely on the wrong order.
3. Per-property editing-level rejection: a Basic-assigned editor attempting to change a single Professional-tier property within an otherwise-Basic-editable section is rejected, even though the section as a whole is editable at their level.
4. `requiresReview` forcing `pending_review` status regardless of editing level, for both a per-property-flagged field and a structural page/navigation change.
5. `WebsiteEditorAssignment` rejects `editingLevel: 'advanced'` for a client-membership target, and rejects an assignment for a user with no membership at the website's own tenant.
6. `website_asset` file visibility: a client sees a `website_asset` file only when it's tied to their own visible `Website`, mirroring the existing `task_attachment` test shape exactly.
7. Cross-agency isolation for every new table (the standard suite-wide pattern).
8. `SectionDefinition`'s OR-scoped listing (system-defined + own-agency) — a dedicated test proving an agency never sees another agency's custom library, and a client sees their own managing agency's library, not a different agency's.

## 5. Suggested slice order

1. `DesignSystem` + `Website` + `WebsiteVersion` (schema/versioning foundation, including the client-visibility split) + `blank`/`template` starting modes + the guard/accessor infrastructure extension. Highest-risk slice — escalate again before merging if anything in implementation diverges from this plan's resolved design.
2. `SectionDefinition` library (including the OR-scoped tenancy accessor) + a minimal preview renderer that renders a `draftSchema` (the major gate's "renderer" half).
3. `builder.edit`/`builder.publish` permissions + `WebsiteEditorAssignment` + per-property editing-level enforcement + `requiresReview` classification (the secondary major gate, in full — this is the slice the review most emphasized getting right).
4. Autosave + named checkpoints + compare + restore (the major gate's "version history" half).
5. Asset manager: `website_asset` → `CLIENT_FACING_SCOPES`, `sharp`-based responsive image variants.
6. Content scopes (§ 2f) + the form builder (§ 2j, wired to `ClientRequest` as its one real submit target).
7. `WebsiteComment` + `WebsiteEditLock` + `WebsitePresence`.
8. `page_kit`/`guided` starting modes + template/section/design-system library governance (`builder.manage`).
9. Final full-phase review (schema-stability + authorization focus, mirroring Phase 4's closing pass) + completion report.
