'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./noteController');

// Internal team notes — agency-only, never visible to a client membership.
router.use(authenticate, resolveContext(), requireEmployeeMembership());

router.get('/', requirePermission('projects.view'), controller.listForProject);
router.post('/', requirePermission('projects.manage'), [
  body('body').isString().trim().notEmpty(),
], validate, controller.createForProject);

module.exports = router;
