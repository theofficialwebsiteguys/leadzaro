'use strict';

const inboundLeadService = require('./inboundLeadService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

async function submit(req, res, next) {
  try {
    const result = await inboundLeadService.submitInboundLead({
      landingPageSlug: req.body.landingPageSlug,
      contactName: req.body.contactName,
      contactEmail: req.body.contactEmail,
      contactPhone: req.body.contactPhone,
      businessName: req.body.businessName,
      message: req.body.message,
      utmSource: req.body.utmSource,
      utmMedium: req.body.utmMedium,
      utmCampaign: req.body.utmCampaign,
      utmTerm: req.body.utmTerm,
      utmContent: req.body.utmContent,
      referrer: req.body.referrer,
      // Honeypot field: real visitors never see or fill this (hidden via
      // CSS in the form); a filled value is a near-certain bot.
      honeypot: req.body.website,
    });

    if (result.opportunityId) {
      await recordAudit({
        organizationId: result.agencyOrganizationId,
        action: 'inbound_lead.submitted',
        targetType: 'Opportunity',
        targetId: result.opportunityId,
        metadata: { landingPageSlug: req.body.landingPageSlug },
        req,
      });
    }

    // Same response shape regardless of whether this was a real
    // submission or a silently-discarded honeypot catch.
    return success(res, { submitted: true }, 'Thanks — we\'ll be in touch soon.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { submit };
