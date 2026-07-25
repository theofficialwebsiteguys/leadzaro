const router = require('express').Router();

router.use('/organizations', require('../../modules/organizations/routes'));
router.use('/memberships', require('../../modules/memberships/routes'));
router.use('/invitations', require('../../modules/invitations/routes'));
router.use('/sessions', require('../../modules/sessions/routes'));
router.use('/audit', require('../../modules/audit/routes'));
router.use('/notifications', require('../../modules/notifications/routes'));
router.use('/impersonation', require('../../modules/impersonation/routes'));

module.exports = router;
