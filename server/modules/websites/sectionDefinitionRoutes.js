'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireAnyPermission } = require('../../core/authorization/context');
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
//
// Correction (Phase 6 slice 8, current-phase-plan.md § 2e — "component
// publication permission/review" as its own outcome, distinct from
// Phase 5's original single-gate design): creating a custom component's
// editor schema is now a builder.develop action (a developer defines the
// technical shape), while publishing/deprecating it stays builder.manage
// — a genuine two-party review workflow (developer proposes, employee
// approves) where Phase 5 originally let the same builder.manage holder
// do both. The governance list is visible to either permission, so a
// developer can see their own drafted-but-unpublished work.
router.get('/manage', requireAnyPermission(['builder.manage', 'builder.develop']), governanceController.listSectionDefinitionsForGovernance);
router.post('/', requirePermission('builder.develop'), [
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
