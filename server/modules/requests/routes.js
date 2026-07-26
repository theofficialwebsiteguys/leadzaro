'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./requestController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.post('/', requirePermission('requests.create'), [
  body('category').notEmpty(),
  body('description').notEmpty(),
], validate, controller.create);
router.patch('/:requestId/status', requirePermission('requests.manage'), [
  body('status').notEmpty(),
], validate, controller.updateStatus);
router.post('/:requestId/convert-to-task', requirePermission('requests.manage'), controller.convertToTask);

module.exports = router;
