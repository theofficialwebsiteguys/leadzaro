# ADR 0014 — Lead search to introduction email

Status: Accepted (2026-10-09)

## Context

Employees had to invent keywords, emails were almost never found, and saving
a business did not lead into outreach. On inspection, **Google Places never
returns an email** and **no discovery process existed**: the enrichment
adapter was a mock/disabled stub and the website "audit" deliberately never
fetched a site. Our preferred approach is a short, personal cold email, not
cold calling.

## Decision

1. **Guided search** (`core/crm/searchCatalog.js`, `POST /api/leads/search/guided`).
   Categories and subcategories map to Google Text Search queries; custom
   keywords stay under "More options". A search runs one query per business
   type per area, capped at 8 per click, merged and de-duplicated by Google
   listing id (plus same name *and* street address — never name alone).
   Radius searches bias to the point and then drop results beyond the radius;
   county/region searches use the geocoded bounds as a `locationRestriction`
   rectangle. Every limit is reported in the response (`plan.notes`), and
   partial failures are shown, not hidden. Searches run only on "Find
   businesses".
2. **Territories and presets** live in the agency's `settings.leadSearch`
   (Settings → Workspace), defaulting to Rockland, Westchester, Hudson Valley
   and North Jersey. Presets only fill the form. The last search is kept per
   browser; results, filters and scroll position are kept for the session.
3. **Email discovery** (`modules/sales/contactDiscoveryService.js`). A bounded
   check of the business's own website: the homepage plus up to four
   contact/about-style pages (8s/6s timeouts, 1.5 MB cap, 3 checks at a time).
   It reads mailto links, plain text and Cloudflare-obfuscated addresses;
   drops placeholder, privacy/registrar, automated and web-designer-credit
   addresses; and keeps an off-domain address only for review. Each result
   records the exact page and time. States are explicit: `not_checked`,
   `checking`, `found`, `none_found`, `failed`, `needs_review`, stored in
   `Organizations.emailDiscovery`, separate from the stage and from message
   status. Checks run when a lead is saved (reusing a check already run from
   the search screen), from "Find email" on a result, or from "Check again"
   on a lead. **An email entered or verified by hand is never overwritten.**
4. **Safe fetching** (`core/security/safeFetch.js`): http(s) on ports 80/443
   only, no URL credentials, and every resolved address must be public (no
   private, loopback, link-local or metadata ranges). The connection is
   pinned to the address that was checked, and redirects are re-validated at
   each hop.
5. **Facebook** is a first-class *manual* source. A page linked from the
   business's own site (or listed as its Google "website") is recorded with
   how it matched; uncertain matches are labelled for review. Leadzaro does
   **not** read Facebook pages: contact details need a signed-in session and
   Facebook's terms forbid automated collection. The lead shows "Open
   Facebook" or "Search Facebook" next to "Add email", plus "Checked — no
   email".
6. **Reason for outreach** (`Opportunities.outreachReason` + `outreachEvidence`).
   The employee writes it, helped by observations Leadzaro actually
   recorded: no website on the Google listing, a Facebook page but no
   standalone site, a site that didn't load on a dated check, or a site that
   loaded over http. The wording is deliberately careful.
7. **Introduction draft** (`modules/sales/introEmailService.js`). There is no
   AI provider in the codebase, so the draft is a template filled only from
   facts on file. It uses the business, location, website/Facebook, the
   saved reason, the sender, and the lowest monthly price from the Sales kit
   (mentioned only if one exists). It returns the evidence for each part and
   warnings for anything missing. Adding AI drafting would need a provider
   key, a server-side adapter, and the same evidence list as its only input.
   The unsent draft is kept on the deal (`emailDraft`) so teammates can see it.
8. **Sending** reuses the existing composer and `outreachService.send`
   (explicit Send, idempotency key, do-not-contact, owner confirmation).
   New checks:
   - An address marked do-not-contact on any business or contact in the
     agency is refused.
   - The identical email to the same address within 24 hours, or an
     introduction to a business someone already emailed, needs an explicit
     "Send anyway".
   - The sender address is recorded on the activity.
   - "sent" is labelled *accepted by mail server*; delivery isn't tracked.
   - `SALES_EMAIL_TEST_REDIRECT` sends every outreach email to a test
     address instead of the lead.
9. **Email first.** The recommended first step for a lead without an email is
   "Find their email". With an email, it is "Draft email". Calling is no
   longer recommended first. Leads → "Missing email" lists leads still
   needing research.

## Consequences

- Websites that render their contact details with JavaScript, use contact
  forms only, or block automated requests show as `none_found` or `failed`.
  Employees finish those by hand.
- Drafts are recorded on the deal and in the audit log, not as timeline
  activities, so reports and contact-attempt counts are unaffected. Sent
  emails are recorded as activities, as before.
