'use strict';

const triageService = require('./websitePublicFormTriageService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const submissions = await triageService.listSubmissions(req.context, req.params.projectId, { status: req.query.status });
    return success(res, { submissions });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function get(req, res, next) {
  try {
    const submission = await triageService.getSubmissionForProject(req.context, req.params.projectId, req.params.submissionId);
    if (!submission) return error(res, 'Submission not found', 404);
    return success(res, { submission });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function convert(req, res, next) {
  try {
    const { submission, clientRequest } = await triageService.convertSubmission({
      context: req.context, projectId: req.params.projectId, submissionId: req.params.submissionId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website_public_form.converted',
      targetType: 'WebsitePublicFormSubmission',
      targetId: submission.id,
      metadata: { projectId: req.params.projectId, clientRequestId: clientRequest.id },
      req,
    });

    return success(res, { submission, clientRequest }, 'Submission converted to a client request');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function discard(req, res, next) {
  try {
    const submission = await triageService.updateSubmissionStatus({
      context: req.context, projectId: req.params.projectId, submissionId: req.params.submissionId, status: req.body.status,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website_public_form.status_updated',
      targetType: 'WebsitePublicFormSubmission',
      targetId: submission.id,
      metadata: { projectId: req.params.projectId, status: submission.status },
      req,
    });

    return success(res, { submission }, 'Submission updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, get, convert, discard,
};
