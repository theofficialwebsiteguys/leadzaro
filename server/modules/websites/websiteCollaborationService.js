'use strict';

const { Op } = require('sequelize');
const { WebsiteEditLock, WebsitePresence } = require('../../models');
const {
  listWebsiteEditLocksForRequester, getWebsiteEditLockByIdForRequester, listWebsitePresenceForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('./websiteService');

const LOCK_TTL_SECONDS = 60;
const PRESENCE_RECENCY_SECONDS = 30;

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * A lock past its own expiresAt is simply treated as available — no
 * cleanup job exists or is needed (current-phase-plan.md § 2i).
 */
async function listActiveLocks(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteEditLocksForRequester(context, { websiteId: website.id, expiresAt: { [Op.gt]: new Date() } });
}

/**
 * Idempotent: the same user re-acquiring their own section's lock just
 * renews expiresAt (a heartbeat), not an error. A different user gets a
 * 409 while the lock is still active — cleared automatically once it
 * naturally expires.
 */
async function acquireLock({
  context, projectId, sectionKey, userId,
}) {
  const website = await getWebsite(context, projectId);
  if (!sectionKey?.trim()) throw invalid('sectionKey is required');

  const [existing] = await listWebsiteEditLocksForRequester(context, { websiteId: website.id, sectionKey });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_SECONDS * 1000);

  if (existing) {
    if (existing.lockedByUserId !== userId && existing.expiresAt > now) {
      throw invalid('This section is already locked by another user', 409);
    }
    await existing.update({ lockedByUserId: userId, lockedAt: now, expiresAt });
    return existing;
  }

  return WebsiteEditLock.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    sectionKey,
    lockedByUserId: userId,
    lockedAt: now,
    expiresAt,
  });
}

async function releaseLock({ context, projectId, lockId, userId }) {
  await getWebsite(context, projectId);
  const lock = await getWebsiteEditLockByIdForRequester(context, lockId);
  if (!lock) throw invalid('Lock not found', 404);
  if (lock.lockedByUserId !== userId) throw invalid('Only the user holding this lock can release it', 403);
  await lock.destroy();
  return lock;
}

async function heartbeatPresence({
  context, projectId, sectionKey, userId,
}) {
  const website = await getWebsite(context, projectId);
  const [presence] = await WebsitePresence.findOrCreate({
    where: { websiteId: website.id, userId },
    defaults: {
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      userId,
      sectionKey: sectionKey || null,
      lastSeenAt: new Date(),
    },
    __visibilityScoped: true,
  });
  await presence.update({ sectionKey: sectionKey || null, lastSeenAt: new Date() });
  return presence;
}

/**
 * Only rows seen within the last PRESENCE_RECENCY_SECONDS are "current"
 * — a stale row (the tab was closed, the heartbeat stopped) simply
 * disappears from this list on its own, no cleanup job needed.
 */
async function listCurrentPresence(context, projectId) {
  const website = await getWebsite(context, projectId);
  const since = new Date(Date.now() - PRESENCE_RECENCY_SECONDS * 1000);
  return listWebsitePresenceForRequester(context, { websiteId: website.id, lastSeenAt: { [Op.gt]: since } });
}

module.exports = {
  listActiveLocks, acquireLock, releaseLock, heartbeatPresence, listCurrentPresence,
};
