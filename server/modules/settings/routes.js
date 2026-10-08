'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { success } = require('../../utils/response');
const { context } = require('../sales/salesCommon');
const settings = require('./settingsService');

/**
 * Settings API (ADR 0012), mounted at /api/v1/settings. Personal settings
 * need only a signed-in agency employee; workspace changes need
 * workspace.manage (checked in the service); team and integration
 * management keep using their existing permission-guarded endpoints.
 */
function handle(fn) {
  return async (req, res, next) => {
    try {
      return success(res, await fn(context(req), req));
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return next(err);
    }
  };
}

router.use(authenticate, resolveContext(), requireEmployeeMembership());

router.get('/me', handle((ctx) => settings.getMe(ctx)));
router.put('/me/profile', requirePermission('profile.manage'), handle((ctx, req) => settings.updateProfile(ctx, req.body || {})));
router.put('/me/sales-preferences', requirePermission('profile.manage'), handle((ctx, req) => settings.updateSalesPreferences(ctx, req.body || {})));
router.get('/workspace', handle((ctx) => settings.getWorkspace(ctx)));
router.put('/workspace', requirePermission('workspace.manage'), handle((ctx, req) => settings.updateWorkspace(ctx, req.body || {})));
router.get('/integrations', handle((ctx) => settings.getIntegrations(ctx)));
router.get('/notifications', requirePermission('notifications.manage'), handle((ctx) => settings.getNotifications(ctx)));
router.put('/notifications', requirePermission('notifications.manage'), handle((ctx, req) => settings.updateNotifications(ctx, req.body || {})));

module.exports = router;
