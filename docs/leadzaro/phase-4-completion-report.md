# Phase 4 Completion Report

## Phase

- Phase number/name: Phase 4 — Agency Operations and Website Guys Client Portal
- Branch/checkpoint: `main`, commits `936dc42` through `8927b67` (slices 1–8 plus the closing review's fix commit)
- Started: 2026-07-26
- Completed: 2026-07-27
- Overall result: **Complete**, with a documented deferred backlog (see below), none blocking.

## Scope delivered

A complete client-facing Projects module — the "Website Guys Client Portal" — covering every workflow from a converted client's first Project through ongoing support and eventual cancellation, built in 8 slices on top of Phases 1–3 (auth/RBAC/multi-tenancy, CRM, Stripe billing/conversion):

1. **Client-visibility enforcement architecture (ADR 0007)**: a runtime Sequelize `beforeFind`/`beforeCount` hook (`visibilityGuard.js`) installed on every guarded model, throwing on any query that doesn't carry the `__visibilityScoped` marker. `clientVisibleModels.js` is the single sanctioned place that sets it — every controller/service reads guarded data only through its exported functions. Chosen over a convention-based helper (rejected — this exact failure class already shipped once, in Phase 1's impersonation feature) and an ESLint rule (rejected — this repo has no lint/CI infrastructure, so a lint rule is weaker than a runtime guard). Two real gaps were found and handled during this phase, both documented in the ADR: Sequelize hooks don't fire on `include`d associations (mitigated by a rule: never `include` a guarded model, always fetch separately and correlate in code), and a genuine pre-commit bug where Message's visibility functions relied on caller order instead of independently re-verifying their parent channel (fixed, with a regression test).
2. **Project core**: `Project` (9-stage catalog with advisory soft-gate checklists — a real human confirm/override gate, not a rubber stamp, since no per-item mechanical completion tracking exists yet), `ProjectAssignment` (multi-role-slot), `ProjectFinancials` (margin/cost data split into its own agency-only table so no cost field ever lives directly on a client-visible `Project` row).
3. **Tasks**: `Task`/subtasks, `TimeEntry`, list/board views, `isClientVisible` gate.
4. **Messaging**: `ProjectChannel` (8 defaults: 7 client-visible + 1 internal) + `Message`, with thread replies and conversion to Task.
5. **Client requests**: `ClientRequest` (11 categories) + a unified cross-project support queue, `ContentInboxItem` for free-form content submission.
6. **Meetings**: `Meeting` + `GoogleCalendarAdapter` (mock/disabled/live), request → confirm/decline → cancel lifecycle.
7. **Files**: `File` + `StorageProvider`/GCS adapter (mock/disabled/live), a two-part client-visibility rule (`isPrivate: false` AND `scope` in an explicit client-facing allowlist, with task/message-attached files independently re-checking their parent's own visibility).
8. **Client dashboard**: a computed (not persisted) "last-worked context" aggregating each project's newest tasks/messages/requests/meetings, scoped through the same guarded accessors as every dedicated panel.
9. **Notifications**: task assignment, meeting requested/confirmed/declined, message mentions, client request submission, and cancellation requested/confirmed/withdrawn — all via Phase 1's existing `notificationService.notify()`, no schema changes.
10. **Cancellation workflow**: `CancellationRequest` with a server-derived `initiatedBy` ('client'|'agency') field, a requested → confirmed|withdrawn state machine, one pending request per project at a time.
11. **Frontend**: a single Projects screen with panels for detail/stage/health, dashboard, team assignments, financials (agency-only), tasks (list/board), messages, client requests, meetings, files, and cancellation — each panel's actions gated by the matching permission, enforced server-side first.

## Acceptance matrix

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| A client never sees internal notes, financial margins, unrelated projects, or another client's data (the phase's major gate) | `visibilityGuard.js` + `clientVisibleModels.js`, applied to all 10 guarded models | Dedicated visibility tests in every one of `projects/tasks/messaging/requests/meetings/files/cancellations.test.js`, plus the raw-unscoped-query-throws test per model | Done |
| Financial margin data never reachable by a client request | `ProjectFinancials` split into its own table, `projects.manage`-gated (no client role holds it), defensive throw on client context | `projects.test.js` | Done |
| A message's visibility is independently re-derived, never assumed already-checked by its caller | `getMessageByIdForRequester`/`listMessagesForRequester` re-verify channel visibility on every call | `messaging.test.js` direct regression test | Done |
| A file attached to a task/message is only client-visible if its parent is | Two-part rule in `filterClientVisibleFiles` | `files.test.js` (6 dedicated cases) | Done |
| A project's stage cannot silently skip an incomplete checklist | Soft-gate: `confirmed` or `overrideReason` required | `projects.test.js` | Done |
| Every future client conversion gets a Project + default channels exactly once | `ensureProjectForConversion`, called from both the webhook and manual conversion paths | `messaging.test.js` (`ensureProjectForConversion` describe block) | Done |
| A client dashboard shows only what that client could already see via each dedicated panel | `getLastWorkedContext` composes the same guarded accessors, adds no new visibility logic | `projects.test.js` (3 dedicated dashboard tests incl. cross-agency 404) | Done |
| A cancellation's `initiatedBy` is never trusted from client input | Derived server-side from `context.membership.membershipType` | `cancellations.test.js` | Done |
| Only one cancellation request may be pending per project | `requestCancellation`'s existing-pending-request guard (409) | `cancellations.test.js` | Done |
| A client cannot confirm/withdraw their own cancellation request | `cancellations.manage` restricted to administrator/project_manager, mirroring meeting confirm/decline | `cancellations.test.js` | Done |
| Message mentions cannot notify/email a user outside the project's own tenant | `filterMentionableUserIds` (added during the closing review) | `messaging.test.js` (2 dedicated tests: outside user dropped, in-tenant client mention allowed) | Done |
| A project assignment cannot reference a user with no membership at the project's agency | `addAssignment`'s membership check (added during the closing review) | `projects.test.js` | Done |
| A manual-conversion Project-setup failure is discoverable, not just logged | `project.setup_failed` audit entry + `?projectSetupPending=` filter on `GET /billing/conversions` (added during the closing review) | Code review (fable-phase-reviewer); no dedicated automated test yet — see Known risks | Partial |

## Repository changes

### Backend

- Modules/services: `server/core/authorization/{visibilityGuard.js,clientVisibleModels.js}`; `server/core/projects/projectCatalog.js`; `server/core/integrations/googleCalendar/googleCalendarAdapter.js`; `server/core/storage/storageProvider.js`; `server/modules/{projects,tasks,messaging,requests,meetings,files,cancellations}/` (service + controller + routes each); `ensureProjectForConversion` added to `server/modules/projects/projectService.js` and wired into `server/modules/billing/{webhookService.js,billingController.js}`.
- Routes/APIs: `/api/v1/projects` (+ `:id/{stage,health,assignments,financials,dashboard}`), nested `/api/v1/projects/:projectId/{tasks,channels,requests,content-inbox,meetings,files,cancellation-requests}`, plus `/api/v1/requests/queue` (the unified support queue). `GET /api/v1/billing/conversions` extended with a `projectSetupPending` filter.
- Authorization: new permissions `projects.{view,manage,change_stage}`, `tasks.manage`, `messages.post`, `requests.{create,manage}`, `meetings.{request,manage}`, `files.{upload,manage}`, `cancellations.{request,manage}` — each with its own idempotent seed migration, mirrored in `server/core/authorization/catalog.js`.
- Jobs/events: none new; notifications reuse Phase 1's synchronous `notify()`, no background scheduler yet.

### Frontend

- Routes/screens: no new route — the existing Projects screen (`src/app/features/projects/`) grew a panel per slice (detail/stage/health → dashboard → team → financials → tasks → messages → requests → meetings → files → cancellation).
- State/services: `src/app/core/services/{project,task,messaging,request,meeting,file,cancellation}.service.ts`; matching `src/app/core/models/*.model.ts`.
- Permission behavior: every panel action gated by `*hasPermission` directive / `org.hasPermission()`, matching the server-side permission required at the route — frontend hiding is never the only enforcement.
- Mobile/accessibility: reuses the app's existing table/card patterns; no dedicated mobile layout added this phase (noted as a deferred refinement below, alongside splitting the now-large Projects component into sub-components).

### Database

- New tables: `Projects`, `ProjectAssignments`, `ProjectFinancials`, `Tasks`, `TimeEntries`, `ProjectChannels`, `Messages`, `ClientRequests`, `ContentInboxItems`, `Meetings`, `Files`, `CancellationRequests`.
- Changed tables: none from earlier phases (Phase 4 is additive only).
- Indexes/constraints: every new table denormalizes `organizationId`/`agencyOrganizationId` (or, for `TimeEntries`, is scoped transitively through an already-guarded `taskId`) rather than relying on a join — deliberately, both matching this codebase's established convention and avoiding the `include`-bypass gap. `projectId`/`agencyOrganizationId` indexes on every project-scoped table.
- Backfills: `20260727120002-backfill-projects-for-existing-clients.js` creates a `Project` + 8 default channels for every pre-existing client `Organization` (sourcing `agencyOrganizationId` from `Organization.managingAgencyOrganizationId`, never `ConversionAttempt`, since the Phase-1 demo client predates Phase 3); `20260727140002-backfill-default-channels.js` is its channel-specific counterpart for the same backfill pass.
- Rollback behavior: every schema migration has a working `down()`; permission/role-grant seed migrations are intentionally not reversed, matching this repo's established precedent.

## Legacy compatibility

- Preserved workflows: Phases 1–3 (auth/RBAC, CRM pipeline, Stripe billing/conversion) are untouched except for the two documented `ensureProjectForConversion` call sites, added at the exact places `triggerClientInvitationIfNew` was already called from.
- Compatibility adapters: none needed — Phase 4 is new functionality layered on top of existing conversion/billing flows, not a migration of prior behavior.
- Deprecated fields/routes: none.
- Planned removal phase: N/A.

## Security and privacy

- Secret handling: `.env.example` documents `GOOGLE_CALENDAR_PROVIDER`/`GOOGLE_CALENDAR_CREDENTIALS_JSON`/`GOOGLE_CALENDAR_ID` and `STORAGE_PROVIDER`/`GCS_CREDENTIALS_JSON`/`GCS_BUCKET_NAME` with placeholder values only; `validateEnv()`'s `checkLiveProviderCredentials` refuses to boot in production with a `*_PROVIDER=live`/`google`-equivalent setting and missing/placeholder credentials. No real credentials anywhere in this repository.
- Authentication/session changes: none.
- Authorization/isolation tests: every guarded model has a dedicated "raw unscoped query throws" test plus cross-agency isolation tests; permission-boundary tests exist for every new permission (`viewer` cannot post/request-cancellation, `designer` cannot change stage/manage cancellations, a client cannot confirm/decline meetings or cancellations they requested).
- Input/file/webhook protections: file uploads are buffered in memory via `multer` (no local disk writes) straight into `StorageProvider.upload()`; no new webhook surface this phase.
- Impersonation/audit behavior: every state-changing action across all 8 slices (stage change, health override, assignment add/remove, financials update, task archive, request status/conversion, meeting confirm/decline/cancel, file delete, cancellation request/confirm/withdraw) is recorded via `recordAudit`, including the new `project.setup_failed` entry added during the closing review.
- **Closing-review finding, fixed before this report**: message mentions (`mentionedUserIds`, raw client input) could previously notify — and, for most recipients, send a real email to — an arbitrary user ID with no membership in the project's own organization or agency, entirely bypassing the visibility-guard architecture via the notification side channel. Fixed by `messagingService.filterMentionableUserIds`, which resolves actual active `OrganizationMembership` rows for the channel's tenant before persisting `mentionedUserIds` or notifying anyone; verified by two new direct regression tests.

## Validation commands run

- Dependency install: `npm install googleapis @google-cloud/storage multer` (reviewed diffs; `npm audit --json` shows 75 total vulnerabilities — unchanged from the pre-existing Angular-toolchain baseline, none attributable to these three packages).
- Frontend build: `ng build` — clean (only the pre-existing, unrelated `landing.component.scss` budget warning).
- Type check/lint: TypeScript diagnostics clean on every modified frontend file (checked incrementally via the editor's SonarLint/TS integration after each edit).
- Backend checks: `node -c` syntax check on every new/modified backend file before each migration run, every slice.
- Unit tests: `npm run test:backend` — **180/180 passing (23 suites)**.
- Integration tests: included in the same backend suite — `projects.test.js` (20), `tasks.test.js` (11), `messaging.test.js` (16), `requests.test.js` (10), `meetings.test.js` (9), `files.test.js` (11), `cancellations.test.js` (11), `externalAdapters.test.js` (5, Google Calendar/GCS mock adapters).
- Migration tests: all 19 Phase 4 migrations applied cleanly to the real dev database (`npm run migrate`) and to a freshly-recreated test database via Jest's `globalSetup` (drop/recreate/migrate before every run).
- End-to-end/manual checks: real headless-Chrome sessions (synthetic org/user/project via direct Sequelize creation, logged in through the real UI, synthetic data removed after) for: Projects detail/stage/checklist (slice 1), Tasks board (slice 2), Files upload/list/open/delete (slice 6), the Recent Activity dashboard proving client-vs-internal filtering end-to-end (slice 7), and the full cancellation request → pending banner (client) → confirm (PM) → history update lifecycle (slice 8) — each screenshot-and-text-verified.

## Review pass 1 — per-slice engineering (ongoing throughout the phase)

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High (security) | `ProjectAssignment.findAll({include:[{model:Project}]})` succeeds without the visibility marker — Sequelize hooks don't fire on `include`d associations | Documented as a known limitation in ADR 0007 with a mitigating rule (never `include` a guarded model); a dedicated test proves the limitation exists rather than silently assuming it's safe | `projects.test.js` |
| High (security) | `getMessageByIdForRequester`/`listMessagesForRequester` scoped by tenant columns alone, relying on `messagingService` always checking the channel first — an internal-channel message's attachment leaked when Slice 6's File filter called these functions directly, skipping that order | Both functions now independently re-verify channel visibility via `getChannelByIdForRequester`, unconditionally | Direct regression test in `messaging.test.js`; ADR 0007 updated with the full account |
| Medium | File client-visibility as originally proposed (`isPrivate: false` alone) would make a non-private `website_asset` file client-visible with no tie to any specific client-visible context | Corrected to a two-part rule: `isPrivate: false` AND `scope` in an explicit allowlist, with independent parent-visibility re-checks for attachment scopes | `files.test.js` (6 dedicated cases) |
| Medium | `Meeting` had no denormalized tenant-scoping columns, unlike every other new table this phase | Added `organizationId`/`agencyOrganizationId` directly to `Meeting` | Migration + model |

## Review pass 2 — final full-phase closing review (fable-phase-reviewer)

A dedicated final-phase review covering the entire phase (all 8 slices, not just the closing increment), per CLAUDE.md's escalation rule. Verified the visibility guard's actual application to all 10 models (not just documentation), permission-catalog-vs-seeded-migration consistency, tenant denormalization on every new table, `CancellationRequest.initiatedBy` server-side derivation, File's two-part rule, notification-recipient legitimacy, and test honesty (assertions check actual data content, not just status codes).

| Severity | Finding | Resolution | Verification |
|---|---|---|---|
| High | Message mentions (`mentionedUserIds`) accepted raw client input with no check that the mentioned user has any membership in the project's own organization or agency; `notify()` then created a Notification — and, for most users, sent a real email containing the message body — unconditionally. This bypassed the entire visibility-guard architecture via a side channel (writes/notifications) the guard never covers | Added `messagingService.filterMentionableUserIds`, checking active `OrganizationMembership` rows for the channel's `organizationId`/`agencyOrganizationId` before persisting `mentionedUserIds` or notifying | Two new tests: an outside user's mention is dropped from the persisted list and never notified; a legitimate client-side mention still works and still notifies |
| Medium | `addAssignment` only checked the target user exists anywhere in the system, never that they belong to this project's own agency — since `listAssignments` includes the user's name/email and is reachable by anyone with `projects.view` (including the client), a `projects.manage` holder could expose an unrelated user's PII cross-tenant | Requires an active `OrganizationMembership` at `project.agencyOrganizationId` before creating the assignment (422 otherwise) | New test: assigning a user with no membership at the project's agency is rejected with no row created |
| Medium | The manual-conversion path's `ensureProjectForConversion` failure was swallowed to a `console.error` only, with no durable, discoverable record — unlike the webhook path's `needs_attention` machinery from Phase 3 | Records a `project.setup_failed` audit entry (reusing existing audit infrastructure) and extends `GET /billing/conversions` with a `?projectSetupPending=` filter, making it a queryable worklist | Code review; no dedicated automated test added yet (see Known risks) |

No Critical findings. Both High findings (one from mid-phase review, one from the closing pass) are resolved and verified above. `npm run test:backend` re-run at 180/180 passing (was 177 before these three fixes).

## Regression verification

Every Phase 1–3 test suite re-run unchanged and passing alongside the 7 new/extended Phase 4 suites: authentication/sessions, organization isolation, RBAC combination/overrides, invitations, impersonation, CRM (opportunities, merge, scoring, dashboard, website audit, enrichment), public inbound leads, billing (payment links, webhook idempotency, conversion race, lifecycle sync, invitation), and the migration test suite. 180/180 backend, 18/18 frontend.

## Data migration evidence

- Empty DB result: all 19 Phase 4 migrations apply cleanly to an empty database.
- Legacy DB result: the backfill migration (`20260727120002`) correctly created exactly one `Project` + 8 channels for the pre-existing Phase-1 demo client organization, sourcing `agencyOrganizationId` from `Organization.managingAgencyOrganizationId` — verified directly (`projects.test.js`'s dedicated backfill spot-check), not assumed.
- Record counts before/after: one demo client organization before this phase's migrations; exactly one `Project` row and 8 `ProjectChannel` rows for it afterward, confirmed by test.
- Duplicate/loss checks: `ensureProjectForConversion`'s `findProjectByOrganizationIdSystemLevel` existence check prevents a second Project ever being created for the same organization; covered by the `ensureProjectForConversion` test in `messaging.test.js`.
- Rollback test: every Phase 4 migration has a working `down()`; not exercised via a full rollback-and-re-migrate cycle this phase (the existing `migrations.test.js` full-rollback test predates Phase 4 and was not extended to cover it — see Known risks).

## Manual configuration required

- **Google Calendar**: set `GOOGLE_CALENDAR_PROVIDER=live` plus real `GOOGLE_CALENDAR_CREDENTIALS_JSON`/`GOOGLE_CALENDAR_ID` in the untracked `.env` once a real Google Cloud service account and Calendar are provisioned. Until then, `GOOGLE_CALENDAR_PROVIDER=mock` (the current default) carries the entire meeting-confirmation workflow with clearly-labeled synthetic calendar events.
- **Google Cloud Storage**: set `STORAGE_PROVIDER=gcs` plus real `GCS_CREDENTIALS_JSON`/`GCS_BUCKET_NAME` once a real GCS bucket and service account exist. Until then, `STORAGE_PROVIDER=mock` carries the entire file upload/download/delete workflow with clearly-labeled synthetic storage.
- No secret values are or will be committed; only `.env.example` with placeholders is tracked.

## Deferred backlog

### Medium priority

- Extend `listConversionAttempts`'/`?projectSetupPending=` filter (added during the closing review) with a dedicated automated test proving the manual-conversion-failure path actually surfaces there — currently verified by code review only.
- A single known "client contact" is not tracked on `Project` (only an agency-side `ownerUserId`) — `client_request_submitted` and `cancellation_requested` (agency-initiated) notifications therefore have no one to notify on an agency-initiated action; both are documented, deliberate gaps rather than silent ones.
- Split the now-large `src/app/features/projects/projects.component.{ts,html,scss}` (grown by a panel every slice across 8 slices) into per-panel sub-components — noted internally as a refinement candidate throughout the phase, not yet done.

### Low priority

- No dedicated mobile layout for the Projects screen beyond the app's existing responsive table/card patterns.
- A "meeting requested" notification only reaches `project.ownerUserId`; there is no broader "everyone who handles meetings at this agency" notification, matching the same deliberate scope boundary as `client_request_submitted`.

### Deliberately deferred to later phase

- Real Google Calendar/GCS credentials and end-to-end verification against live services (see "Manual configuration required" above) — this environment has none, by design; both adapters are fully built and tested against their mock implementations.
- Per-item mechanical stage-checklist completion tracking (e.g. linking a checklist item to a specific completed Task/deliverable) — the current soft-gate (confirm-or-override) is the honest implementation given no such linkage exists yet; a later phase could add it without changing the gate's shape.
- Full entitlements/feature-gating for any Phase-4 functionality tied to a client's subscription plan — out of this phase's scope, matching Phase 3's own equivalent deferral.

## Known risks

- The manual-conversion `project.setup_failed` audit-trail fix (closing review, Medium) has no dedicated automated test yet — verified by code review and the existing `ensureProjectForConversion` happy-path tests, but the failure branch itself is untested. Low risk in practice (the failure requires `ensureProjectForConversion` to throw, which itself requires either a transient DB error or the `managingAgencyOrganizationId` invariant being violated), but flagged here rather than silently left unverified.
- `migrations.test.js`'s full-rollback-and-re-migrate test predates Phase 4 and was not extended to include Phase 4's 19 migrations in a full down/up cycle — each migration's `down()` was written and reviewed but not exercised end-to-end.
- No real Google Calendar/GCS account has ever been exercised against this integration (no credentials in this environment) — the adapter interface and mock behavior are well-tested, but real-provider field-shape assumptions (event id formats, signed-URL expiry behavior, etc.) are unverified until real credentials exist.

## Documentation updated

- README: not applicable (no root README changes needed for this phase).
- Architecture decisions: `docs/leadzaro/adr/0007-client-visibility-enforcement.md` (new, updated twice with empirically-found gaps); `docs/leadzaro/current-phase-plan.md` §§ 1–8 (evidence audit, corrected design, slice order, both review passes).
- API docs: none formal; routes documented inline via the phase plan and this report's acceptance matrix.
- Migration docs: inline comments in every new migration explaining its purpose, idempotency guarantee, and (where relevant) which architecture correction it implements.
- User/admin instructions: `.env.example` documents every new environment variable with placeholder values and inline comments.

## Readiness for next phase

- Ready: Yes
- Blocking reasons: none
- Recommended next-phase starting point: Phase 5 — Website Builder Foundation (per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md`).
- Generated next-phase prompt path: `docs/leadzaro/NEXT_PHASE_PROMPT.md` (to be rewritten for Phase 5 immediately after this report is finalized).
