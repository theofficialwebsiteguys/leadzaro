'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./libraryGovernanceController');

router.use(authenticate, resolveContext());

// Browsing (picking a template at website-creation time): builder.edit,
// same as section-definitions' own browse route. Employee-only in
// practice — listDesignSystemTemplatesForBrowsing returns an empty list
// for a client membership (current-phase-plan.md § 2a), never a 403,
// since builder.edit itself is legitimately held by client roles too.
router.get('/', requirePermission('builder.edit'), controller.listDesignSystemTemplates);

router.get('/manage', requirePermission('builder.manage'), controller.listDesignSystemTemplatesForGovernance);
router.post('/', requirePermission('builder.manage'), [
  body('name').notEmpty(),
], validate, controller.createDesignSystemTemplate);
router.post('/:id/publish', requirePermission('builder.manage'), (req, res, next) => {
  req.body.status = 'published';
  return controller.setDesignSystemTemplateStatus(req, res, next);
});
router.post('/:id/deprecate', requirePermission('builder.manage'), (req, res, next) => {
  req.body.status = 'deprecated';
  return controller.setDesignSystemTemplateStatus(req, res, next);
});

module.exports = router;
