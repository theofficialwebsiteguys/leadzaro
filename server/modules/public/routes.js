'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { publicFormLimiter } = require('../../middleware/rateLimiter');
const { CAMPAIGN_SLUGS } = require('../../core/crm/inboundCampaigns');
const controller = require('./inboundLeadController');

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

module.exports = router;
