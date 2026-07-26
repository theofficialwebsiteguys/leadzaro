# Stripe setup (Phase 3 billing)

This app runs against `MockStripeAdapter` by default (`STRIPE_PROVIDER=mock` in `.env.example`), which fabricates Payment Links and lets the internal workflow be built and tested without a real Stripe account. No real Stripe credentials exist in this repository or in any committed file. This document is what an operator needs to flip a real agency over to live Stripe billing.

## 1. Create the Stripe account and API keys

1. Create (or use an existing) Stripe account for The Website Guys.
2. In the Stripe Dashboard, get the **secret key** (`sk_live_...` for production, `sk_test_...` for a staging/test-mode rehearsal).
3. Set in the real (untracked) `.env`:
   ```
   STRIPE_PROVIDER=live
   STRIPE_SECRET_KEY=sk_live_...   (or sk_test_... while rehearsing)
   ```
4. `server/core/config/env.js`'s `validateEnv()` already refuses to boot in production with `STRIPE_PROVIDER=live` and a missing/placeholder key — this is a safety net, not something to route around.

## 2. Register the webhook endpoint

1. In the Stripe Dashboard, add a webhook endpoint pointing at:
   ```
   https://<production-host>/api/v1/billing/webhooks/stripe
   ```
2. Subscribe it to exactly the event types this app currently handles (see `server/modules/billing/webhookService.js`'s `HANDLERS` map) — subscribing to more is harmless (unhandled types are recorded `status: 'ignored'`), but these are the ones with real behavior:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Copy the endpoint's **signing secret** (`whsec_...`) into `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   This is required — `LiveStripeAdapter.verifyAndParseWebhookEvent` calls `stripe.webhooks.constructEvent`, which rejects anything not signed with this exact secret. There is no way to safely skip signature verification in production.

## 3. Map each internal ServicePlan to a real Stripe product/price

The internal service/plan catalog (`ServicePlan` rows, seeded by `server/migrations/20260725120018-seed-service-plans.js`) exists independently of Stripe — it's the thing employees pick from when creating a Payment Link. Each plan needs a real Stripe Price before it can generate a real (non-mock) Payment Link:

1. In the Stripe Dashboard, create a Product and Price for each plan (starter_website, custom_website, website_redesign, ongoing_management, and any new plans added later).
2. Record the mapping via the API (there is no dedicated admin screen for this yet — see "Known gaps" below):
   ```
   PATCH /api/v1/billing/service-plans/:id/stripe-mapping
   { "stripeProductId": "prod_...", "stripePriceId": "price_..." }
   ```
   Requires the `billing.manage_service_plans` permission (administrator, or the `billing` role).
3. Until every selected plan on a Payment Link has a real `stripePriceId`, `paymentLinkService.resolvePriceIds` only succeeds under the mock adapter (a real `LiveStripeAdapter` call throws a clear 422 rather than silently fabricating a price id).

## 4. Rehearse before going live

1. Set `STRIPE_PROVIDER=live` with a **test-mode** secret key (`sk_test_...`) and a test-mode webhook endpoint/secret first.
2. Run through: create a Payment Link, complete a test-mode Stripe Checkout, confirm the opportunity converts, confirm the primary contact gets invited, confirm the Stripe customer portal link resolves, confirm a test-mode failed invoice flips the subscription to `past_due`.
3. Only then switch to live-mode keys.

## Known gaps / deferred (not blocking, tracked for a later phase)

- No dedicated frontend screen for the Stripe product/price mapping yet — it's a real, tested, permission-gated API endpoint, but an administrator currently sets it via a direct API call (e.g. via a REST client) rather than a UI form. Low priority: this is a one-time, rarely-changed setup step per plan, not a day-to-day workflow.
- If a failed lifecycle webhook event needs manual recovery (e.g. it arrived referencing a subscription this app didn't know about yet), use `GET /api/v1/billing/webhook-events?status=failed` to find it and `POST /api/v1/billing/webhook-events/:id/reprocess` to retry it once the underlying cause is fixed — gated by `billing.manage_service_plans`'s sibling permission, `billing.manage_webhooks`.
