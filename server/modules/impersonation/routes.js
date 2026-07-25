const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./impersonationController');

router.use(authenticate, resolveContext());

router.get('/candidates', requirePermission('impersonation.use'), controller.candidates);

router.post('/start', requirePermission('impersonation.use'), [
  body('membershipId').notEmpty(),
  body('reason').trim().notEmpty().withMessage('A reason is required to start impersonation').isLength({ max: 255 }),
], validate, controller.start);

router.post('/end', controller.end);

module.exports = router;
