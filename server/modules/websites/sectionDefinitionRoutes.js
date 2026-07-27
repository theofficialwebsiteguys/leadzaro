'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./sectionDefinitionController');
const governanceController = require('./libraryGovernanceController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('builder.edit'), controller.list);

// Registered before '/:id/...' below is irrelevant here (no conflicting
// wildcard on this router), but kept as a fixed literal path regardless
// for the same reason the versions/compare route ordering matters
// elsewhere in this module — a literal segment before any future
// wildcard addition.
router.get('/manage', requirePermission('builder.manage'), governanceController.listSectionDefinitionsForGovernance);
router.post('/', requirePermission('builder.manage'), [
  body('name').notEmpty(),
  body('componentKey').notEmpty(),
  body('category').notEmpty(),
], validate, governanceController.createSectionDefinition);
router.post('/:id/publish', requirePermission('builder.manage'), (req, res, next) => {
  req.body.status = 'published';
  return governanceController.setSectionDefinitionStatus(req, res, next);
});
router.post('/:id/deprecate', requirePermission('builder.manage'), (req, res, next) => {
  req.body.status = 'deprecated';
  return governanceController.setSectionDefinitionStatus(req, res, next);
});

module.exports = router;
