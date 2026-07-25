# CLAUDE.md — Leadzaro

Operating rules for Claude Code in this repository. These are permanent and apply across all future sessions and phases.

## Authoritative documents

1. `docs/planning/02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` is the authoritative Leadzaro product and architecture specification. Architecture and product decisions must conform to it.
2. `docs/planning/03_CLAUDE_MASTER_CONTROLLER_PROMPT.md` governs implementation, testing, review loops, regression checks, and phase completion for all phased work.
3. `docs/planning/01_REPOSITORY_AUDIT.md`, `04_PHASE_1_IMPLEMENTATION_PROMPT.md`, `05_PHASE_COMPLETION_REPORT_TEMPLATE.md`, and `06_PHASES_2_TO_8_ROADMAP.md` are supporting planning documents in the same directory.

## Permanent requirements

1. Only one implementation phase may be active at a time.
2. Existing functionality must be preserved unless deliberately migrated — no incidental regressions.
3. No later phase may begin until the current phase passes its measurable completion gates and has a completion report (see `05_PHASE_COMPLETION_REPORT_TEMPLATE.md`).
4. Permissions and authorization must be enforced server-side. Frontend visibility/hiding is never a substitute.
5. Never expose or commit secrets, populated environment files, credentials, private keys, or production data. `.env` stays untracked; only `.env.example` with placeholder values is committed.
6. Major architecture changes must be justified against the authoritative specification (`02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md`) and recorded as an architecture decision.
7. Before relying on any claim in the repository audit, verify it against the actual current code — the audit is a snapshot, not a live source of truth.
8. Never perform production deployment, live DNS changes, real Stripe charges, destructive remote operations, or irreversible production migrations.

## Escalation

For major architecture, authorization, billing, migration, code-generation, source-control, or deployment decisions — or when a meaningful failure survives two normal repair attempts — use the `fable-phase-reviewer` subagent (read-only, high-effort review) rather than resolving it purely inline. See `.claude/agents/fable-phase-reviewer.md` for exact trigger conditions.
