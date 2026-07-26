'use strict';

const { Task, TimeEntry, User } = require('../../models');
const {
  getProjectByIdForRequester, listTasksForRequester, getTaskByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');

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

async function listTasks(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listTasksForRequester(context, { projectId: project.id, archivedAt: null });
}

async function getTask(context, projectId, taskId) {
  await assertProjectAccess(context, projectId);
  const task = await getTaskByIdForRequester(context, taskId);
  if (!task || task.projectId !== projectId) throw invalid('Task not found', 404);
  return task;
}

async function createTask({
  context, projectId, title, description, assigneeUserId, status, priority, dueDate, estimateMinutes, tags, isClientVisible, parentTaskId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!title) throw invalid('title is required');

  if (parentTaskId) {
    const parent = await getTaskByIdForRequester(context, parentTaskId);
    if (!parent || parent.projectId !== project.id) throw invalid('Parent task not found in this project', 404);
  }

  return Task.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    parentTaskId: parentTaskId || null,
    title,
    description: description || null,
    assigneeUserId: assigneeUserId || null,
    status: status || 'todo',
    priority: priority || 'medium',
    dueDate: dueDate || null,
    estimateMinutes: estimateMinutes ?? null,
    tags: tags || [],
    isClientVisible: !!isClientVisible,
  });
}

async function updateTask({ context, projectId, taskId, patch }) {
  const task = await getTask(context, projectId, taskId);
  if (patch.status && !Task.STATUSES.includes(patch.status)) throw invalid(`Unknown status: ${patch.status}`);
  if (patch.priority && !Task.PRIORITIES.includes(patch.priority)) throw invalid(`Unknown priority: ${patch.priority}`);

  const allowedFields = [
    'title', 'description', 'assigneeUserId', 'status', 'priority', 'dueDate', 'estimateMinutes', 'position', 'tags', 'isClientVisible',
  ];
  const updates = {};
  for (const field of allowedFields) {
    if (patch[field] !== undefined) updates[field] = patch[field];
  }
  await task.update(updates);
  return task;
}

async function archiveTask({ context, projectId, taskId }) {
  const task = await getTask(context, projectId, taskId);
  await task.update({ archivedAt: new Date() });
  return task;
}

async function logTime({
  context, projectId, taskId, minutes, note, loggedAt, userId,
}) {
  await getTask(context, projectId, taskId);
  if (!minutes || minutes <= 0) throw invalid('minutes must be a positive number');
  return TimeEntry.create({
    taskId, userId, minutes, note: note || null, loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
  });
}

async function listTimeEntries(context, projectId, taskId) {
  await getTask(context, projectId, taskId);
  return TimeEntry.findAll({
    where: { taskId },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['loggedAt', 'DESC']],
  });
}

module.exports = {
  listTasks, getTask, createTask, updateTask, archiveTask, logTime, listTimeEntries,
};
