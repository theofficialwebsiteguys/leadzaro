# ADR 0013 — Client accounts at scale and sales discipline

Status: Accepted (2026-09-29)

## Context

Leadzaro was being prepared for daily internal use by two people, with ~20
existing clients and a goal of 100+. The Clients area answered "what is this
client" but not "who looks after them, what did they buy, who is it waiting
on, and what happens next". Sales had stages but no qualification, no
structured loss reasons, no stall detection and no protection against two
people working the same lead. Reports counted every paid first payment as a
new sale, even to an existing client.

## Decision

1. **Client accounts** (migration `20260930140001`). `ClientProfiles` gain
   `accountManagerUserId`, `services`, `scopeNotes`, `waitingOn`
   (`us`/`client`) + note + since, `nextActionAt`/`nextActionNote`,
   `clientSince`, `clientEndedAt` + `endReason`, and `acquisitionSource`
   (`sales`/`existing`). Every client gets a profile row. Existing clients'
   start dates are left blank for a person to fill in rather than guessed.
2. **One health computation** (`modules/clients/clientHealth.js`) derives
   flags, plain-language reasons and missing information for any set of
   clients in a fixed number of queries. The Clients list (server-side
   filter/search/sort/paging), a client's page, the Dashboard and Reports all
   use it, so their numbers agree.
3. **Add existing client** never counts as a sale. It checks Leads and
   Clients for the same business first (name, website domain ignoring shared
   hosts, phone, email — including client profile websites and contacts) and
   lets a person open the match, turn a lead into the client, or confirm a
   different business. Lead intake uses the same matching.
4. **New vs existing clients.** `ConversionAttempts.createdNewClient` is
   false when a sale goes to a current client (upsell); winning back an ended
   client counts as new. Reports and the Dashboard show new clients, sales to
   existing clients, ended clients, net growth and retention separately,
   excluding demo leads and Stripe test/mock sales unless asked.
5. **Sales discipline.** Progressive qualification (need, service,
   decision-maker, timing, budget) on opportunities; stage meanings and
   requirements (`pipelineCatalog.STAGE_GUIDE`) checked only on manual stage
   moves (422 with the missing list); structured close reasons for Lost and
   Nurture, and Nurture always has a revisit date; stalled deals by
   per-stage idle limits (`STALL_DAYS`) in Leads, Today, the work queue and
   Reports; one owner per lead — contacting someone else's lead needs an
   explicit confirmation (409 `owned_by_other`), an unassigned lead becomes
   yours on first contact.
6. **Recommendations explain themselves**: the next step carries the facts
   behind it, what to find out next, an optional tip and a direct action.
7. **Sales kit** (Organization.settings.salesKit: pitch, services with
   approved prices, portfolio links, objection answers) and a client goal
   (settings.clientGoal, default 100), edited by administrators in Settings →
   Sales kit & goals, shown in a lead drawer and insertable in messages
   (`{{services_list}}`, `{{portfolio_link}}`, `{{their_need}}`).
8. **Daily follow-up reminder**: one in-app notification per salesperson per
   day (from 7am workspace time) when replies or follow-ups are due. Never
   emailed and never sent to leads.
9. **Stripe matching**: one paginated read of Stripe customers (cached 10
   minutes) matched locally to unlinked clients; single strong matches are
   suggested, several or name-only matches are marked for careful review,
   and nothing links without a person's confirmation.
10. **Find Leads**: an expandable row loads phone, website, hours and status
    on demand (cached per place); the results map is a Google Static Maps
    image proxied through the server (the key never reaches the browser),
    with Leadzaro's own numbered markers.

## Consequences

- Stall limits and stage requirements are code constants; making them
  configurable per workspace is a follow-up.
- The Clients list computes health for all clients per request before
  paging. This is fine into the low thousands of clients; beyond that the
  flags should be materialised.
- The results map needs the Maps Static API enabled on the Google key; when
  it isn't, the markers are shown on a plain grid with the reason.
