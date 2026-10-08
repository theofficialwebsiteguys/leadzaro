'use strict';

const { Notification, NotificationPreference, User } = require('../../models');
const { getEmailAdapter } = require('./emailAdapter');

/**
 * Creates an in-app notification and, unless the recipient has muted the
 * category, attempts an email via the configured adapter. Only
 * `immediate`/`muted` are acted on synchronously in Phase 1 — `daily`/
 * `weekly` digest delivery needs a background job scheduler that does not
 * exist yet (reserved for a later phase); the preference is still stored
 * so digest delivery can be added without a data migration.
 */
async function notify({
  userId, organizationId = null, type, title, body = null, data = null,
}) {
  const preferences = await NotificationPreference.findAll({ where: { userId, category: type } });
  const muted = (channel) => preferences.some((p) => p.channel === channel && p.frequency === 'muted');

  // Settings → Notifications (ADR 0012): a muted in-app category is not
  // stored at all; a muted email category is not emailed.
  const notification = muted('in_app') ? null : await Notification.create({
    userId, organizationId, type, title, body, data,
  });

  if (!muted('email')) {
    const user = await User.findByPk(userId, { attributes: ['email', 'name'] });
    if (user) {
      const adapter = getEmailAdapter();
      await adapter.send({ to: user.email, subject: title, text: body || title });
    }
  }

  return notification;
}

function getUnreadCount(userId) {
  return Notification.count({ where: { userId, readAt: null } });
}

function listForUser(userId, { limit = 20, offset = 0 } = {}) {
  return Notification.findAndCountAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });
}

async function markRead(userId, notificationId) {
  const [count] = await Notification.update(
    { readAt: new Date() },
    { where: { id: notificationId, userId } }
  );
  return count > 0;
}

async function markAllRead(userId) {
  await Notification.update({ readAt: new Date() }, { where: { userId, readAt: null } });
}

async function getPreferences(userId) {
  return NotificationPreference.findAll({ where: { userId } });
}

async function setPreference(userId, { category, channel, frequency }) {
  const [pref] = await NotificationPreference.findOrCreate({
    where: { userId, category, channel },
    defaults: { frequency },
  });
  if (pref.frequency !== frequency) {
    await pref.update({ frequency });
  }
  return pref;
}

module.exports = {
  notify, getUnreadCount, listForUser, markRead, markAllRead, getPreferences, setPreference,
};
