'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./requestController');

router.use(authenticate, resolveContext());

// The "unified support queue" (architecture § 12): every ClientRequest
// across every project at the caller's own agency, not scoped to one
// project. Gated by requests.manage — the same hands-on employee roles
// that can already work individual requests/tasks, not manager-only.
router.get('/queue', requirePermission('requests.manage'), controller.listQueue);

module.exports = router;
