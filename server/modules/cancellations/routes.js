'use strict';

const router = require('express').Router({ mergeParams: true });
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./cancellationController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.post('/', requirePermission('cancellations.request'), controller.create);
router.post('/:requestId/confirm', requirePermission('cancellations.manage'), controller.confirm);
router.post('/:requestId/withdraw', requirePermission('cancellations.manage'), controller.withdraw);

module.exports = router;
