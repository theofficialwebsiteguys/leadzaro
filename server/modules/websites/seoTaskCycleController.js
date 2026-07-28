'use strict';

const seoTaskCycleService = require('../seo/seoTaskCycleService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function generate(req, res, next) {
  try {
    const { cycle, tasks } = await seoTaskCycleService.generateCycle({
      context: req.context, projectId: req.params.projectId, cyclePeriod: req.body.cyclePeriod, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.task_cycle_generated',
      targetType: 'SeoTaskCycle',
      targetId: cycle.id,
      metadata: { projectId: req.params.projectId, cyclePeriod: cycle.cyclePeriod, taskCount: tasks.length },
      req,
    });

    return success(res, { cycle, tasks }, `Generated ${tasks.length} SEO task(s) for ${cycle.cyclePeriod}`);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function list(req, res, next) {
  try {
    const cycles = await seoTaskCycleService.listCycles(req.context, req.params.projectId);
    return success(res, { cycles });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { generate, list };
