'use strict';

const websitePublicFormService = require('./websitePublicFormService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

async function submit(req, res, next) {
  try {
    const result = await websitePublicFormService.submitWebsiteForm({
      websiteId: req.params.websiteId,
      pageId: req.body.pageId,
      sectionId: req.body.sectionId,
      values: req.body.values,
      // Honeypot field: real visitors never see or fill this (hidden via
      // CSS in the generated form); a filled value is a near-certain bot.
      // Matches /inbound-leads' own `website` field convention.
      honeypot: req.body.website,
    });

    if (result.submissionId) {
      await recordAudit({
        action: 'website_public_form.submitted',
        targetType: 'WebsitePublicFormSubmission',
        targetId: result.submissionId,
        metadata: { websiteId: req.params.websiteId },
        req,
      });
    }

    // Same response shape regardless of whether this was a real
    // submission or a silently-discarded honeypot catch — matches
    // /inbound-leads' precedent.
    return success(res, { submitted: true }, 'Thanks — your submission was received.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { submit };
