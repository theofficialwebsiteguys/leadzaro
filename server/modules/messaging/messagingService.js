'use strict';

const { Message, Task } = require('../../models');
const {
  getProjectByIdForRequester, listChannelsForRequester, getChannelByIdForRequester, listMessagesForRequester, getMessageByIdForRequester,
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

async function listChannels(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listChannelsForRequester(context, { projectId: project.id });
}

async function getChannel(context, projectId, channelId) {
  await assertProjectAccess(context, projectId);
  const channel = await getChannelByIdForRequester(context, channelId);
  if (!channel || channel.projectId !== projectId) throw invalid('Channel not found', 404);
  return channel;
}

async function listMessages(context, projectId, channelId) {
  const channel = await getChannel(context, projectId, channelId);
  return listMessagesForRequester(context, { channelId: channel.id });
}

async function postMessage({
  context, projectId, channelId, body, mentionedUserIds, threadParentMessageId, authorUserId,
}) {
  const channel = await getChannel(context, projectId, channelId);
  if (!body?.trim()) throw invalid('body is required');

  if (threadParentMessageId) {
    const parent = await getMessageByIdForRequester(context, threadParentMessageId);
    if (!parent || parent.channelId !== channel.id) throw invalid('Thread parent message not found in this channel', 404);
  }

  const message = await Message.create({
    channelId: channel.id,
    organizationId: channel.organizationId,
    agencyOrganizationId: channel.agencyOrganizationId,
    authorUserId,
    body,
    mentionedUserIds: mentionedUserIds || [],
    threadParentMessageId: threadParentMessageId || null,
  });

  for (const mentionedUserId of mentionedUserIds || []) {
    if (mentionedUserId === authorUserId) continue;
    // eslint-disable-next-line no-await-in-loop
    await notify({
      userId: mentionedUserId,
      organizationId: channel.organizationId,
      type: 'message_mention',
      title: `You were mentioned in ${channel.name}`,
      body,
      data: { messageId: message.id, channelId: channel.id, projectId: channel.projectId },
    });
  }

  return message;
}

/**
 * Converts a message into a Task (architecture § 11: "conversion to
 * tasks"). Employee-only in practice — gated by tasks.manage at the
 * route level, matching Task creation's own permission.
 */
async function convertMessageToTask({
  context, projectId, channelId, messageId, isClientVisible,
}) {
  const project = await assertProjectAccess(context, projectId);
  const message = await getMessageByIdForRequester(context, messageId);
  if (!message || message.channelId !== channelId) throw invalid('Message not found', 404);
  if (message.convertedToTaskId) throw invalid('This message was already converted to a task', 409);

  const task = await Task.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    title: message.body.slice(0, 255),
    isClientVisible: !!isClientVisible,
  });
  await message.update({ convertedToTaskId: task.id });
  return task;
}

module.exports = {
  listChannels, getChannel, listMessages, postMessage, convertMessageToTask,
};
