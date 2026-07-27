'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./meetingController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.post('/', requirePermission('meetings.request'), [
  body('subject').notEmpty(),
  body('proposedSlots').isArray({ min: 1 }),
], validate, controller.requestMeeting);
router.post('/:meetingId/confirm', requirePermission('meetings.manage'), [
  body('confirmedSlot').notEmpty(),
], validate, controller.confirm);
router.post('/:meetingId/decline', requirePermission('meetings.manage'), controller.decline);
router.post('/:meetingId/cancel', requirePermission('meetings.manage'), controller.cancel);

module.exports = router;
