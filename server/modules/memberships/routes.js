const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./membershipController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('memberships.manage'), controller.list);

router.put('/:id/roles', requirePermission('roles.manage'), [
  body('roleKeys').isArray({ min: 1 }).withMessage('roleKeys must be a non-empty array'),
], validate, controller.updateRoles);

router.patch('/:id/status', requirePermission('memberships.manage'), [
  body('status').isIn(['active', 'suspended', 'removed']),
], validate, controller.updateStatus);

router.post('/:id/permission-overrides', requirePermission('roles.manage'), [
  body('permissionKey').notEmpty(),
  body('effect').isIn(['grant', 'restrict']),
  body('reason').optional().isString().isLength({ max: 255 }),
], validate, controller.setPermissionOverride);

router.delete('/:id/permission-overrides/:permissionKey', requirePermission('roles.manage'), controller.removePermissionOverride);

module.exports = router;
