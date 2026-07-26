'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./billingController');

router.use(authenticate, resolveContext());

router.get('/service-plans', requirePermission('leads.read'), controller.listServicePlans);
// The "needs attention" worklist is manager-level oversight, matching
// the same leads.assign gate used for the sales-dashboard team breakdown.
router.get('/conversion-attempts', requirePermission('leads.assign'), controller.listConversionAttempts);
// Same manager-oversight gate as conversion-attempts — this is the
// failing-subscriptions counterpart worklist (current-phase-plan.md § 7e).
router.get('/subscriptions', requirePermission('leads.assign'), controller.listSubscriptions);
// Platform-admin capability, not agency-scoped (see § 7a) — recovers a
// lifecycle webhook event that failed processing and would otherwise be
// permanently stuck (Stripe never retries a 200, and a Dashboard resend
// would just hit the ledger's own dedupe without re-running the handler).
router.get('/webhook-events', requirePermission('billing.manage_webhooks'), controller.listWebhookEvents);
router.post('/webhook-events/:id/reprocess', requirePermission('billing.manage_webhooks'), controller.reprocessWebhookEvent);
router.post('/organizations/:organizationId/portal-link', requirePermission('crm.manage_pipeline'), controller.getCustomerPortalLink);

module.exports = router;
