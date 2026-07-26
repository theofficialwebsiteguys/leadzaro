# Phase 4 Implementation Plan — Agency Operations and Website Guys Client Portal

## 1. Evidence audit

(unchanged from the pre-review draft — see git history for the full text.) Key facts re-confirmed by the review with direct code checks:

- The Phase-1 demo client organization (`server/migrations/20260725120004-seed-website-guys-and-rbac.js`) has a valid `managingAgencyOrganizationId` (backfilled by migration `20260725120008`) but **no `ConversionAttempt` row at all** — it predates Phase 3 and was never created via `conversionService.convertOpportunityToClient`. Every real Phase 3 client conversion, by contrast, always has a `ConversionAttempt` (both the webhook and manual-conversion paths share that one code path).
- `managingAgencyOrganizationId` is set at prospect-creation time and never touched by conversion — safe, stable source of tenancy for every client organization, including the demo client.
- **No ESLint config, lint script, or CI workflow exists anywhere in this repository** (checked directly: no `.eslintrc`/`eslint.config.js`, no `eslint` in `package.json` scripts or dependencies, no `.github/workflows`). This directly affects § 2g below — a lint-based enforcement mechanism would have zero automatic enforcement in this repo today, since nothing runs a linter automatically.

## 2. Key architecture decisions — reviewed by `fable-phase-reviewer`; this section reflects the corrected, accepted design

### 2a. The Phase-4-opening backfill migration — accepted with a required correction

**Correction (found by direct code check, not just design review)**: `Project.agencyOrganizationId` must be copied from `Organization.managingAgencyOrganizationId` directly, **never** from `ConversionAttempt.agencyOrganizationId` — the demo client has no `ConversionAttempt` at all, and sourcing tenancy from it would leave that one `Project` row untenanted. Only `ownerUserId` and `sourceConversionAttemptId` are conditionally populated from a matching completed `ConversionAttempt` (`resultingClientOrganizationId = organization.id, status = 'completed'`) where one exists, tolerating `null` for the demo client. A migration test specifically asserts the demo client's resulting `Project.agencyOrganizationId` equals the Website Guys org id — the generic "one Project per client org" assertion alone would not catch this class of bug.

### 2b. Core schema — accepted with three required corrections

- `Project`, `ProjectAssignment`, `Task`, `TimeEntry`, `ProjectChannel`, `Message`, `ClientRequest`, `ContentInboxItem`, `Meeting`, `File`, `CancellationRequest` as previously proposed (see git history for the full per-field list), with:
- **Correction 1 (the major-gate wording itself)**: architecture § 10's major gate names "financial margins" explicitly. No cost/profitability field may live directly on `Project` — a boolean/flag can only protect a *row*, not a *field*, and `Project` rows must themselves be client-visible (stage/health/owner). A new `ProjectFinancials` table (one-to-one with `Project`, agency-only, never reachable by any client-facing route) holds internal cost/profitability data instead.
- **Correction 2**: client-visibility for `File` requires **both** `isPrivate = false` **and** `scope` in an explicit client-facing allowlist (`project`, `task_attachment` on a client-visible task, `message_attachment` in a client-visible channel, `request_attachment`) — `isPrivate` alone is not sufficient, since e.g. a non-private `website_asset` file has no inherent tie to a specific client-visible context.
- **Correction 3**: `Meeting` needs a denormalized `agencyOrganizationId` (and `organizationId`) column — every other new table in this phase has a direct tenant-scoping column; `Meeting` was the one gap, relying only on a join through `Project`.
- **Correction 4**: `CancellationRequest` gets an explicit `initiatedBy` (`'client'|'agency'`) field — the workflow is described as client-initiated, but the state machine as proposed didn't distinguish who's actually driving a given transition.

### 2c. Project stage catalog and soft gates — accepted as proposed

Architecture § 10's exact wording ("Transitions use soft gates... authorized users may proceed with an override reason. Launch has the strongest checklist") applies uniformly — "strongest checklist" describes the *rigor of the checklist*, not a different *gate mechanism* for Launch specifically. Override-with-reason restricted to `projects.manage`/`projects.change_stage`-holding roles (never designer/developer/support, never any client role) is a spec-consistent tightening of *who* counts as "authorized," not a deviation from the soft-gate design.

### 2d. The client-visibility authorization boundary — the phase's major gate; the original proposal (a shared helper, called per-endpoint) is **rejected as insufficient on its own**

The review found this failure class has **already shipped once in this exact codebase**: Phase 1's impersonation feature originally had no tenant check at all until its own closing review caught it (documented in `server/migrations/20260725120008-add-organization-managing-agency.js`'s own comment). A "remember to call the helper" convention is the same shape of defense that already failed once here, now applied to a strictly higher-stakes boundary (cross-client data leakage, not an internal admin capability). Concrete failure mode: a future single-record detail endpoint (e.g. `GET /projects/:id/tasks/:taskId`), copied from a neighboring *employee-only* controller pattern (of which there will be many, since employees get broad access), would have no structural reason to route through a helper a developer might mentally file under "list endpoints only."

**Corrected design — two layers, not one:**

1. **A sanctioned repository module** (`server/core/authorization/clientVisibleModels.js`) is the *only* way any controller reads `Task`, `Message`, `ProjectChannel`, `File`, `ClientRequest` (and `Project` itself, for the tenant half). It exports complete query functions (e.g. `listProjectTasks({ context, projectId })`, `getTaskById({ context, taskId })`), each of which always applies the correct scoping internally based on `context.membership.membershipType` — never a raw `where`-fragment a caller could forget to merge in.
2. **A runtime Sequelize-hook guard on the models themselves**, not a lint rule. The review's own suggested enforcement was a custom ESLint `no-restricted-imports` rule — **rejected as the enforcement mechanism** once repository evidence showed this repo has no ESLint config, no lint script, and no CI workflow at all (checked directly, see § 1). A lint rule nothing ever runs automatically provides *weaker* real-world protection than the "remember to call the helper" convention it was meant to replace. Instead: a `beforeFind`/`beforeCount` hook on `Task`/`Message`/`ProjectChannel`/`File`/`ClientRequest` throws immediately unless the query's options carry an internal marker (`options.__visibilityScoped === true`) that only `clientVisibleModels.js` sets after applying the real filter. A controller that imports the raw model and queries it directly gets a loud, immediate runtime error — in every environment, including production, with no dependence on anyone running a linter — rather than a silent data leak. This is directly testable (a unit test asserts a raw `Task.findAll()` call throws; the repository module's own call succeeds and filters correctly), and needs no new toolchain, unlike standing up ESLint/CI from scratch.
3. **Employee project-level scoping, resolved as an explicit decision**: any active employee membership at the owning agency can read a project's internal (non-client-visible) content, regardless of their own `ProjectAssignment` on that specific project — matching the architecture's description of company-wide employee context ("project-focused internal notes" implies internal notes are agency-employee-readable, distinct from the fully separate client-visibility boundary; `ProjectAssignment` governs *task assignment/ownership*, not *read access*). Recorded here explicitly rather than left implicit.

This whole decision — the two-layer enforcement plus the reasoning for rejecting the lint-rule approach given this repo's actual toolchain — is recorded as ADR 0007.

### 2e. External adapters — accepted as proposed

`GoogleCalendarAdapter`, `StorageProvider`/GCS adapter, mirroring the established `EmailAdapter`/`EnrichmentAdapter`/`StripeAdapter` pattern exactly. Built in parallel with the core schema work since neither touches the client-visibility boundary.

### 2f. Client dashboard "last-worked context" — accepted as proposed

Computed at request time, not persisted — mirrors Phase 2's dashboard.

## 3. Testing priorities

1. **The major gate, proven directly, including the structural-defense test the review specifically asked for**: a raw `Task.findAll()`/`Message.findAll()`/etc. call bypassing `clientVisibleModels.js` throws; the repository module's own calls correctly filter for a client-membership context (no internal Task, no internal ProjectChannel/Message, no other organization's Project, no other agency's data) and correctly do not filter for an employee-membership context within their own agency.
2. Cross-agency isolation re-proven for every new agency-scoped entity, including `Meeting` (corrected to carry its own `agencyOrganizationId`).
3. The Phase-4-opening backfill migration creates exactly one Project per existing client organization, **with a specific assertion that the demo client's resulting `Project.agencyOrganizationId` is correctly populated from `Organization.managingAgencyOrganizationId`, not left null**.
4. `ProjectFinancials` is never reachable via any client-facing route, proven by a dedicated test, not just absent from today's route list.
5. Soft-gate override requires a reason and is audited; a role without `projects.change_stage`/`projects.manage` cannot override; Launch is not a silent hard block but does require the same override permission.
6. One user holding multiple `ProjectAssignment` role slots on one project.
7. `File` client-visibility requires both `isPrivate = false` and an allowlisted `scope` — a non-private `website_asset` file is not client-visible by that rule alone.
8. Regression: every Phase 1/2/3 workflow continues to pass unchanged.

## 4. External services

No real Google Calendar or Google Cloud Storage credentials exist in this environment. Both adapters are built and fully tested against their mock implementations first.

## 5. Suggested slice order

1. `Project` + `ProjectAssignment` + `ProjectFinancials` + stage catalog + soft-gate override audit + the corrected Phase-4-opening backfill migration + the `clientVisibleModels.js`/Sequelize-hook enforcement infrastructure (built now, even though most of the models it will guard don't exist until later slices — `Project` itself is the first thing it scopes by tenant).
2. `Task`/subtasks + `TimeEntry` + list/board/calendar view query shaping (backend) + basic frontend views — first real use of the `isClientVisible` guard.
3. `ProjectChannel` + `Message` — the client-visibility boundary's highest-risk case (internal vs. client channels); tested exhaustively per § 3.1.
4. `ClientRequest` + unified support queue + `ContentInboxItem`.
5. `Meeting` + `GoogleCalendarAdapter` (mock/disabled).
6. `File` + `StorageProvider`/GCS adapter (mock/disabled) — the corrected two-part visibility rule (§ 2b correction 2).
7. Client dashboard ("last-worked context") + notifications wiring across everything above.
8. `CancellationRequest` workflow (with the corrected `initiatedBy` field).
9. Final full-phase review (isolation/security focus, mirroring Phase 3's closing pass) + completion report.
