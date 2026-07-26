const router = require('express').Router();

router.use('/organizations', require('../../modules/organizations/routes'));
router.use('/roles', require('../../modules/roles/routes'));
router.use('/memberships', require('../../modules/memberships/routes'));
router.use('/invitations', require('../../modules/invitations/routes'));
router.use('/sessions', require('../../modules/sessions/routes'));
router.use('/audit', require('../../modules/audit/routes'));
router.use('/notifications', require('../../modules/notifications/routes'));
router.use('/impersonation', require('../../modules/impersonation/routes'));
router.use('/crm', require('../../modules/crm/routes'));
router.use('/public', require('../../modules/public/routes'));
router.use('/billing', require('../../modules/billing/routes'));

module.exports = router;
