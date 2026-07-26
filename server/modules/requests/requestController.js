'use strict';

const requestService = require('./requestService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const requests = await requestService.listRequests(req.context, req.params.projectId);
    return success(res, { requests });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listQueue(req, res, next) {
  try {
    const requests = await requestService.listAgencyQueue(req.context);
    return success(res, { requests });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const clientRequest = await requestService.createRequest({
      context: req.context, projectId: req.params.projectId, category: req.body.category, description: req.body.description, submittedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'client_request.created', targetType: 'ClientRequest', targetId: clientRequest.id, metadata: { category: clientRequest.category }, req,
    });

    return success(res, { request: clientRequest }, 'Request submitted', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateStatus(req, res, next) {
  try {
    const clientRequest = await requestService.updateRequestStatus({ context: req.context, requestId: req.params.requestId, status: req.body.status });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'client_request.status_updated', targetType: 'ClientRequest', targetId: clientRequest.id, metadata: { status: clientRequest.status }, req,
    });

    return success(res, { request: clientRequest }, 'Request updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function convertToTask(req, res, next) {
  try {
    const task = await requestService.convertRequestToTask({ context: req.context, requestId: req.params.requestId, isClientVisible: req.body.isClientVisible });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'client_request.converted_to_task', targetType: 'Task', targetId: task.id, metadata: { requestId: req.params.requestId }, req,
    });

    return success(res, { task }, 'Request converted to task', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listContentInbox(req, res, next) {
  try {
    const items = await requestService.listContentInbox(req.context, req.params.projectId);
    return success(res, { items });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function submitContentInboxItem(req, res, next) {
  try {
    const item = await requestService.submitContentInboxItem({
      context: req.context, projectId: req.params.projectId, type: req.body.type, body: req.body.body, submittedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'content_inbox.submitted', targetType: 'ContentInboxItem', targetId: item.id, req,
    });

    return success(res, { item }, 'Content submitted', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateContentInboxItemStatus(req, res, next) {
  try {
    const item = await requestService.updateContentInboxItemStatus({ context: req.context, itemId: req.params.itemId, status: req.body.status });
    return success(res, { item }, 'Item updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, listQueue, create, updateStatus, convertToTask, listContentInbox, submitContentInboxItem, updateContentInboxItemStatus,
};
