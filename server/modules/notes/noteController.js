'use strict';

const noteService = require('./noteService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listForProject(req, res, next) {
  try {
    const notes = await noteService.listNotesForProject(req.context, req.params.projectId);
    return success(res, { notes });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createForProject(req, res, next) {
  try {
    const note = await noteService.createNoteForProject({
      context: req.context, projectId: req.params.projectId, body: req.body.body, authorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'client_note.created', targetType: 'ClientNote', targetId: note.id, req,
    });

    return success(res, { note }, 'Note added', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { listForProject, createForProject };
