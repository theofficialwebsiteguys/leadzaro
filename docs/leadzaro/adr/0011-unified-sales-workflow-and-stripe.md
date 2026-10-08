# ADR 0011: One sales workflow, real Stripe payments, guided handoff

## Status

Accepted.

## Decision

1. **One record per deal.** The Opportunity is the lead. Saved Leads statuses and pipeline stages are replaced by one stage list — New → Contacting → Interested/Qualified → Meeting/Proposal → Awaiting Payment → Won, plus Lost and Nurture (`server/core/crm/pipelineCatalog.js`). Next action, archive and do-not-contact are separate fields. Old stages were mapped by migration; the original value is kept in `legacyStage`. A business (Organization) can have several opportunities.
2. **Won means paid.** A deal becomes Won only when an initial payment is recorded: a verified Stripe webhook or reconcile, or an authorized manual payment (`payments.record_manual`, audited, shown as manual). Links, checkout visits, trials and $0 checkouts stay in Awaiting Payment. Renewals are recurring revenue, not sales.
3. **Stripe through the server only.** Credentials are server environment variables (`STRIPE_*`); mode (live/test/mock) comes from the key and is stored on every Stripe record. Businesses link to one Stripe customer per mode (`StripeCustomerLinks`), and conversion keeps that customer. Payment requests are real Payment Links (shareable) or customer-bound Checkout Sessions (expire, can be regenerated). Catalog prices are reused as-is; custom offers reuse an identical earlier price by `lookup_key` and need `payments.custom_offer`. Every request has an idempotency key and fixed sale attribution.
4. **Webhooks** (`/api/v1/billing/webhooks/stripe`) keep the existing signed ledger. Handlers are idempotent (unique Stripe ids on `SalesPayments`), tolerate out-of-order delivery (`stripeUpdatedAt` on subscriptions), and ignore activity for customers that did not come from Leadzaro.
5. **Handoff.** On payment the existing conversion runs once, then a `SalesHandoff` fills blanks in the client profile, writes one summary note and lists missing items as onboarding items. If anything after payment fails, the handoff is `failed` and can be retried. Passwords, keys and card numbers are rejected.
6. **Outreach.** Email (SMTP) and texting/click-to-call (Twilio) send from Leadzaro only when configured; otherwise the channel shows as not connected and outreach is logged by hand or opened in an external app. Activities record origin (platform/manual/external), direction, outcome and delivery status. Templates are personal or shared (`templates.manage_shared`); unresolved placeholders block sending.
7. **Paying clients are not invited to log in** unless `CLIENT_PORTAL_AUTO_INVITE=true` (Leadzaro is internal-only).

## Consequences

- New tables: `MessageTemplates`, `StripeCustomerLinks`, `SalesPayments`, `SalesHandoffs`, `SalesGoals`. The old Saved Leads, Pipeline, Outreach log and lead-detail screens are replaced by Today, Leads, the lead workspace, Outreach and Reports. `SavedLeads` rows stay for history, and old links resolve to the matching lead.
- Historical Won deals have no payment record and are reported as "won without a payment record", not as verified sales.
