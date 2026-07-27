'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./sectionDefinitionController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('builder.edit'), controller.list);

module.exports = router;
