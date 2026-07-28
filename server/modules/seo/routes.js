'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const entitlementController = require('./seoEntitlementController');
const reportingController = require('./seoReportingController');

router.use(authenticate, resolveContext());

router.get('/organizations/:organizationId/entitlement-status', requirePermission('seo.manage_entitlements'), entitlementController.status);
router.get('/organizations/:organizationId/entitlement-grants', requirePermission('seo.manage_entitlements'), entitlementController.list);
router.post('/organizations/:organizationId/entitlement-grants', requirePermission('seo.manage_entitlements'), [
  body('reason').notEmpty(),
  body('expiresAt').optional({ values: 'falsy' }).isISO8601(),
], validate, entitlementController.grant);
router.post('/organizations/:organizationId/entitlement-grants/:grantId/revoke', requirePermission('seo.manage_entitlements'), entitlementController.revoke);

router.get('/agency-overview', requirePermission('seo.manage_entitlements'), reportingController.agencyOverview);

module.exports = router;
