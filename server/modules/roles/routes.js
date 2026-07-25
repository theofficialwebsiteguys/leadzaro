const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requireAnyPermission } = require('../../core/authorization/context');
const { Role } = require('../../models');
const { success } = require('../../utils/response');

router.use(authenticate, resolveContext(), requireAnyPermission(['memberships.manage', 'invitations.manage', 'roles.manage']));

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.scope) where.scope = req.query.scope;
    const roles = await Role.findAll({ where, attributes: ['id', 'key', 'name', 'scope'], order: [['name', 'ASC']] });
    return success(res, { roles });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
