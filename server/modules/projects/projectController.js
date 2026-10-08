'use strict';

const projectService = require('./projectService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) {
    const body = err.checklist ? { checklist: err.checklist } : undefined;
    return error(res, err.message, err.statusCode, body);
  }
  next(err);
}

async function list(req, res, next) {
  try {
    const projects = await projectService.listProjects(req.context);
    return success(res, { projects });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const project = await projectService.getProject(req.context, req.params.id);
    return success(res, { project });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function changeStage(req, res, next) {
  try {
    const { project, previousStage } = await projectService.changeStage({
      context: req.context,
      projectId: req.params.id,
      stage: req.body.stage,
      confirmed: req.body.confirmed,
      overrideReason: req.body.overrideReason,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'project.stage_changed',
      targetType: 'Project',
      targetId: project.id,
      metadata: {
        previousStage, stage: project.stage, confirmed: !!req.body.confirmed, overrideReason: req.body.overrideReason || null,
      },
      req,
    });

    return success(res, { project }, 'Project stage updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateHealthStatus(req, res, next) {
  try {
    const project = await projectService.updateHealthStatus({
      context: req.context, projectId: req.params.id, healthStatus: req.body.healthStatus,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'project.health_overridden', targetType: 'Project', targetId: project.id, metadata: { healthStatus: project.healthStatus }, req,
    });

    return success(res, { project }, 'Project health updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listAssignments(req, res, next) {
  try {
    const assignments = await projectService.listAssignments(req.context, req.params.id);
    return success(res, { assignments });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function addAssignment(req, res, next) {
  try {
    const { assignment, alreadyExisted } = await projectService.addAssignment({
      context: req.context, projectId: req.params.id, userId: req.body.userId, roleSlot: req.body.roleSlot, actorUserId: req.user.id,
    });

    if (!alreadyExisted) {
      await recordAudit({
        organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'project.assignment_added', targetType: 'Project', targetId: req.params.id, metadata: { userId: req.body.userId, roleSlot: req.body.roleSlot }, req,
      });
    }

    return success(res, { assignment }, alreadyExisted ? 'That assignment already exists' : 'Assignment added');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function removeAssignment(req, res, next) {
  try {
    const assignment = await projectService.removeAssignment({
      context: req.context, projectId: req.params.id, assignmentId: req.params.assignmentId,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'project.assignment_removed', targetType: 'Project', targetId: req.params.id, metadata: { userId: assignment.userId, roleSlot: assignment.roleSlot }, req,
    });

    return success(res, { removed: true }, 'Assignment removed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getFinancials(req, res, next) {
  try {
    const financials = await projectService.getFinancials(req.context, req.params.id);
    return success(res, { financials });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateFinancials(req, res, next) {
  try {
    const financials = await projectService.updateFinancials({
      context: req.context,
      projectId: req.params.id,
      estimatedCostCents: req.body.estimatedCostCents,
      actualCostCents: req.body.actualCostCents,
      marginNotes: req.body.marginNotes,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'project.financials_updated', targetType: 'Project', targetId: req.params.id, req,
    });

    return success(res, { financials }, 'Financials updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getDashboard(req, res, next) {
  try {
    const dashboard = await projectService.getLastWorkedContext(req.context, req.params.id);
    return success(res, { dashboard });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getBilling(req, res, next) {
  try {
    const billing = await projectService.getBilling(req.context, req.params.id);
    return success(res, { billing });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list,
  getById,
  changeStage,
  updateHealthStatus,
  listAssignments,
  addAssignment,
  removeAssignment,
  getFinancials,
  updateFinancials,
  getDashboard,
  getBilling,
};
