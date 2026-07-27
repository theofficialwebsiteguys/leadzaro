'use strict';

const { ClientRequest, ContentInboxItem, Task } = require('../../models');
const {
  getProjectByIdForRequester, listClientRequestsForRequester, getClientRequestByIdForRequester,
  listContentInboxItemsForRequester, getContentInboxItemByIdForRequester,
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

async function listRequests(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listClientRequestsForRequester(context, { projectId: project.id });
}

/**
 * The "unified support queue" (architecture § 12): every request across
 * every project at the caller's own agency, not scoped to one project —
 * distinct from listRequests, which is project-scoped for the project
 * detail view. Employee-only (requests.manage).
 */
function listAgencyQueue(context) {
  return listClientRequestsForRequester(context);
}

async function createRequest({
  context, projectId, category, description, submittedByUserId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!ClientRequest.CATEGORIES.includes(category)) throw invalid(`Unknown category: ${category}`);
  if (!description?.trim()) throw invalid('description is required');

  const clientRequest = await ClientRequest.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    category,
    description,
    submittedByUserId,
    status: 'queued',
  });

  // architecture § 21: "client submissions" are named explicitly as a
  // notification trigger. Notifies the project owner if one is set;
  // there is no assigned-owner-independent "everyone who handles
  // requests at this agency" list yet (that would need querying every
  // membership holding requests.manage, deferred as a real but lower-
  // priority refinement — the unified support queue itself already
  // surfaces this without a notification).
  if (project.ownerUserId) {
    await notify({
      userId: project.ownerUserId,
      organizationId: project.agencyOrganizationId,
      type: 'client_request_submitted',
      title: `New ${category} request submitted`,
      body: description,
      data: { requestId: clientRequest.id, projectId: project.id },
    });
  }

  return clientRequest;
}

async function updateRequestStatus({ context, requestId, status }) {
  const clientRequest = await getClientRequestByIdForRequester(context, requestId);
  if (!clientRequest) throw invalid('Request not found', 404);
  if (!ClientRequest.STATUSES.includes(status)) throw invalid(`Unknown status: ${status}`);
  await clientRequest.update({ status });
  return clientRequest;
}

async function convertRequestToTask({ context, requestId, isClientVisible }) {
  const clientRequest = await getClientRequestByIdForRequester(context, requestId);
  if (!clientRequest) throw invalid('Request not found', 404);
  if (clientRequest.convertedToTaskId) throw invalid('This request was already converted to a task', 409);

  const task = await Task.create({
    projectId: clientRequest.projectId,
    organizationId: clientRequest.organizationId,
    agencyOrganizationId: clientRequest.agencyOrganizationId,
    title: clientRequest.description.slice(0, 255),
    isClientVisible: !!isClientVisible,
  });
  await clientRequest.update({ convertedToTaskId: task.id, status: 'in_progress' });
  return task;
}

async function listContentInbox(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listContentInboxItemsForRequester(context, { projectId: project.id });
}

async function submitContentInboxItem({
  context, projectId, type, body, submittedByUserId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!ContentInboxItem.TYPES.includes(type)) throw invalid(`Unknown type: ${type}`);
  if (!body?.trim()) throw invalid('body is required');

  return ContentInboxItem.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    type,
    body,
    submittedByUserId,
    status: 'new',
  });
}

async function updateContentInboxItemStatus({ context, itemId, status }) {
  const item = await getContentInboxItemByIdForRequester(context, itemId);
  if (!item) throw invalid('Content inbox item not found', 404);
  if (!ContentInboxItem.STATUSES.includes(status)) throw invalid(`Unknown status: ${status}`);
  await item.update({ status });
  return item;
}

module.exports = {
  listRequests,
  listAgencyQueue,
  createRequest,
  updateRequestStatus,
  convertRequestToTask,
  listContentInbox,
  submitContentInboxItem,
  updateContentInboxItemStatus,
};
