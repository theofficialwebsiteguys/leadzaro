const { OutreachActivity, Lead } = require('../models');
const { recordAudit } = require('../core/audit/auditService');
const { success, created, notFound, error } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { Op } = require('sequelize');

async function getActivities(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { leadId, archived } = req.query;

    const where = { organizationId: req.context.organization.id, deletedAt: null };
    where.archivedAt = archived === 'true' ? { [Op.ne]: null } : null;
    if (leadId) where.leadId = leadId;

    const { rows, count } = await OutreachActivity.findAndCountAll({
      where,
      include: [{ model: Lead, as: 'lead', attributes: ['id', 'name', 'city', 'category'] }],
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return success(res, formatPaginatedResponse(rows, count, page, limit));
  } catch (err) {
    next(err);
  }
}

async function addActivity(req, res, next) {
  try {
    const { leadId, type, note } = req.body;

    const lead = await Lead.findByPk(leadId);
    if (!lead) return notFound(res, 'Lead not found');

    const activity = await OutreachActivity.create({
      organizationId: req.context.organization.id,
      userId: req.user.id,
      leadId,
      type,
      note,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'outreach.created', targetType: 'OutreachActivity', targetId: activity.id, metadata: { type }, req,
    });

    return created(res, { activity }, 'Activity logged');
  } catch (err) {
    next(err);
  }
}

async function archiveActivity(req, res, next) {
  try {
    const activity = await OutreachActivity.findOne({
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!activity) return notFound(res, 'Activity not found');

    await activity.update({ archivedAt: new Date() });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'outreach.archived', targetType: 'OutreachActivity', targetId: activity.id, req,
    });

    return success(res, {}, 'Activity archived');
  } catch (err) {
    next(err);
  }
}

async function restoreActivity(req, res, next) {
  try {
    const activity = await OutreachActivity.findOne({
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!activity) return notFound(res, 'Activity not found');
    if (!activity.archivedAt) return error(res, 'Activity is not archived', 400);

    await activity.update({ archivedAt: null });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'outreach.restored', targetType: 'OutreachActivity', targetId: activity.id, req,
    });

    return success(res, {}, 'Activity restored');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getActivities, addActivity, archiveActivity, restoreActivity,
};
