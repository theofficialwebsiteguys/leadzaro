'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./projectController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.get('/:id', requirePermission('projects.view'), controller.getById);

router.patch('/:id/stage', requirePermission('projects.change_stage'), [
  body('stage').notEmpty(),
], validate, controller.changeStage);

router.patch('/:id/health', requirePermission('projects.manage'), [
  body('healthStatus').notEmpty(),
], validate, controller.updateHealthStatus);

router.get('/:id/assignments', requirePermission('projects.view'), controller.listAssignments);
router.post('/:id/assignments', requirePermission('projects.manage'), [
  body('userId').notEmpty(),
  body('roleSlot').notEmpty(),
], validate, controller.addAssignment);
router.delete('/:id/assignments/:assignmentId', requirePermission('projects.manage'), controller.removeAssignment);

router.get('/:id/financials', requirePermission('projects.manage'), controller.getFinancials);
router.patch('/:id/financials', requirePermission('projects.manage'), controller.updateFinancials);

router.get('/:id/dashboard', requirePermission('projects.view'), controller.getDashboard);

router.use('/:projectId/tasks', require('../tasks/routes'));
router.use('/:projectId/channels', require('../messaging/routes'));
router.use('/:projectId/requests', require('../requests/routes'));
router.use('/:projectId/content-inbox', require('../requests/contentInboxRoutes'));
router.use('/:projectId/meetings', require('../meetings/routes'));
router.use('/:projectId/files', require('../files/routes'));
router.use('/:projectId/cancellation-requests', require('../cancellations/routes'));
router.use('/:projectId/website', require('../websites/routes'));

module.exports = router;
