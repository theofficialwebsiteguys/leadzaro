const { OutreachActivity, Lead } = require('../models');
const { success, created, notFound } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');

async function getActivities(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { leadId } = req.query;

    const where = { userId: req.user.id };
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
      userId: req.user.id,
      leadId,
      type,
      note,
    });

    return created(res, { activity }, 'Activity logged');
  } catch (err) {
    next(err);
  }
}

async function deleteActivity(req, res, next) {
  try {
    const activity = await OutreachActivity.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!activity) return notFound(res, 'Activity not found');

    await activity.destroy();
    return success(res, {}, 'Activity deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = { getActivities, addActivity, deleteActivity };
