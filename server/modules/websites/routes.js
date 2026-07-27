'use strict';

const router = require('express').Router({ mergeParams: true });
const { body, query } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./websiteController');
const editorAssignmentController = require('./websiteEditorAssignmentController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.getWebsite);
router.post('/', requirePermission('builder.edit'), [
  body('name').notEmpty(),
  body('startingMode').notEmpty(),
], validate, controller.createWebsite);
router.patch('/draft', requirePermission('builder.edit'), controller.updateDraftSchema);

router.get('/versions', requirePermission('projects.view'), controller.listVersions);
// /versions/compare must be registered before the /versions/:versionId
// wildcard GET route below — Express matches in registration order, and
// :versionId would otherwise swallow the literal "compare" segment.
router.get('/versions/compare', requirePermission('projects.view'), [
  query('from').notEmpty(),
  query('to').notEmpty(),
], validate, controller.compareVersions);
router.get('/versions/:versionId', requirePermission('projects.view'), controller.getVersion);
router.post('/versions', requirePermission('builder.edit'), controller.createCheckpoint);
router.post('/versions/autosave', requirePermission('builder.edit'), controller.createAutosave);
router.post('/versions/:versionId/restore', requirePermission('builder.edit'), controller.restoreVersion);
router.post('/versions/:versionId/publish', requirePermission('builder.publish'), controller.publishVersion);

router.post('/forms/test-submit', requirePermission('builder.edit'), [
  body('pageId').notEmpty(),
  body('sectionId').notEmpty(),
], validate, controller.submitTestForm);

router.get('/editors', requirePermission('builder.manage'), editorAssignmentController.list);
router.post('/editors', requirePermission('builder.manage'), [
  body('userId').notEmpty(),
  body('editingLevel').notEmpty(),
], validate, editorAssignmentController.create);
router.delete('/editors/:assignmentId', requirePermission('builder.manage'), editorAssignmentController.remove);

module.exports = router;
