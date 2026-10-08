'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { success } = require('../../utils/response');
const { context } = require('../sales/salesCommon');
const { getOverview } = require('./overviewService');

// Dashboard overview (ADR 0012). Team scope is decided in the service from
// the caller's own permissions, never from the query alone.
router.use(authenticate, resolveContext(), requireEmployeeMembership());

router.get('/', requirePermission('dashboard.view'), async (req, res, next) => {
  try {
    return success(res, await getOverview(context(req), req.query));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    return next(err);
  }
});

module.exports = router;
