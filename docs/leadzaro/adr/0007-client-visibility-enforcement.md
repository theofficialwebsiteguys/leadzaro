# ADR 0007: Client-visibility enforcement is a runtime model-layer guard, not a per-endpoint convention or a lint rule

## Status

Accepted (Phase 4).

## Context

Phase 4's major gate is explicit: client users must never see internal notes, financial margins, unrelated projects, or other client data. The initial proposal was a single shared query-scoping helper (`scopeToRequesterVisibility()`) that controllers would call on every list/get endpoint touching `Task`, `Message`, `ProjectChannel`, `File`, `ClientRequest`.

This was escalated to an independent `fable-phase-reviewer` pass before any migration or route code was written, per CLAUDE.md's rule for major authorization decisions.

## Decision

**Rejected**: a per-endpoint "remember to call the helper" convention, on its own, as the enforcement mechanism.

The review found this exact failure class has already shipped once in this codebase: Phase 1's impersonation feature originally had no tenant check at all until its own closing review caught it (see `server/migrations/20260725120008-add-organization-managing-agency.js`'s own comment). A convention-based helper is the same shape of defense that already failed here once, now applied to a strictly higher-stakes boundary — cross-client data leakage between paying customers, not an internal admin capability. The concrete failure mode: a future single-record detail endpoint, copied from a neighboring *employee-only* controller (of which there will be many, since employees get broad agency-wide access), has no structural reason to route through a helper a developer might mentally file under "list endpoints only."

**Accepted instead — two layers:**

1. A sanctioned repository module, `server/core/authorization/clientVisibleModels.js`, is the *only* way any controller reads `Task`, `Message`, `ProjectChannel`, `File`, `ClientRequest`, or `Project` for a request that might be client-originated. It exports complete query functions (not partial `where`-fragments a caller could forget to merge), each applying the correct scoping internally from `context.membership.membershipType`.
2. A runtime Sequelize `beforeFind`/`beforeCount` hook on each of those models throws immediately unless the query's options carry an internal marker (`options.__visibilityScoped === true`) that only `clientVisibleModels.js` sets. A controller that imports the raw model and queries it directly gets a loud, immediate runtime error in every environment — including production — rather than a silent leak.

The review's own first suggestion for the "structural check" layer was a custom ESLint `no-restricted-imports` rule flagging any controller importing these models directly. **This was rejected as the actual enforcement mechanism** once repository evidence showed this repo has no ESLint config, no lint script, and no CI workflow at all (verified directly: no `.eslintrc`/`eslint.config.js`, no `eslint` in `package.json`, no `.github/workflows`). A lint rule that nothing ever runs automatically provides *weaker* real-world protection than the convention it was meant to replace — it only fires if a developer remembers to run the linter, which is the exact same reliance-on-memory failure mode being designed against. The Sequelize hook fires unconditionally at runtime regardless of whether anyone lints anything, and is directly testable with a unit test that calls the raw model and asserts it throws.

A third, smaller decision folded into the same review: any active employee membership at the project's owning agency can read a project's internal (non-client-visible) content, regardless of their own `ProjectAssignment` on that specific project. `ProjectAssignment` governs task assignment/ownership, not read access — matching the architecture's description of project-focused internal notes as agency-employee-readable, a separate concern from the client-visibility boundary this ADR is actually about.

## Known limitation, found empirically after implementation, not just theorized

Sequelize's `beforeFind`/`beforeCount` hooks fire only for the *top-level* model of a query — an `include` that joins in a guarded model as an association does **not** trigger that guarded model's own hooks, because Sequelize builds one combined SQL query with a `LEFT OUTER JOIN` rather than issuing a separate `Model.findAll()` call per included association. Verified directly: `ProjectAssignment.findAll({ include: [{ model: Project, as: 'project' }] })` — `ProjectAssignment` is unguarded and `Project` is guarded — succeeds without the `__visibilityScoped` marker anywhere, silently returning unfiltered `Project` data through the join.

This means the guard as implemented protects against "a controller queries a guarded model directly," but not against "an unguarded model's query happens to `include` a guarded model as an association." The mitigating rule, until/unless a stronger structural fix is built: **a guarded model (`Project`, `ProjectFinancials`, and later `Task`/`Message`/`ProjectChannel`/`File`/`ClientRequest`) is never `include`d as an association from another model's query anywhere in this codebase.** Anything needing both an unguarded model and a guarded one fetches each separately (the guarded one via `clientVisibleModels.js`) and correlates in application code. This is checked as part of every Phase 4 slice's own review, and re-checked explicitly in the phase's final full-review pass before the completion report — a repo-wide grep for `include:` alongside any guarded model name is the concrete verification step.

## Second real bug found empirically (Slice 6), not just theorized

`getMessageByIdForRequester`/`listMessagesForRequester` (Slice 3) were themselves unsafe, independent of the `include`-bypass gap above. A `Message` has no visibility flag of its own — it inherits visibility entirely from its `ProjectChannel` — but these two functions originally scoped `Message` by tenant columns alone (`organizationId`/`agencyOrganizationId`), which are identical for a project's client-visible and internal channels alike. The only reason Slice 3's own tests passed was that `messagingService.listMessages` always calls `getChannel` (which does correctly filter by `visibility: 'client'`) *before* calling `listMessagesForRequester` — a caller-order dependency, which is exactly the failure class this whole ADR exists to eliminate.

This surfaced when Slice 6's `File` visibility filter called `getMessageByIdForRequester` **directly**, to check whether a `message_attachment` file's underlying message was client-visible, skipping the `messagingService` call order entirely — and it leaked an internal-channel message (and its file) to a client, caught by a dedicated test before this slice was committed. Fixed by making `getMessageByIdForRequester`/`listMessagesForRequester` cross-check the message's channel via `getChannelByIdForRequester` themselves (never via an `include` of the guarded `ProjectChannel` model, consistent with the section above), so both functions are now safe to call from anywhere, not just from behind `messagingService`'s own gate.

The lesson generalized: **a model whose visibility is inherited from a different guarded model must re-derive that visibility itself, inside `clientVisibleModels.js`, every time — never assume a caller already checked the parent.** This is now the standard this module holds itself to for `File`'s own `task_attachment`/`message_attachment` scopes (§ "File's client-visibility rule" below), verified by tests that call these functions directly rather than only through a service that happens to check the parent first.

## Consequences

- Every new client-facing query in this phase and beyond must go through `clientVisibleModels.js`, not a raw model import. This is a real constraint on future development, not just this phase's own code — anyone adding a new client-portal read path must extend that module rather than reach for the model directly.
- The hook's runtime cost is negligible (a synchronous options check before the query executes), but it does mean these five models cannot be queried anywhere in the codebase — including future employee-only admin tooling — without going through the sanctioned module or explicitly setting the internal marker. This is intentional friction, not an oversight.
- If this repository ever adopts real ESLint/CI tooling later, adding the `no-restricted-imports` rule as a second, earlier-feedback layer (catching the mistake at review time instead of at first test run) would be a strict improvement, not a reversal of this decision — the runtime guard should remain regardless, since a lint rule can still be silenced by a comment or skipped by a rushed PR in a way a runtime throw cannot.
- Proven by a dedicated test (`server/tests/projects.test.js` or equivalent): a raw `Task.findAll()` call bypassing `clientVisibleModels.js` throws; the module's own equivalent call succeeds and correctly filters for both client and employee contexts.
