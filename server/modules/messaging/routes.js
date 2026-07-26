'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./messagingController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.listChannels);
router.get('/:channelId/messages', requirePermission('projects.view'), controller.listMessages);
router.post('/:channelId/messages', requirePermission('messages.post'), [
  body('body').notEmpty(),
], validate, controller.postMessage);
router.post('/:channelId/messages/:messageId/convert-to-task', requirePermission('tasks.manage'), controller.convertToTask);

module.exports = router;
