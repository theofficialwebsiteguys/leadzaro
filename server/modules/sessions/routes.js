const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const controller = require('./sessionController');

router.use(authenticate);

router.get('/', controller.listMine);
router.delete('/:id', controller.revokeMine);

// Admin: revoke all sessions for another member of the caller's active
// organization. Needs org context to enforce same-organization scope.
router.delete('/users/:userId', resolveContext(), requirePermission('sessions.manage_others'), controller.revokeAllForUser);

module.exports = router;
