# ADR 0012: Business overview dashboard and task-based Settings

## Status

Accepted.

## Decision

1. **Dashboard = business overview; Today = daily outreach.** `GET /api/v1/overview` (dashboard.view, employees) returns about four metrics, a de-duplicated "Needs attention" list, pipeline/client summaries, recent activity, domain health and an admin setup checklist. It reads only stored data — the same `SalesPayments`, stages, handoffs, clients and domain facts used by Sales, Reports, Clients and Domains — and cached Stripe/Namecheap status, never live provider calls.
2. **Scope is server-side.** "Team activity" needs `sales.view_team`; any other request is answered as "My activity". Revenue excludes Stripe test/mock payments and demo leads, renewals are never new sales, deal value is never revenue, and historical Won deals without a payment aren't counted. A disconnected source is reported as "not connected", not zero.
3. **Settings are organised by task** (`/app/settings/account|workspace|team|sales|integrations|notifications`), each section saving on its own, with an unsaved-changes guard.
4. **Where each setting lives (no duplicate stores):**
   - personal profile → `Users.name/phone`, `OrganizationMembership.title`
   - personal search defaults → the existing `Users.targetIndustry/serviceArea`; signature, radius and follow-up days → new `Users.preferences`
   - company profile → the agency `Organization` columns (ADR 0011); workspace defaults (timezone, default search location/keywords, follow-up days) → new `Organizations.settings`, editable with the new `workspace.manage` permission (administrators)
   - team access → the existing membership/invitation endpoints
5. **Settings change behaviour.** The workspace timezone sets "today", "overdue" and report day boundaries. Search defaults pre-fill Find Leads. `{{my_signature}}` uses the signature (default email templates now end with it). Muted notification categories aren't created (in-app) or sent (email), and only categories Leadzaro actually sends are listed.
6. **Integrations** show one status shape from real backend state. Stripe, SMTP, Twilio and Google keys stay in server configuration (setup steps shown to admins); Namecheap keeps its encrypted in-app connection. No secret is ever returned to the browser.

## Consequences

- `Users.salespersonType`, `companyName` and the legacy `role` are no longer shown (kept in the database). Access is shown from membership roles.
- The large renewals card was replaced by the compact domain-health summary; an upcoming expiry alone is not treated as a problem.
