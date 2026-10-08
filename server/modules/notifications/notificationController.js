const notificationService = require('../../core/notifications/notificationService');
const { getPagination, formatPaginatedResponse } = require('../../utils/pagination');
const { success, notFound, error } = require('../../utils/response');
const { NotificationPreference } = require('../../models');
const { KNOWN_TYPES } = require('../../core/notifications/catalog');

async function list(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { rows, count } = await notificationService.listForUser(req.user.id, { limit, offset });
    return success(res, formatPaginatedResponse(rows, count, page, limit));
  } catch (err) {
    next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    return success(res, { count });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const ok = await notificationService.markRead(req.user.id, req.params.id);
    if (!ok) return notFound(res, 'Notification not found');
    return success(res, {}, 'Marked as read');
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    await notificationService.markAllRead(req.user.id);
    return success(res, {}, 'All notifications marked as read');
  } catch (err) {
    next(err);
  }
}

async function getPreferences(req, res, next) {
  try {
    const preferences = await notificationService.getPreferences(req.user.id);
    return success(res, { preferences });
  } catch (err) {
    next(err);
  }
}

async function setPreference(req, res, next) {
  try {
    const { category, channel, frequency } = req.body;
    if (!NotificationPreference.CHANNELS.includes(channel) || !NotificationPreference.FREQUENCIES.includes(frequency)) {
      return error(res, 'Invalid channel or frequency', 422);
    }
    // Only events Leadzaro actually sends, and only frequencies it acts on
    // (digests don't exist yet).
    if (!KNOWN_TYPES.has(category)) return error(res, 'Unknown notification type', 422);
    if (!['immediate', 'muted'].includes(frequency)) return error(res, 'Only on or off is supported', 422);
    const preference = await notificationService.setPreference(req.user.id, { category, channel, frequency });
    return success(res, { preference }, 'Preference updated');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list, unreadCount, markRead, markAllRead, getPreferences, setPreference,
};
