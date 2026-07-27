'use strict';

const websiteEditorAssignmentService = require('./websiteEditorAssignmentService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const assignments = await websiteEditorAssignmentService.listAssignments(req.context, req.params.projectId);
    return success(res, { assignments });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function create(req, res, next) {
  try {
    const assignment = await websiteEditorAssignmentService.addAssignment({
      context: req.context,
      projectId: req.params.projectId,
      userId: req.body.userId,
      editingLevel: req.body.editingLevel,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.editor_assignment_set',
      targetType: 'WebsiteEditorAssignment',
      targetId: assignment.id,
      metadata: { userId: req.body.userId, editingLevel: assignment.editingLevel },
      req,
    });

    return success(res, { assignment }, 'Editor assignment saved');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function remove(req, res, next) {
  try {
    const assignment = await websiteEditorAssignmentService.removeAssignment({
      context: req.context, projectId: req.params.projectId, assignmentId: req.params.assignmentId,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.editor_assignment_removed',
      targetType: 'WebsiteEditorAssignment',
      targetId: assignment.id,
      metadata: { userId: assignment.userId },
      req,
    });

    return success(res, { removed: true }, 'Editor assignment removed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { list, create, remove };
