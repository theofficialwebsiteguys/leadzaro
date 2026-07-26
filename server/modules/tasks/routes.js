'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./taskController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.get('/:taskId', requirePermission('projects.view'), controller.getById);

router.post('/', requirePermission('tasks.manage'), [
  body('title').notEmpty(),
], validate, controller.create);
router.patch('/:taskId', requirePermission('tasks.manage'), controller.update);
router.post('/:taskId/archive', requirePermission('tasks.manage'), controller.archive);

router.post('/:taskId/time-entries', requirePermission('tasks.manage'), [
  body('minutes').isInt({ min: 1 }),
], validate, controller.logTime);
router.get('/:taskId/time-entries', requirePermission('tasks.manage'), controller.listTimeEntries);

module.exports = router;
