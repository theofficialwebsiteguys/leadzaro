const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./auditController');

router.use(authenticate, resolveContext(), requirePermission('audit.view'));

router.get('/', controller.list);

module.exports = router;
