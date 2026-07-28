'use strict';

const {
  listWebsitePublicFormSubmissionsForRequester, getWebsitePublicFormSubmissionByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('./websiteService');
const { createRequest } = require('../requests/requestService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function listSubmissions(context, projectId, { status } = {}) {
  const website = await getWebsite(context, projectId);
  const extraWhere = { websiteId: website.id };
  if (status) extraWhere.status = status;
  return listWebsitePublicFormSubmissionsForRequester(context, extraWhere);
}

async function getSubmissionForProject(context, projectId, submissionId) {
  const website = await getWebsite(context, projectId);
  const submission = await getWebsitePublicFormSubmissionByIdForRequester(context, submissionId);
  if (!submission || submission.websiteId !== website.id) return null;
  return submission;
}

/**
 * Promotes an anonymous, unverified public submission into a real,
 * accountable ClientRequest (current-phase-plan.md § 2e, review
 * finding #2) — the promoting employee is submittedByUserId, a real
 * accountable actor for the resulting request; the
 * WebsitePublicFormSubmission row remains the permanent record of the
 * true anonymous origin (never deleted, never overwritten).
 */
async function convertSubmission({
  context, projectId, submissionId, actorUserId,
}) {
  const submission = await getSubmissionForProject(context, projectId, submissionId);
  if (!submission) throw invalid('Submission not found', 404);
  if (submission.status !== 'pending_review') throw invalid(`Submission is already ${submission.status}`, 409);

  const clientRequest = await createRequest({
    context,
    projectId,
    category: 'form',
    description: JSON.stringify(submission.values || {}),
    submittedByUserId: actorUserId,
  });

  await submission.update({ status: 'converted', convertedToClientRequestId: clientRequest.id });
  return { submission, clientRequest };
}

async function updateSubmissionStatus({
  context, projectId, submissionId, status,
}) {
  if (!['discarded', 'spam'].includes(status)) throw invalid(`Unsupported status transition: ${status}`);
  const submission = await getSubmissionForProject(context, projectId, submissionId);
  if (!submission) throw invalid('Submission not found', 404);
  if (submission.status !== 'pending_review') throw invalid(`Submission is already ${submission.status}`, 409);

  await submission.update({ status });
  return submission;
}

module.exports = {
  listSubmissions, getSubmissionForProject, convertSubmission, updateSubmissionStatus,
};
