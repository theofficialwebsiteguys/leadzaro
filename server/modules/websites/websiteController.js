'use strict';

const websiteService = require('./websiteService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function getWebsite(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.context, req.params.projectId);
    return success(res, { website });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createWebsite(req, res, next) {
  try {
    const website = await websiteService.createWebsite({
      context: req.context,
      projectId: req.params.projectId,
      name: req.body.name,
      startingMode: req.body.startingMode,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.created',
      targetType: 'Website',
      targetId: website.id,
      metadata: { projectId: req.params.projectId, startingMode: website.startingMode },
      req,
    });

    return success(res, { website }, 'Website created', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateDraftSchema(req, res, next) {
  try {
    const website = await websiteService.updateDraftSchema({
      context: req.context, projectId: req.params.projectId, draftSchema: req.body.draftSchema,
    });
    return success(res, { website }, 'Draft saved');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listVersions(req, res, next) {
  try {
    const versions = await websiteService.listVersions(req.context, req.params.projectId);
    return success(res, { versions });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getVersion(req, res, next) {
  try {
    const version = await websiteService.getVersion(req.context, req.params.projectId, req.params.versionId);
    return success(res, { version });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createCheckpoint(req, res, next) {
  try {
    const version = await websiteService.createCheckpoint({
      context: req.context, projectId: req.params.projectId, label: req.body.label, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.checkpoint_created',
      targetType: 'WebsiteVersion',
      targetId: version.id,
      metadata: { projectId: req.params.projectId, label: version.label },
      req,
    });

    return success(res, { version }, 'Checkpoint created', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createAutosave(req, res, next) {
  try {
    const version = await websiteService.createAutosave({
      context: req.context, projectId: req.params.projectId, actorUserId: req.user.id,
    });
    return success(res, { version }, 'Autosaved', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function compareVersions(req, res, next) {
  try {
    const comparison = await websiteService.compareVersions({
      context: req.context, projectId: req.params.projectId, fromVersionId: req.query.from, toVersionId: req.query.to,
    });
    return success(res, { comparison });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function restoreVersion(req, res, next) {
  try {
    const website = await websiteService.restoreVersion({
      context: req.context, projectId: req.params.projectId, versionId: req.params.versionId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.version_restored',
      targetType: 'Website',
      targetId: website.id,
      metadata: { versionId: req.params.versionId },
      req,
    });

    return success(res, { website }, 'Version restored');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function publishVersion(req, res, next) {
  try {
    const version = await websiteService.publishVersion({
      context: req.context, projectId: req.params.projectId, versionId: req.params.versionId,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.version_published',
      targetType: 'WebsiteVersion',
      targetId: version.id,
      req,
    });

    return success(res, { version }, 'Version published');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  getWebsite,
  createWebsite,
  updateDraftSchema,
  listVersions,
  getVersion,
  createCheckpoint,
  createAutosave,
  compareVersions,
  restoreVersion,
  publishVersion,
};
