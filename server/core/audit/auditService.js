'use strict';

const { AuditLog } = require('../../models');

/**
 * Records an immutable audit entry. `metadata` must never contain secrets,
 * tokens, or full passwords — only safe, already-public-to-the-actor
 * fields (ids, names, before/after status values, etc).
 */
async function recordAudit({
  organizationId = null,
  actorUserId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
  req = null,
}) {
  return AuditLog.create({
    organizationId,
    actorUserId,
    action,
    targetType,
    targetId: targetId != null ? String(targetId) : null,
    metadata,
    ipAddress: req?.ip || null,
    requestId: req?.id || null,
  });
}

module.exports = { recordAudit };
