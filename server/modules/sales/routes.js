'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const {
  resolveContext, requirePermission, requireAnyPermission, requireEmployeeMembership,
} = require('../../core/authorization/context');
const { success, error } = require('../../utils/response');
const { OrganizationMembership, User } = require('../../models');
const { context } = require('./salesCommon');
const opportunityService = require('../crm/opportunityService');
const workspace = require('./workspaceService');
const intake = require('./leadIntakeService');
const leadList = require('./leadListService');
const today = require('./todayService');
const outreach = require('./outreachService');
const templates = require('./templateService');
const channels = require('./channelService');
const stripe = require('./stripeService');
const paymentRequests = require('./paymentRequestService');
const paymentEvents = require('./paymentEventsService');
const handoff = require('./handoffService');
const reports = require('./reportService');

/**
 * Sales workflow API (ADR 0011), mounted at /api/v1/sales. Every route
 * past the Twilio callbacks requires an agency employee membership plus
 * the named permission; services re-check finer rules (shared templates,
 * custom offers, team scope, reassignment).
 */

const PASSTHROUGH = ['existingOpportunityId', 'possibleDuplicates', 'candidates', 'unresolved', 'activityId', 'code', 'owner', 'missing'];

function handle(fn) {
  return async (req, res, next) => {
    try {
      const data = await fn(context(req), req);
      return success(res, data ?? {});
    } catch (err) {
      if (!err.statusCode) return next(err);
      const body = { success: false, message: err.message };
      for (const key of PASSTHROUGH) if (err[key] !== undefined) body[key] = err[key];
      return res.status(err.statusCode).json(body);
    }
  };
}

// ---- Twilio callbacks (public, signature-verified). Always answer 200 with
// empty TwiML so Twilio does not retry or reply on our behalf.
function twilioCallback(path, fn) {
  router.post(path, async (req, res) => {
    const fullPath = `/api/v1/sales${path}`;
    if (!channels.verifyTwilioSignature(fullPath, req.body || {}, req.headers['x-twilio-signature'])) {
      return error(res, 'Invalid signature', 403);
    }
    try {
      await fn(req.body || {});
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[sales] Twilio callback ${path} failed:`, err.message);
    }
    res.type('text/xml').send('<Response></Response>');
  });
}
twilioCallback('/webhooks/twilio/status', outreach.handleTwilioStatus);
twilioCallback('/webhooks/twilio/inbound', outreach.handleTwilioInbound);

router.use(authenticate, resolveContext(), requireEmployeeMembership());

const read = requirePermission('leads.read');
const update = requirePermission('leads.update');
const pipeline = requirePermission('crm.manage_pipeline');
const pay = requirePermission('payments.create');

// ---- Today, queue, goals
router.get('/today', read, handle((ctx, req) => today.getToday(ctx, req.query)));
router.get('/queue', read, handle((ctx, req) => today.getQueue(ctx, req.query)));
router.get('/goals', read, handle((ctx) => today.listGoals(ctx)));
router.put('/goals', read, handle((ctx, req) => today.setGoal(ctx, req.body || {})));
router.get('/team', read, handle(async (ctx) => {
  const memberships = await OrganizationMembership.findAll({
    where: {
      organizationId: ctx.agencyId, membershipType: 'employee', status: 'active', deletedAt: null,
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
  });
  return { members: memberships.filter((m) => m.user).map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })).sort((a, b) => a.name.localeCompare(b.name)) };
}));

// ---- Leads
router.get('/leads', read, handle((ctx, req) => leadList.listLeads(ctx, req.query)));
router.get('/leads/stage-counts', read, handle((ctx, req) => reports.stageCounts(ctx, { mine: req.query.owner === 'me' })));
router.post('/leads', requirePermission('leads.save'), handle((ctx, req) => intake.createLead(ctx, req.body || {})));
router.get('/leads/resolve-saved/:savedLeadId', read, handle((ctx, req) => intake.resolveSavedLead(ctx, req.params.savedLeadId)));
router.get('/leads/:id', read, handle((ctx, req) => workspace.getWorkspace(ctx, req.params.id)));
router.patch('/leads/:id/business', update, handle((ctx, req) => workspace.updateBusiness(ctx, req.params.id, req.body || {})));
router.patch('/leads/:id/deal', pipeline, handle((ctx, req) => workspace.updateDeal(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/contacts', update, handle((ctx, req) => workspace.addContact(ctx, req.params.id, req.body || {})));
router.patch('/leads/:id/contacts/:contactId', update, handle((ctx, req) => workspace.updateContact(ctx, req.params.id, req.params.contactId, req.body || {})));
router.post('/leads/:id/notes', requirePermission('notes.create'), handle((ctx, req) => workspace.addNote(ctx, req.params.id, req.body?.content)));
router.put('/leads/:id/next-action', update, handle((ctx, req) => workspace.setNextAction(ctx, req.params.id, req.body || {})));
router.put('/leads/:id/stage', pipeline, handle((ctx, req) => workspace.changeStage(ctx, req.params.id, req.body || {})));
router.patch('/leads/:id/qualification', update, handle((ctx, req) => workspace.updateQualification(ctx, req.params.id, req.body || {})));
router.put('/leads/:id/do-not-contact', update, handle((ctx, req) => workspace.setDoNotContact(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/outcomes', requirePermission('outreach.create'), handle((ctx, req) => workspace.logOutcome(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/replies', requirePermission('outreach.create'), handle((ctx, req) => workspace.logReply(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/reply-handled', requirePermission('outreach.create'), handle((ctx, req) => workspace.markReplyHandled(ctx, req.params.id)));
router.post('/leads/:id/assign', requirePermission('leads.save'), handle((ctx, req) => workspace.assign(ctx, req.params.id, req.body?.userId)));
router.post('/leads/:id/archive', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), handle(async (ctx, req) => {
  await opportunityService.archive(req.params.id, ctx.agencyId);
  return workspace.getWorkspace(ctx, req.params.id);
}));
router.post('/leads/:id/restore', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), handle(async (ctx, req) => {
  await opportunityService.restore(req.params.id, ctx.agencyId);
  return workspace.getWorkspace(ctx, req.params.id);
}));
router.post('/leads/:id/opportunities', requirePermission('leads.save'), handle((ctx, req) => workspace.createAdditionalOpportunity(ctx, req.params.id, req.body || {})));

// ---- Outreach from the workspace
router.post('/leads/:id/render', requirePermission('outreach.read'), handle((ctx, req) => templates.render(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/send', requirePermission('outreach.send'), handle((ctx, req) => outreach.send(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/calls', requirePermission('outreach.send'), handle((ctx, req) => outreach.startCall(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/calls/:activityId/outcome', requirePermission('outreach.create'), handle((ctx, req) => outreach.completeCall(ctx, req.params.id, req.params.activityId, req.body || {})));

// ---- Payments for a lead
router.get('/leads/:id/payment-requests', read, handle((ctx, req) => paymentRequests.listForOpportunity(ctx, req.params.id)));
router.post('/leads/:id/payment-requests', pay, handle((ctx, req) => paymentRequests.createRequest(ctx, req.params.id, req.body || {})));
router.post('/payment-requests/:requestId/sent', pay, handle((ctx, req) => paymentRequests.markSent(ctx, req.params.requestId, req.body?.via)));
router.post('/payment-requests/:requestId/deactivate', pay, handle((ctx, req) => paymentRequests.deactivate(ctx, req.params.requestId)));
router.post('/payment-requests/:requestId/regenerate', pay, handle((ctx, req) => paymentRequests.regenerate(ctx, req.params.requestId, req.body?.idempotencyKey)));
router.post('/payment-requests/:requestId/refresh', pay, handle((ctx, req) => paymentRequests.refresh(ctx, req.params.requestId)));
router.post('/payment-requests/:requestId/simulate-payment', pay, handle((ctx, req) => paymentRequests.simulatePayment(ctx, req.params.requestId)));
router.post('/leads/:id/manual-payments', requirePermission('payments.record_manual'), handle((ctx, req) => paymentEvents.recordManualPayment(ctx, req.params.id, req.body || {})));

// ---- Handoff
router.get('/leads/:id/handoff', read, handle((ctx, req) => handoff.getForOpportunity(ctx.agencyId, req.params.id)));
router.put('/leads/:id/handoff', update, handle((ctx, req) => handoff.update(ctx, req.params.id, req.body || {})));
router.post('/leads/:id/handoff/complete', update, handle((ctx, req) => handoff.update(ctx, req.params.id, req.body || {}, { complete: true })));
router.post('/leads/:id/handoff/retry', update, handle((ctx, req) => handoff.retry(ctx, req.params.id)));

// ---- Stripe
router.get('/stripe/status', read, handle(() => stripe.getStatus()));
router.get('/stripe/catalog', pay, handle(() => stripe.getCatalog()));
router.post('/stripe/catalog/refresh', pay, handle(() => {
  stripe.clearCatalogCache();
  return stripe.getCatalog();
}));
router.get('/stripe/customers', pay, handle((ctx, req) => stripe.searchCustomers(ctx, req.query.q)));
router.get('/stripe/client-matches', pay, handle((ctx, req) => stripe.matchClients(ctx, { refresh: req.query.refresh === '1' })));
const billingRead = requireAnyPermission(['leads.read', 'projects.view']);
router.get('/businesses/:organizationId/stripe', billingRead, handle((ctx, req) => stripe.describeLink(ctx.agencyId, req.params.organizationId)));
router.get('/businesses/:organizationId/stripe/suggestions', pay, handle((ctx, req) => stripe.suggestCustomers(ctx, req.params.organizationId)));
router.post('/businesses/:organizationId/stripe/link', pay, handle((ctx, req) => stripe.linkCustomer(ctx, req.params.organizationId, req.body?.stripeCustomerId)));
router.delete('/businesses/:organizationId/stripe/link', pay, handle((ctx, req) => stripe.unlinkCustomer(ctx, req.params.organizationId)));
router.post('/businesses/:organizationId/stripe/customer', pay, handle((ctx, req) => stripe.createCustomer(ctx, req.params.organizationId, req.body || {})));
router.patch('/businesses/:organizationId/stripe/customer', pay, handle((ctx, req) => stripe.updateCustomer(ctx, req.params.organizationId, req.body || {})));
router.get('/businesses/:organizationId/billing', billingRead, handle((ctx, req) => stripe.billingSummary(ctx, req.params.organizationId, { live: req.query.live === '1' })));

// ---- Conversations, channels, templates
router.get('/conversations', requirePermission('outreach.read'), handle((ctx, req) => outreach.listConversations(ctx, req.query)));
router.get('/channels', read, handle((ctx) => channels.channelStatus(ctx)));
router.put('/me/phone', requirePermission('profile.manage'), handle((ctx, req) => outreach.setMyPhone(ctx, req.body?.phone)));
router.get('/templates', requirePermission('outreach.read'), handle((ctx, req) => templates.list(ctx, req.query)));
router.get('/templates/placeholders', requirePermission('outreach.read'), handle(() => templates.PLACEHOLDERS));
router.post('/templates', requirePermission('outreach.create'), handle((ctx, req) => templates.create(ctx, req.body || {})));
router.patch('/templates/:templateId', requirePermission('outreach.create'), handle((ctx, req) => templates.update(ctx, req.params.templateId, req.body || {})));
router.post('/templates/:templateId/copy', requirePermission('outreach.create'), handle((ctx, req) => templates.copyToPersonal(ctx, req.params.templateId)));
router.post('/templates/preview', requirePermission('outreach.read'), handle((ctx, req) => templates.render(ctx, req.body?.opportunityId || null, req.body || {})));

// ---- Reports
router.get('/reports', read, handle((ctx, req) => reports.getReport(ctx, req.query)));

module.exports = router;
