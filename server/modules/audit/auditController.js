const { Op } = require('sequelize');
const { AuditLog, User } = require('../../models');
const { getPagination, formatPaginatedResponse } = require('../../utils/pagination');
const { success } = require('../../utils/response');

async function list(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const {
      action, actorUserId, targetType, from, to,
    } = req.query;

    const where = { organizationId: req.context.organization.id };
    if (action) where.action = { [Op.iLike]: `%${action}%` };
    if (actorUserId) where.actorUserId = actorUserId;
    if (targetType) where.targetType = targetType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(from);
      if (to) where.createdAt[Op.lte] = new Date(to);
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return success(res, formatPaginatedResponse(rows, count, page, limit));
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
