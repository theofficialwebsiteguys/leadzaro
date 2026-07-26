# Claude Code Phase 4 Prompt — Agency Operations and Website Guys Client Portal

Phase 3 (Stripe billing, idempotent webhook processing, client conversion, subscription lifecycle sync, automatic client-user invitation) is complete, twice-reviewed (design + final full-phase pass), tested (87/87 backend, 18/18 frontend), and checkpointed — see `docs/leadzaro/phase-3-completion-report.md`. This is the largest phase boundary yet, scoped per `docs/planning/06_PHASES_2_TO_8_ROADMAP.md` § "Phase 4" and `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` §§ 7, 10, 11, 12, 13, 21 — re-read all of these, and the current repository, before trusting anything else in this prompt.

## What Phase 3 actually delivered (the foundation Phase 4 builds on — re-verify, don't assume)

- Every client `Organization` has `type: 'client'`, `managingAgencyOrganizationId`, and (if created before Phase 4) `ConversionAttempt.projectSetupPending: true` — **Phase 4's first obligation is a migration that creates a real `Project` row for every client organization that doesn't have one yet**, including every Phase 3 conversion. This was a deliberate Phase 3 architecture decision (see `current-phase-plan.md` § 2d/7 in the Phase 3 history, preserved in git), not an oversight: Phase 3 built nothing project-shaped specifically so Phase 4 could design the real schema once, informed by this phase's actual requirements, rather than migrating away from a guessed-wrong Phase 3 stub.
- `BillingAccount`/`Subscription` already exist per client organization — Phase 4 does not touch billing; it hangs projects/tasks/files/messages/requests off the same client `Organization` billing already established.
- The `agencyOrganizationId` denormalization pattern (used by `Opportunity`, `Contact`, `Location`, `PaymentLinkRequest`, `ConversionAttempt`) is the established tenant-scope column for every new agency-scoped table — never resolve tenancy via a join through the client organization.
- `req.context.membership.membershipType` (`'employee'` | `'client'`) is already available on every authenticated request via `resolveContext()` — this is the primary signal Phase 4's entire client-visibility boundary hangs off of.
- The adapter-interface pattern (`EmailAdapter`, `EnrichmentAdapter`, `StripeAdapter` — abstract base, Mock, Disabled, cached factory keyed by an env var) is now used three times in this codebase; Phase 4 needs it twice more (Google Calendar for meetings, Google Cloud Storage for files) — no real credentials for either exist in this environment.
- `Invitation`, `recordAudit()`, `Notification`/`getEmailAdapter()` are the established patterns for anything Phase 4 needs to invite, audit, or notify about.
- `CLIENT_ROLES` (`client_owner`, `project_contact`, `marketing`, `billing_contact`, `content_editor`, `viewer`) exist today with only `BASE_SELF_SERVICE_PERMISSIONS` — Phase 4 is explicitly the module these roles were reserved for (documented in `catalog.js` since Phase 1), exactly like Phase 3 was the first real module for the `billing` employee role.

## Phase 4 primary outcomes (from the roadmap — verify scope against it directly)

- Projects, templates, stages, soft gates, launch checklist.
- Project owner and multi-role assignments (one employee may fill several roles on one project).
- Tasks/subtasks; board/list/calendar/timeline views; workload and time tracking.
- Client-visible milestones/tasks (an explicit visibility flag, not a separate parallel data model).
- Client requests and a unified support queue; a separate free-form content request/inbox.
- Role-based project channels and internal notes (employees have channels/notes clients never see).
- Meeting request/confirmation and a Google Calendar adapter.
- Organization/project files using Google Cloud Storage (adapter interface; no real GCS credentials exist).
- Client dashboard with "last-worked context."
- Ongoing support after launch; a cancellation request workflow.
- Audit and notifications wired across all of the above.

## Phase 4 major gate

**Client users must never see internal notes, financial margins, unrelated projects, or other client data.** This is an authorization/isolation gate, not a UI-hiding concern — CLAUDE.md rule 4 (permissions enforced server-side) applies with unusual literalness here: every query touching Task/Message/ProjectChannel/File/ClientRequest must filter server-side by both tenant (`agencyOrganizationId`/`organizationId`) and visibility (`isClientVisible`/`channel.visibility`) whenever the requester's `membershipType === 'client'`, with no client-hideable frontend fallback.

## Phase 4 non-goals (do not start these)

Website builder (Phase 5), Angular code generation (Phase 6), production deployment (Phase 7), SEO (Phase 8). Do not build a generic real-time chat system beyond what §11 specifies (project/role-based channels, not unrestricted client-to-employee messaging). Do not attempt real Google Calendar OAuth or real GCS uploads — mock/disabled adapters only, per the standing external-services rule, until real credentials exist.

## Before writing code

1. **Escalate the core data model and client-visibility authorization boundary to `fable-phase-reviewer` before writing any migration.** This phase's major gate is explicitly an authorization/isolation concern — exactly the category CLAUDE.md's escalation rule names. At minimum, the escalation should resolve: the `Project`/`ProjectAssignment`/`Task`/`ProjectChannel`/`Message`/`ClientRequest`/`File`/`Meeting` schema shapes; how `isClientVisible`-style filtering is enforced consistently (a shared query helper vs. per-controller checks — inconsistency here is exactly how a real leak would happen); and the shape of the mandatory Phase-4-opening migration that backfills a `Project` for every pre-existing client organization.
2. Re-run Phase 3's acceptance gates once more to confirm nothing has drifted (`npm run test:backend`, `ng test`, `ng build`) — a fresh phase boundary's job even if this prompt says they passed.
3. Produce `docs/leadzaro/current-phase-plan.md` (overwrite — it's a per-phase working document; every prior version is preserved in git history) with an evidence audit and acceptance matrix before writing the first migration.
4. Build `GoogleCalendarAdapter` and a `StorageProvider`/GCS adapter (mirroring `EmailAdapter`/`EnrichmentAdapter`/`StripeAdapter`) with mock/disabled modes before any real Google Calendar or GCS SDK call is wired in.
5. Given the size of this phase, plan for multiple implementation slices (Project/stages first, since the backfill migration blocks everything else; then tasks; then channels/messages — the highest-risk visibility boundary; then requests/content inbox; then meetings; then files; then dashboard/notifications wiring; then cancellation workflow), each tested and regression-checked before the next begins, with a final full-phase review before the completion report — mirroring Phase 3's two-pass review pattern, scaled to this phase's size.
