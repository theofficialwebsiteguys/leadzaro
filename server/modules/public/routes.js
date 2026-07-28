'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { publicFormLimiter, publicWebsiteFormLimiter, publicAnalyticsLimiter } = require('../../middleware/rateLimiter');
const { CAMPAIGN_SLUGS } = require('../../core/crm/inboundCampaigns');
const controller = require('./inboundLeadController');
const websitePublicFormController = require('./websitePublicFormController');
const websitePublicAnalyticsController = require('./websitePublicAnalyticsController');

// Entirely public, no authentication — this is the whole point (a
// marketing-page visitor submitting an inbound lead form).
router.post('/inbound-leads', publicFormLimiter, [
  body('landingPageSlug').isIn(CAMPAIGN_SLUGS),
  body('contactName').trim().notEmpty().isLength({ max: 150 }),
  body('contactEmail').optional({ values: 'falsy' }).trim().isEmail().isLength({ max: 255 }),
  body('contactPhone').optional({ values: 'falsy' }).trim().isLength({ max: 50 }),
  body('businessName').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('message').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('utmSource').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('utmMedium').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('utmCampaign').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('utmTerm').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('utmContent').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
  body('referrer').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  // Honeypot — intentionally not documented to real users; must stay empty.
  body('website').optional({ values: 'falsy' }).isLength({ max: 200 }),
], validate, controller.submit);

// Entirely public, no authentication — a real visitor submitting a
// generated website's own contact/lead form (current-phase-plan.md §
// 2e). publicWebsiteFormLimiter is a dedicated instance, keyed by IP +
// websiteId — never publicFormLimiter above, which is a single-tenant,
// IP-only limiter built for Website Guys' own marketing pages, not
// thousands of different client websites sharing one route pattern.
router.post('/websites/:websiteId/submit-form', publicWebsiteFormLimiter, [
  param('websiteId').isUUID(),
  body('pageId').notEmpty().isLength({ max: 255 }),
  body('sectionId').notEmpty().isLength({ max: 255 }),
  body('values').optional().isObject(),
  // Honeypot — intentionally not documented to real users; must stay empty.
  body('website').optional({ values: 'falsy' }).isLength({ max: 200 }),
], validate, websitePublicFormController.submit);

// Entirely public, no authentication — Leadzaro's own hybrid analytics
// beacon (current-phase-plan.md § 2d, architecture § 19).
// publicAnalyticsLimiter is a materially higher budget than
// publicWebsiteFormLimiter above — normal browsing fires many events
// per session (review finding #3).
router.post('/websites/:websiteId/analytics-event', publicAnalyticsLimiter, [
  param('websiteId').isUUID(),
  body('eventType').notEmpty().isLength({ max: 30 }),
  body('path').optional({ values: 'falsy' }).isLength({ max: 500 }),
  body('sessionId').notEmpty().isLength({ max: 100 }),
  body('metadata').optional().isObject(),
], validate, websitePublicAnalyticsController.record);

module.exports = router;
