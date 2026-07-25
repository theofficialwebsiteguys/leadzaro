const router = require('express').Router();
const { body, query } = require('express-validator');
const { authenticate, optionalAuthenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const { authLimiter } = require('../../middleware/rateLimiter');
const controller = require('./invitationController');

// Public: an invitation link must be inspectable and acceptable without
// already being logged in.
router.get('/lookup', [query('token').notEmpty()], validate, controller.lookup);
router.post('/accept', authLimiter, optionalAuthenticate, [
  body('token').notEmpty(),
  body('name').optional().isString().isLength({ max: 100 }),
  body('password').optional().isLength({ min: 8 }),
], validate, controller.accept);

router.use(authenticate, resolveContext());

router.post('/', requirePermission('invitations.manage'), [
  body('email').trim().isEmail().normalizeEmail(),
  body('membershipType').isIn(['employee', 'client']),
  body('roleKeys').isArray({ min: 1 }),
], validate, controller.create);

router.get('/', requirePermission('invitations.manage'), controller.list);
router.post('/:id/resend', requirePermission('invitations.manage'), controller.resend);
router.post('/:id/revoke', requirePermission('invitations.manage'), controller.revoke);

module.exports = router;
