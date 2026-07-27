'use strict';

const websiteCollaborationService = require('./websiteCollaborationService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listLocks(req, res, next) {
  try {
    const locks = await websiteCollaborationService.listActiveLocks(req.context, req.params.projectId);
    return success(res, { locks });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function acquireLock(req, res, next) {
  try {
    const lock = await websiteCollaborationService.acquireLock({
      context: req.context, projectId: req.params.projectId, sectionKey: req.body.sectionKey, userId: req.user.id,
    });
    return success(res, { lock }, 'Lock acquired');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function releaseLock(req, res, next) {
  try {
    await websiteCollaborationService.releaseLock({
      context: req.context, projectId: req.params.projectId, lockId: req.params.lockId, userId: req.user.id,
    });
    return success(res, { released: true }, 'Lock released');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function heartbeatPresence(req, res, next) {
  try {
    const presence = await websiteCollaborationService.heartbeatPresence({
      context: req.context, projectId: req.params.projectId, sectionKey: req.body.sectionKey, userId: req.user.id,
    });
    return success(res, { presence });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listPresence(req, res, next) {
  try {
    const presence = await websiteCollaborationService.listCurrentPresence(req.context, req.params.projectId);
    return success(res, { presence });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listLocks, acquireLock, releaseLock, heartbeatPresence, listPresence,
};
