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
router.post('/organizations/:organizationId/portal-link', requirePermission('crm.manage_pipeline'), controller.getCustomerPortalLink);

module.exports = router;
