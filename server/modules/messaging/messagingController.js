'use strict';

const messagingService = require('./messagingService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listChannels(req, res, next) {
  try {
    const channels = await messagingService.listChannels(req.context, req.params.projectId);
    return success(res, { channels });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listMessages(req, res, next) {
  try {
    const messages = await messagingService.listMessages(req.context, req.params.projectId, req.params.channelId);
    return success(res, { messages });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function postMessage(req, res, next) {
  try {
    const message = await messagingService.postMessage({
      context: req.context,
      projectId: req.params.projectId,
      channelId: req.params.channelId,
      body: req.body.body,
      mentionedUserIds: req.body.mentionedUserIds,
      threadParentMessageId: req.body.threadParentMessageId,
      authorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'message.posted', targetType: 'Message', targetId: message.id, metadata: { channelId: req.params.channelId }, req,
    });

    return success(res, { message }, 'Message posted', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function convertToTask(req, res, next) {
  try {
    const task = await messagingService.convertMessageToTask({
      context: req.context,
      projectId: req.params.projectId,
      channelId: req.params.channelId,
      messageId: req.params.messageId,
      isClientVisible: req.body.isClientVisible,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'message.converted_to_task', targetType: 'Task', targetId: task.id, metadata: { messageId: req.params.messageId }, req,
    });

    return success(res, { task }, 'Message converted to task', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listChannels, listMessages, postMessage, convertToTask,
};
