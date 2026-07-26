const mergeService = require('./mergeService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listDuplicates(req, res, next) {
  try {
    const groups = await mergeService.findPossibleDuplicates(req.context.organization.id);
    return success(res, { duplicateGroups: groups });
  } catch (err) {
    next(err);
  }
}

async function preview(req, res, next) {
  try {
    const { winnerId, loserId } = req.query;
    const result = await mergeService.previewMerge(winnerId, loserId, req.context.organization.id);
    return success(res, result);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function merge(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const { winnerId, loserId, reason } = req.body;
    const result = await mergeService.merge(winnerId, loserId, orgId, req.user.id, reason);

    // mergeService already writes the detailed opportunity.merged audit
    // entry (it needs the transaction-scoped moved-ids snapshot for
    // undo); this is a lighter top-level entry for the audit feed.
    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'crm.duplicate_merge_completed',
      targetType: 'Opportunity',
      targetId: result.loser.id,
      metadata: { winnerOpportunityId: result.winner.id, reason },
      req,
    });

    return success(res, {
      winner: result.winner,
      loser: result.loser,
      movedContactIds: result.movedContactIds,
      movedLocationIds: result.movedLocationIds,
    }, 'Opportunities merged');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function undoMerge(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const loser = await mergeService.undoMerge(req.params.id, orgId, req.user.id);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'crm.duplicate_merge_undone', targetType: 'Opportunity', targetId: loser.id, req,
    });

    return success(res, { opportunity: loser }, 'Merge undone');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listDuplicates, preview, merge, undoMerge,
};
