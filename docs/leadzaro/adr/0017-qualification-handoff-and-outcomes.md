# ADR 0017 — Qualifying businesses already in Leadzaro, the sales handoff, and realistic outcomes

Status: Accepted (2026-10-21). This builds on ADR 0016 and changes parts of it.

## Context

Employees reported that qualifying a business that was already in Leadzaro
failed with a website/link error that seemed unrelated, so the business could
not be qualified at all. Tracing it found four problems that compounded:

1. **The email source was free text, but was checked as a link.** "Where you
   found it" was a free-text box in both the qualifying flow and the sales
   contact-research panel, and older records hold free text such as
   "Facebook". On submit, `saveResearch` ran that text through `cleanUrl()`,
   which threw "Link: that doesn't look like a web address." The message gave
   no field and appeared on the final Decide step.
2. **Qualifying was not atomic.** `createQualified` first committed the lead
   (business, opportunity and draft research) through `createLead`, and only
   then validated and saved the research. If the research failed, an orphan
   draft lead was left behind.
3. **The retry then hit a dead end.** The corrected retry was rejected with
   409 "already in Leadzaro" (same listing or possible duplicates), pointing
   at the orphan the failed attempt had created.
4. **A failed merge could hide an active lead.** Merging set the existing
   lead's `qualificationStatus = 'draft'` before anything was validated. If
   the merge then failed, an active sales lead disappeared from the sales
   queues.

The same review found other gaps:

- The "why reach out" reason was not shown to sales in a usable form.
- Do-not-contact was set on one deal only, and anyone could clear it.
- Payment links ignored do-not-contact.
- Outcomes were mostly either "good lead" or "lost".
- Search results were full of chains.
- Navigation between My Work, qualifying and leads was inconsistent.

## Decision

### 1. One checked, all-at-once qualification

- **Validated first, with problems on their fields.**
  `qualificationService.normalizeSubmission()` validates the whole submission
  before anything is written. It reports every problem against its field
  (`contacts.email.values.0.sourceUrl`, `sources.facebook.url`, …) and gives
  the step it belongs to. The form goes to that step, marks each field, and
  keeps everything the employee entered.
- **Harmless formatting is normalized:**
  - spaces, quotes and angle brackets around links;
  - `mailto:` and trailing punctuation on emails;
  - Facebook URL variants.
- **Empty optional links are allowed.**
- **"Not relevant" never fails on a mistyped optional value** (forgiving
  mode). A "found" answer with nothing filled in counts as not checked when
  parking.
- **Written in one transaction.** The lead, its research, the assignment and
  the credit are written together, or not at all.
  `opportunityService.createFromLead` now accepts an outer transaction and
  `leaveUnassigned`.
- **Safe retries.**
  - The form sends a `submissionKey`, kept per draft and stored on the lead
    (`research.submissionKeys`).
  - A repeated submission (a double click, or a retry after a timeout)
    returns the first result.
  - An advisory lock is held per listing or name.
  - Each lead keeps exactly one credit, unique on (opportunity, kind).

### 2. Businesses that may already exist

- **Early, read-only check.** `POST /sales/qualification/check` runs when the
  flow opens, when the name, phone or email changes, and on Decide. Each match
  is graded:
  - `same_listing`: the same Google place id.
  - `strong`: the same phone, the same email, or the same name in the same
    town.
  - `possible`: the same website domain, or the same name with no town known.
    Either can be a separate location.
- **Scope.** Matching stays inside the caller's agency.
- **Wording for the match.** Each match says, in plain words, what research
  can do with it:
  - `qualify`: not yet qualified, or parked. The research qualifies it while
    keeping its owner, stage, notes and history, with one credit.
  - `update`: already qualified, or with sales. The research is added for the
    owner, who is told. There is no status change and no new credit.
  - Not mergeable, with the reason: a client, do-not-contact, archived,
    already under review, or another person's research in progress.
- **Additive merge.** `applyResearch(..., { additive: true })` only fills
  empty fields:
  - it never clears or overwrites anything, and never downgrades what someone
    else found;
  - it adds extra emails, phones and people as contacts;
  - a different reason becomes an attributed addition.
- **Actions offered:**
  - *Open existing lead*, only with `leads.read`, so not for qualifiers.
  - *Add my research to it* or *Update its research*.
  - *It's a different business*: settles possible matches only (managers can
    use it for strong matches too).
  - *Not sure — keep it separate for a manager to check*.
- **Pending review (`needs_review`, a new qualification status).** The
  research is saved as its own record and flagged.
  - It is part of `IN_QUALIFICATION`, so it stays out of every sales queue.
  - It earns no credit until settled.
  - It is listed in admins' My Work.
  - A manager (`leads.assign` or `team.review_work`) settles it with
    `POST /sales/qualification/:id/review`:
    - `separate`: it goes ahead as the qualifier intended, and the credit goes
      to the qualifier.
    - `merge`: the research is added to the chosen lead. The extra record is
      archived with `mergedIntoOpportunityId`, and its now-empty prospect
      business is soft-deleted.
    - `dismiss`.
- **Clients and do-not-contact** businesses are identified and never put back
  into outreach automatically.

### 3. Where an email was found

- `Organizations.emailSources` (JSONB) stores a source per address:
  `{ type, note, url, legacyText, by, at }`. The types are:
  - Website / contact page;
  - Facebook;
  - Privacy policy;
  - Instagram / other social profile;
  - Google Business Profile;
  - Business directory;
  - Referral / direct conversation;
  - Other (with a short note).
- The link is optional and separate, and the source itself is optional.
- **Older values are mapped, not lost.** Old free text sent as `sourceUrl` is
  mapped to the nearest type and also kept verbatim (`legacyText`).
- **Migration and display.** The migration backfills existing manual and
  discovered sources the same way. Sales sees the source in the briefing and
  in contact research.
- **No email found** is recorded as checked (`markedNoEmail`); no placeholder
  address is needed.

### 4. The reason to reach out is the sales handoff

- **The workspace briefing (`briefing`).** It returns:
  - what the qualifier observed, and who researched it and when;
  - "Why it may matter", a general point per quick-pick reason, labelled as
    not checked for this business;
  - the supporting link or context, and where the email was found;
  - the original reason if it has been edited, plus attributed additions;
  - a customer-facing first line (`emailOpener`) and a short call talking
    point.
- **The first line is built from facts.** It comes from the quick-pick
  reasons: plain first-person observations with no claimed defects beyond
  what was recorded and no promised results. With only free text, the note is
  used word for word, with a warning to reword it.
- **Where it is used:**
  - "Use in email" drafts the introduction from it;
  - later emails get it as their first line;
  - a `{{outreach_reason}}` template placeholder inserts it.
- **Nothing is sent without the employee.**
- **Edits keep history.** Editing the reason keeps the original
  (`research.reasonOriginal`) and every earlier version (`reasonHistory`).
  Sales can add context with `POST /leads/:id/outreach-reason/notes`.
- **A missing reason** is flagged in the briefing and can be added inline.

### 5. Lifecycle, outcome and next action stay separate

- **Lifecycle is derived, never stored.** `lifecycleOf()` derives it from
  existing fields:
  - research, needs information, duplicate check;
  - qualified/ready, active outreach, interested;
  - nurture, won/client, closed lost, disqualified.
- **New outcomes.** `info_requested` sets a follow-up. `not_a_fit` closes the
  lead as lost with `closeReasonCode = not_a_fit` and is shown as
  disqualified.
- **Existing outcome behaviour:**
  - "Not interested right now" (`not_now`) keeps the lead in nurture with a
    revisit date.
  - "Not interested" can either close the lead or keep it in nurture.
- **Suggested next step.** After an outcome, the work screen suggests a next
  step with editable defaults, and can open a thank-you, information or
  follow-up draft to review. Nothing is sent automatically.
- **Thank-you notes don't restart outreach.** A thank-you is sent as a
  courtesy, so it does not move a nurture lead back into outreach.
- **A role-aware "Change status" panel** offers:
  - defer, nurture, reopen;
  - lost, disqualify;
  - reassign, return to the qualifier;
  - mark or lift do-not-contact.
- **Do-not-contact is a business restriction:**
  - it applies to every deal for the business, including new ones;
  - stage changes don't clear it;
  - lifting it needs `leads.assign` and a reason;
  - it now also blocks payment links (create and mark sent) and intro drafts;
  - an opt-out by text covers all of the business's deals.
- **Handoff and acceptance are separate steps.**
  `Opportunities.salesAcceptedAt` and `salesAcceptedByUserId` record sales
  accepting a qualifier's handoff:
  - explicitly, with `POST /leads/:id/accept`;
  - or implicitly, on the owner's first outbound contact.
  - Returning a lead to the qualifier resets acceptance and keeps all of the
    research (`research.returns`).

### 6. Navigation

- **My Work is every role's dashboard.**
  - It has a "Next up" card: continue the last lead, resume saved research,
    or the main track.
  - Count chips open their queue, and the queue is kept in `?queue=`.
  - Each row shows the business, its status, a short reason, the last
    activity, the next step and one main action.
  - Details expand in place, with reschedule and "park in nurture" actions.
- **Sales queues:**
  - new from qualifiers, replies, overdue, due today;
  - awaiting their reply, not contacted, payments, meetings, closing,
    stalled.
- **Qualifier queues:**
  - in progress, returned to you, needs more info, duplicate check;
  - ready to assign, recent handoffs (with what happened downstream).
- **Admin queues:** needs you, possible duplicates, ready to assign.
- **Saved research.**
  - Progress is saved on the server in `ResearchClaims.start` and `draft`,
    keyed by place id or `manual:<id>`.
  - The flow autosaves as it goes, shows a saved indicator, and warns before
    the page is closed with unsaved changes.
  - It resumes at `/app/qualify/resume/:key`.
  - A teammate's saved progress is protected: taking it over needs a
    deliberate "research it anyway".
- **A lead opened from the Leads list or Conversations** returns there with
  its filters (`?from=`). The sidebar keeps that menu item selected, and
  breadcrumbs show the path.
- **Within qualifying,** "Previous step" is separate from "Back to My Work".
  Completion offers "Next business" or "Next saved research", and "Back to My
  Work".

### 7. The chain filter

- **What it uses.** `chainFilterService` uses only what a search already
  returns, with no paid enrichment and no extra requests. It checks:
  - a curated list of 214 brands and their corporate domains;
  - normalized names: location suffixes, punctuation, town and state words
    removed.
- **Strict naming rule.** One-word and everyday-phrase brands match only on
  the exact name, so "Subway Tile Co" or "Life Time Roofing" are not caught.
- **Excluded results** are left out of qualifying sessions, with the reason,
  behind "Show excluded (N)". Anyone qualifying can "Research it" or "Always
  allow" a location.
- **Possible-chain hints** never hide a result. They appear when:
  - three or more results share a name;
  - the website is a location page on a larger site;
  - a website is shared with other results.
- **Editing the list.** Managers edit it in Settings → Search filters, which
  is saved in the agency's `settings.chainFilter`.
- **Existing leads are never touched.** The filter applies only to results
  that aren't in Leadzaro.

### 8. Admin visibility

- The workspace returns a `history` timeline, built from the audit log and
  activities: who researched, qualified, assigned, accepted, returned and
  contacted a lead, and when.
- Team work separates research completed (credits) from sales accepting it,
  and counts research added to existing leads separately
  (`WorkCredits.note`).
- Retries and merges never add credits.

## Migration and configuration

Migration `20261021120001-qualification-handoff-and-sources` adds:

- `Organizations.emailSources`, with a backfill;
- `Opportunities.salesAcceptedAt` and `salesAcceptedByUserId` (backfilled for
  assigned leads that have already been contacted);
- `WorkCredits.note`;
- `ResearchClaims.start` and `draft`, plus an index;
- shared "thank you" and "information" email templates per agency.

It is reversible, and no configuration or new environment variables are
needed.

## Limits

- The chain filter catches only listed brands. Google results don't say
  whether a business is a chain.
- Possible-match grading is a heuristic. Separate locations of one business
  can look like duplicates (they're "possible", never merged automatically).
- Saved progress is one per listing per agency. Taking it over replaces the
  other person's saved progress, after a warning.
- The outreach-reason first line is a template, not AI. With free-text-only
  reasons it is the qualifier's words and is flagged for rewording.
