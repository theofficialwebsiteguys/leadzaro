'use strict';

const productionDeployService = require('./productionDeployService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function deploy(req, res, next) {
  try {
    const { deployment, rolledBack, rollbackFailed } = await productionDeployService.deployToProduction({
      context: req.context, projectId: req.params.projectId, versionId: req.params.versionId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.production_deploy',
      targetType: 'WebsiteDeployment',
      targetId: deployment.id,
      metadata: {
        projectId: req.params.projectId, versionId: req.params.versionId, status: deployment.status,
      },
      req,
    });

    let message = 'Deployed to production';
    if (rollbackFailed) message = 'Deploy failed AND the automatic rollback also failed — see notifications';
    else if (rolledBack) message = 'Deploy failed health check and was automatically rolled back';

    return success(res, { deployment }, message);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listDeployments(req, res, next) {
  try {
    const deployments = await productionDeployService.listProductionDeployments(req.context, req.params.projectId);
    return success(res, { deployments });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getCurrentLive(req, res, next) {
  try {
    const deployment = await productionDeployService.getCurrentLiveDeployment(req.context, req.params.projectId);
    return success(res, { deployment });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getDeployment(req, res, next) {
  try {
    const deployment = await productionDeployService.getDeployment(req.context, req.params.projectId, req.params.deploymentId);
    if (!deployment) return error(res, 'Deployment not found', 404);
    return success(res, { deployment });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  deploy, listDeployments, getCurrentLive, getDeployment,
};
