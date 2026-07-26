'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./requestController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.listContentInbox);
router.post('/', requirePermission('requests.create'), [
  body('type').notEmpty(),
  body('body').notEmpty(),
], validate, controller.submitContentInboxItem);
router.patch('/:itemId/status', requirePermission('requests.manage'), [
  body('status').notEmpty(),
], validate, controller.updateContentInboxItemStatus);

module.exports = router;
