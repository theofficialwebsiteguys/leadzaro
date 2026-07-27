'use strict';

const router = require('express').Router({ mergeParams: true });
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./websiteController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.getWebsite);
router.post('/', requirePermission('builder.edit'), [
  body('name').notEmpty(),
  body('startingMode').notEmpty(),
], validate, controller.createWebsite);
router.patch('/draft', requirePermission('builder.edit'), controller.updateDraftSchema);

router.get('/versions', requirePermission('projects.view'), controller.listVersions);
router.get('/versions/:versionId', requirePermission('projects.view'), controller.getVersion);
router.post('/versions', requirePermission('builder.edit'), controller.createCheckpoint);
router.post('/versions/:versionId/restore', requirePermission('builder.edit'), controller.restoreVersion);

module.exports = router;
