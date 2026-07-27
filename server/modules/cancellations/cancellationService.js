'use strict';

const { CancellationRequest } = require('../../models');
const {
  getProjectByIdForRequester, listCancellationRequestsForRequester, getCancellationRequestByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { notify } = require('../../core/notifications/notificationService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function assertProjectAccess(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

async function listCancellationRequests(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listCancellationRequestsForRequester(context, { projectId: project.id });
}

/**
 * ADR 0007 § 2b correction 4: initiatedBy is derived from the requester's
 * own membership type, never taken as client input — a request always
 * honestly records who actually drove it. Refuses a second concurrent
 * request while one is already active (`requested`), matching this
 * codebase's established idempotency-guard pattern elsewhere (e.g.
 * ClientRequest/Message "already converted" checks) rather than allowing
 * an unbounded pile of open requests against one project.
 */
async function requestCancellation({
  context, projectId, reason, requestedByUserId,
}) {
  const project = await assertProjectAccess(context, projectId);

  const [existing] = await listCancellationRequestsForRequester(context, { projectId: project.id, status: 'requested' });
  if (existing) throw invalid('A cancellation request is already pending for this project', 409);

  const initiatedBy = context.membership.membershipType === 'client' ? 'client' : 'agency';
  const cancellationRequest = await CancellationRequest.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    initiatedBy,
    requestedByUserId,
    reason: reason || null,
    status: 'requested',
  });

  await project.update({ cancellationRequestedAt: new Date() });

  // architecture § 21. Client-initiated: notify the agency-side project
  // owner, same pattern as client_request_submitted. Agency-initiated:
  // there is no single "client contact" field to notify yet (Project has
  // only an agency-side ownerUserId) - deferred as a documented
  // lower-priority refinement, same as client_request_submitted's own
  // "everyone who handles requests" gap.
  if (initiatedBy === 'client' && project.ownerUserId) {
    await notify({
      userId: project.ownerUserId,
      organizationId: project.agencyOrganizationId,
      type: 'cancellation_requested',
      title: 'A client requested to cancel their engagement',
      body: reason || undefined,
      data: { cancellationRequestId: cancellationRequest.id, projectId: project.id },
    });
  }

  return cancellationRequest;
}

async function confirmCancellation({ context, requestId, confirmedByUserId }) {
  const cancellationRequest = await getCancellationRequestByIdForRequester(context, requestId);
  if (!cancellationRequest) throw invalid('Cancellation request not found', 404);
  if (cancellationRequest.status !== 'requested') throw invalid('Only a pending cancellation request can be confirmed', 422);

  await cancellationRequest.update({
    status: 'confirmed', confirmedByUserId, confirmedAt: new Date(),
  });

  await notify({
    userId: cancellationRequest.requestedByUserId,
    organizationId: cancellationRequest.agencyOrganizationId,
    type: 'cancellation_confirmed',
    title: 'Your cancellation request was confirmed',
    data: { cancellationRequestId: cancellationRequest.id, projectId: cancellationRequest.projectId },
  });

  return cancellationRequest;
}

async function withdrawCancellation({ context, requestId, withdrawnByUserId }) {
  const cancellationRequest = await getCancellationRequestByIdForRequester(context, requestId);
  if (!cancellationRequest) throw invalid('Cancellation request not found', 404);
  if (cancellationRequest.status !== 'requested') throw invalid('Only a pending cancellation request can be withdrawn', 422);

  await cancellationRequest.update({
    status: 'withdrawn', withdrawnByUserId, withdrawnAt: new Date(),
  });

  const project = await getProjectByIdForRequester(context, cancellationRequest.projectId);
  if (project) await project.update({ cancellationRequestedAt: null });

  await notify({
    userId: cancellationRequest.requestedByUserId,
    organizationId: cancellationRequest.agencyOrganizationId,
    type: 'cancellation_withdrawn',
    title: 'A cancellation request was withdrawn',
    data: { cancellationRequestId: cancellationRequest.id, projectId: cancellationRequest.projectId },
  });

  return cancellationRequest;
}

module.exports = {
  listCancellationRequests, requestCancellation, confirmCancellation, withdrawCancellation,
};
