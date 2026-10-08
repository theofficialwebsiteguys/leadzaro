'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const controller = require('./integrationController');

// Connecting a registrar account is an administrator action (ADR 0009).
router.use(authenticate, resolveContext(), requireEmployeeMembership(), requirePermission('integrations.manage'));

router.get('/namecheap', controller.getNamecheap);
router.put('/namecheap', controller.saveNamecheap);
router.post('/namecheap/test', controller.testNamecheap);
router.post('/namecheap/sync', controller.syncNamecheap);
router.post('/namecheap/detect-ip', controller.detectIp);
router.delete('/namecheap', controller.disconnectNamecheap);

module.exports = router;
