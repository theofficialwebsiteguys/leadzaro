'use strict';

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { requireUuidParams } = require('../../middleware/uuidParams');
const controller = require('./domainController');

requireUuidParams(router, ['domainId', 'planId', 'clientId', 'expenseId']);

// Registrar data, costs and access details are agency-internal (ADR 0009).
router.use(authenticate, resolveContext(), requireEmployeeMembership());

const view = requirePermission('projects.view');
const manage = requirePermission('projects.manage');

// The read-only Domains list and domain pages (ADR 0010).
const domainsView = requirePermission('domains.view');

router.get('/inventory', domainsView, controller.inventory);

router.get('/connection', view, controller.connection);
router.get('/renewals', view, controller.renewals);
router.get('/review', view, controller.review);
// Can trigger a (rate-limited) Namecheap lookup, so only for people who can save clients.
router.get('/lookup', manage, controller.lookup);

router.get('/hosting-plans', view, controller.listPlans);
router.post('/hosting-plans', manage, controller.createPlan);
router.patch('/hosting-plans/:planId', manage, controller.updatePlan);
router.put('/hosting-plans/:planId/clients/:clientId', manage, controller.setPlanClient);
router.delete('/hosting-plans/:planId/clients/:clientId', manage, controller.removePlanClient);
router.get('/hosting-plans/:planId/expenses', manage, controller.listPlanExpenses);
router.post('/hosting-plans/:planId/expenses', manage, controller.addPlanExpense);

router.delete('/expenses/:expenseId', manage, controller.deleteExpense);

router.get('/:domainId', domainsView, controller.detail);
router.post('/:domainId/refresh', domainsView, controller.refresh);

router.patch('/:domainId', manage, controller.updateDomain);
router.post('/:domainId/ignore', manage, controller.ignore);
router.post('/:domainId/unignore', manage, controller.unignore);
router.post('/:domainId/link', manage, controller.link);
router.post('/:domainId/create-client', manage, controller.createClient);
router.post('/:domainId/check', manage, controller.checkAgain);
router.get('/:domainId/expenses', manage, controller.listDomainExpenses);
router.post('/:domainId/expenses', manage, controller.addDomainExpense);

module.exports = router;
