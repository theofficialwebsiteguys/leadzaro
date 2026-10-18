# ADR 0016 — Guided, role-based workflow

Status: Accepted (2026-10-17)

## Context

Testing showed the app asked employees to navigate too much and decide too
early. Everyone saw the same Dashboard, Today, Leads and Reports, even though
the team now splits work into four roles:

- qualifiers find and research businesses;
- sales works the leads;
- client managers onboard the businesses sales wins;
- admins approve, review and pay.

There were also gaps:

- A confirmed payment converted a lead into a client with nobody approving it.
- Nothing recorded who qualified a lead, whether that work was accepted, or how
  long people worked.
- Every employee role carried `projects.view`, so the client hub and domains
  were open to everyone.

## Decision

1. **Four roles, enforced on the server.** These reuse the existing role and
   permission tables, and a membership can hold several roles.
   - **Lead Qualifier** (new): `leads.search`, `leads.contact_reveal`,
     `leads.save` and the new `qualification.work`. It has no `leads.read`,
     `projects.view`, `dashboard.view` or `payments.*`, so the API refuses the
     client hub, domains, revenue, reports and the full sales workspace. A
     qualifier reads and edits only their own research. Older create and claim
     routes that only needed `leads.save` now also need `leads.read`.
   - **Sales Outreach**: the existing `sales_representative`, renamed. It loses
     `dashboard.view`, so the company dashboard (revenue, SSL and renewal
     alerts) is for admins and managers.
   - **Client Manager** (new): `clients.onboard` plus the project-manager style
     client permissions. Onboarding endpoints show a client manager only the
     onboardings assigned to them.
   - **Administrator**: gains `sales.approve_close` and `team.review_work`.
2. **Each concept has its own field on the Opportunity.** Qualification
   progress, researcher and qualifier, interest level, meeting, pricing,
   payment confirmation and closing approval are separate. Sales stage, next
   action, owner and payments are unchanged. Leads still being qualified
   (`draft`, `needs_research`, `needs_correction`, `ready`) are left out of
   every sales list, queue, report and dashboard. Existing leads have
   `qualificationStatus = null` and behave as before.
3. **Qualification is a 5-step guided draft.**
   - Saving from Find Leads, or adding a business by hand, creates a draft.
   - Each step saves to the server, so research resumes after a refresh.
   - Search-results pages are rejected as business links.
   - Emails are only format-checked and never marked verified.
   - Completing needs every source checked, email and phone checked, and one
     reason to reach out. It also needs at least one usable email or phone.
     Without one, the lead is parked as "needs more information" or
     "unsuitable".
   - The evidence is written out ("Website: not found …"), so "no website
     found" keeps its scope.
4. **One credit per lead.** `WorkCredits` has a unique `(opportunityId, kind)`
   key. It records the original qualifier and never moves when the lead is
   reassigned. Repeated or concurrent completion creates no second credit and
   sends no second notification. Sales can return a lead for correction: it
   leaves the sales queues and the credit counts the correction. Compensation
   review (pending / accepted / needs correction / rejected / marked paid) is
   separate from operations: reviewing never moves the lead. No pay rates are
   stored.
5. **Payment confirms; approval converts.**
   - The first payment (Stripe-confirmed or recorded manually by an admin) now
     sets `paymentConfirmedAt` only.
   - The salesperson submits the sale. An admin approves it, choosing the
     client manager, and approval runs the existing idempotent
     `convertOpportunityToClient` and handoff.
   - Approving without a confirmed payment needs a recorded exception reason.
   - A handoff retry can no longer skip approval.
   - Sales that were won before this change keep their history and are shown
     as completed.
6. **The handoff becomes the onboarding checklist.** It now carries the
   qualifier, the reason for outreach, the needs, the pricing and the chosen
   client manager, plus a few onboarding items (requirements, business
   details, extra contacts, missing information). The client manager becomes
   the client's account manager.
7. **Time is self-recorded.** `WorkSessions` hold timers the employee starts,
   pauses and stops, and manual entries with a note. A unique index allows one
   open timer per person, and manual entries can't overlap. Timers left open
   over 12 hours become "abandoned" and count as zero until the person
   corrects them; corrections keep the original minutes and a reason. Nothing
   is inferred from activity.
8. **My Work replaces Dashboard and Today as the home page.** It is built
   server-side from the caller's permissions: each role gets only its own
   sections. Today redirects to My Work. Navigation is filtered by role.

## Consequences

- One additive migration: `20261017120001-guided-workflow`. It backfills
  `paymentConfirmedAt` from recorded initial payments only, and invents no
  attribution or time.
- Fixed a syntax error in `catalog.js` (an unescaped apostrophe, present since
  `afa1651`) that broke migrating a fresh database.
- Existing tests that expect a Stripe payment to create a client straight away
  now describe the old behaviour.
- The client hub itself is still visible to anyone with `projects.view`. The
  "assigned only" scope applies to onboarding, not to every client page.

## Revision (same day): one screen, one step

The first version added a role-aware layer on top of the existing busy pages,
and in testing it still felt the same. The front end now works like this:

- **"Working as".** People with several roles pick one in the sidebar. The menu
  then shows that role's three or four pages, and My Work shows that role only.
  This is a display choice; the server still checks permissions.
- **My Work** is one primary action ("Work next lead", "Find businesses",
  "Start onboarding", or the admin's to-dos) and a short "up next" list.
- **`/app/work/:id`** is the step-by-step lead screen. It shows one card at a
  time:
  - reach out, then record what happened, then set what's next, then the next
    lead;
  - or the meeting, pricing, payment or submit-for-approval card when the deal
    is at that point.

  History and the full record are behind one link. Lead lists, conversations,
  the queue and notifications all open this screen.
- **Find businesses.** For a qualifier, "Qualify" on a result saves it and goes
  straight into the five qualification steps.

## Revision: no lead until qualified

Qualifying from Find businesses no longer saves anything up front.

- **The panel.** Clicking a result opens a qualification panel beside the
  results: Business, Links, Contact, Reason, Assign. Progress is kept in the
  browser (`localStorage`, one entry per listing), so a refresh resumes it.
- **One call at the end.** `POST /api/v1/sales/qualification` checks everything
  first: completeness, link and email formats, a usable contact, the assignee,
  and duplicates. Only then does it create the lead, record the research and
  complete or assign it. A deliberate "needs more info" or "not suitable" saves
  it, so nobody researches it again.
- **Qualifiers can't shortcut it.** A qualifier-only user can no longer create a
  lead with `POST /sales/leads`. Sales and admin "Save" still adds a lead
  straight to sales.
- **Claims.** Opening a listing puts a short-lived `ResearchClaims` marker on it
  (12 hours). Search results show "<name> is researching", and a teammate can
  take it over deliberately. Migration: `20261017130001-research-claims`.
- **Add a business.** `/app/qualify/new` uses the same panel. `/app/qualify/:id`
  stays for leads that already exist: corrections sent back by sales, parked
  research, and leads ready to assign.

## Revision: qualifying session

A results list with a "Qualify" button still felt like a list to manage, so
qualifying is now its own page, `/app/qualify`.

- **Setup.** The qualifier picks the kind of business and the area, or uses a
  preset. Results already in Leadzaro, or being researched by a teammate, are
  left out.
- **One business at a time.** The page shows one business with a progress
  counter and Skip / End buttons. Each business goes through:
  - **Worth it?** Google's facts (rating, website, phone, today's hours, and
    whether it's closed), then *Not relevant* or *Research it*.
  - **Links, Contact, Reason.**
  - **Decide:** *Qualify & assign*, *Needs more info*, or *Not relevant*.
- **Not relevant.** Available on every step, with a quick reason. It saves the
  business as unsuitable, so it never comes up again.
- **Moving on.** Every decision moves straight to the next business. At the end
  there's a summary of qualified, needs more info, not relevant and skipped.
- **What's kept where.** The session's position is held in `sessionStorage`; each
  business's progress is in `localStorage`. Nothing is saved until a decision.
- **Find businesses** (`/app/search`) is for sales and admins again. A
  qualifier-only user who opens it is sent to `/app/qualify`.

## Revision: sales sessions and conversations

**Sales My Work.** A main track, *Start working*, walks the whole queue:
replies, then overdue, then today's follow-ups, then new leads. Below it,
option tiles start a focused session of one group:

- Replies, Overdue, Due today, New leads
- Payments, Stalled (gone quiet or no next step)
- Meetings, Closing

**Work screen** (`/app/work/:id`) uses the same layout as qualifying:

- **Session header.** A progress bar (current lead, handled, skipped) with Skip
  and End.
- **Deal-path stepper:** Contact → Meeting → Pricing → Payment → Close.
- **One step card.** Contact has three sub-steps: reach out, what happened,
  what's next.
- **Side column.** A lead card (contact details, website, links), "Why them",
  the deal (stage, interest, attempts, last contact, next step), recent activity
  and up next.

**Conversations.** `GET /sales/conversations` now returns one row per business:

- a derived status: needs reply, follow-up due, waiting on them, no response
  (3 or more tries with no reply), or closed;
- outbound attempts by channel, replies, and the next step;
- counts for every tab, computed with the same rules as the list.

The page shows those tabs as count cards and a sortable list. Clicking a row
opens the full thread across channels (messages, calls and notes, in time
order) in a side panel, with "Work this lead".

## Revision: merging, socials, several contacts

- **Merging into an existing lead.** When a qualified business is already in
  Leadzaro, it can now be merged instead of erroring.
  - `POST /sales/qualification` accepts `mergeIntoOpportunityId`. The research
    is added to that lead: links, contacts and reason. Existing values are
    never cleared.
  - The lead keeps its salesperson, gets `qualificationStatus = assigned`, and
    the qualifier gets the usual one credit.
  - Merging is refused for clients and won deals, lost or do-not-contact leads,
    leads someone else is researching, leads already qualified, and leads
    marked not relevant.
  - A 409 now carries `existing`, so the screen can explain the conflict and
    offer the merge. Possible duplicates each get "Merge into this one".
- **Social profiles.** `Organizations.socialLinks` is a JSONB list of
  `{ platform, url }` (migration `20261018120001-organization-social-links`).
  It's entered beside Facebook while qualifying, shown on the sales lead card,
  and carried into onboarding.
- **Several contacts.** Several emails, phones and people per business. The
  first email and first phone stay on the business. The rest become contacts,
  so sales can email or call them.
- **Timer.** New work type "Qualifying", chosen by default while working as a
  qualifier.
