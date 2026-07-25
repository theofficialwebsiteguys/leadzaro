# Leadzaro Planning and Claude Build Package

Prepared from the uploaded `leadzaro.zip` repository and the full product-definition discussion with Jared.

## What this package contains

1. `01_REPOSITORY_AUDIT.md` — what already exists, what is reusable, the main risks, and the migration approach.
2. `02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` — the authoritative product and technical architecture for the full platform.
3. `03_CLAUDE_MASTER_CONTROLLER_PROMPT.md` — the permanent operating prompt for Claude Code. It controls phased work, review loops, regression testing, documentation, and stop conditions.
4. `04_PHASE_1_IMPLEMENTATION_PROMPT.md` — the first repository-specific implementation prompt.
5. `05_PHASE_COMPLETION_REPORT_TEMPLATE.md` — the report Claude must complete at the end of every phase.
6. `06_PHASES_2_TO_8_ROADMAP.md` — scoped future phases and their acceptance gates.

## Recommended use

1. Rotate the credentials that were present in the uploaded `.env` before sharing or continuing development.
2. Create a clean Git checkpoint of the current working application. The uploaded repository has only the original Angular scaffold committed; nearly all Leadzaro application code is currently modified or untracked.
3. Put files 2–6 into `docs/leadzaro/` in the repository.
4. Open Claude Code at the repository root.
5. Paste `03_CLAUDE_MASTER_CONTROLLER_PROMPT.md` first.
6. Then paste `04_PHASE_1_IMPLEMENTATION_PROMPT.md`.
7. Require Claude to complete the Phase 1 report and stabilization gates before beginning Phase 2.

## Important operating rule

“Perfect” does not mean an endless rewrite loop. For this project, a phase is complete when:

- all stated acceptance criteria pass;
- existing working behavior has not regressed;
- no unresolved critical or high-severity defect remains;
- scoped security, accessibility, data-integrity, and usability reviews pass;
- migrations apply and roll back safely;
- the frontend and backend validation commands pass;
- documentation matches the implemented system; and
- remaining lower-priority improvements are recorded rather than silently expanding the phase.
