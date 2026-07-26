'use strict';

const taskService = require('./taskService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const tasks = await taskService.listTasks(req.context, req.params.projectId);
    return success(res, { tasks });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getById(req, res, next) {
  try {
    const task = await taskService.getTask(req.context, req.params.projectId, req.params.taskId);
    return success(res, { task });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function create(req, res, next) {
  try {
    const task = await taskService.createTask({
      context: req.context,
      projectId: req.params.projectId,
      title: req.body.title,
      description: req.body.description,
      assigneeUserId: req.body.assigneeUserId,
      status: req.body.status,
      priority: req.body.priority,
      dueDate: req.body.dueDate,
      estimateMinutes: req.body.estimateMinutes,
      tags: req.body.tags,
      isClientVisible: req.body.isClientVisible,
      parentTaskId: req.body.parentTaskId,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'task.created', targetType: 'Task', targetId: task.id, metadata: { projectId: req.params.projectId, title: task.title }, req,
    });

    return success(res, { task }, 'Task created', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function update(req, res, next) {
  try {
    const task = await taskService.updateTask({
      context: req.context, projectId: req.params.projectId, taskId: req.params.taskId, patch: req.body,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'task.updated', targetType: 'Task', targetId: task.id, metadata: { fields: Object.keys(req.body) }, req,
    });

    return success(res, { task }, 'Task updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function archive(req, res, next) {
  try {
    const task = await taskService.archiveTask({ context: req.context, projectId: req.params.projectId, taskId: req.params.taskId });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'task.archived', targetType: 'Task', targetId: task.id, req,
    });

    return success(res, { task }, 'Task archived');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function logTime(req, res, next) {
  try {
    const timeEntry = await taskService.logTime({
      context: req.context,
      projectId: req.params.projectId,
      taskId: req.params.taskId,
      minutes: req.body.minutes,
      note: req.body.note,
      loggedAt: req.body.loggedAt,
      userId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'task.time_logged', targetType: 'Task', targetId: req.params.taskId, metadata: { minutes: timeEntry.minutes }, req,
    });

    return success(res, { timeEntry }, 'Time logged', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listTimeEntries(req, res, next) {
  try {
    const timeEntries = await taskService.listTimeEntries(req.context, req.params.projectId, req.params.taskId);
    return success(res, { timeEntries });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, getById, create, update, archive, logTime, listTimeEntries,
};
