'use strict';

const { WebsiteComment } = require('../../models');
const {
  listWebsiteCommentsForRequester, getWebsiteCommentByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('./websiteService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function listComments(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteCommentsForRequester(context, { websiteId: website.id });
}

/**
 * isInternal is never trusted from client input directly — a client
 * membership can never create an internal-only comment, matching the
 * same "never trust the client for a security-relevant flag" pattern
 * as CancellationRequest.initiatedBy.
 */
async function createComment({
  context, projectId, versionId, anchorKey, body, isInternal, authorUserId,
}) {
  const website = await getWebsite(context, projectId);
  if (!anchorKey?.trim()) throw invalid('anchorKey is required');
  if (!body?.trim()) throw invalid('body is required');

  return WebsiteComment.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    versionId: versionId || null,
    anchorKey,
    authorUserId,
    body,
    isInternal: context.membership.membershipType === 'client' ? false : !!isInternal,
  });
}

async function resolveComment({ context, projectId, commentId }) {
  await getWebsite(context, projectId);
  const comment = await getWebsiteCommentByIdForRequester(context, commentId);
  if (!comment) throw invalid('Comment not found', 404);
  await comment.update({ resolvedAt: new Date() });
  return comment;
}

module.exports = { listComments, createComment, resolveComment };
