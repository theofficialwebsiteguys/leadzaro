'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { success } = require('../../utils/response');
const { context } = require('../sales/salesCommon');
const { env } = require('../../core/config/env');
const gmail = require('./gmailConnectionService');

/**
 * Each person's own Gmail connection (ADR 0015), mounted at
 * /api/v1/integrations/gmail — ahead of the admin-only integrations router,
 * because connecting your own mailbox is a personal setting.
 */

// Google redirects the browser here, so there's no bearer token: the signed
// state plus the matching httpOnly nonce cookie identify the person.
router.get('/callback', async (req, res) => {
  const nonce = req.cookies?.[gmail.STATE_COOKIE];
  res.clearCookie(gmail.STATE_COOKIE, { ...gmail.stateCookieOptions(), maxAge: undefined });
  let target;
  try {
    target = await gmail.handleCallback(req.query || {}, nonce);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[mailbox] Gmail callback failed: ${err.name}`);
    target = `${env.APP_BASE_URL.replace(/\/$/, '')}/app/settings/account?gmail=error#email-sending`;
  }
  res.redirect(target);
});

function handle(fn) {
  return async (req, res, next) => {
    try {
      return success(res, await fn(context(req), req, res));
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return next(err);
    }
  };
}

router.use(authenticate, resolveContext(), requireEmployeeMembership(), requirePermission('profile.manage'));

router.get('/', handle((ctx) => gmail.status(ctx)));
router.post('/connect', handle(async (ctx, req, res) => {
  const { url, nonce } = await gmail.startConnect(ctx);
  res.cookie(gmail.STATE_COOKIE, nonce, gmail.stateCookieOptions());
  return { url };
}));
router.delete('/', handle((ctx) => gmail.disconnect(ctx)));

module.exports = router;
