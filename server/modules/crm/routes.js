const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireAnyPermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./opportunityController');

router.use(authenticate, resolveContext());

router.get('/opportunities', requirePermission('leads.read'), controller.list);
router.post('/opportunities', requirePermission('leads.save'), [
  body('leadData').notEmpty(),
  body('leadData.name').notEmpty(),
], validate, controller.create);
router.get('/opportunities/:id', requirePermission('leads.read'), controller.getById);
router.put('/opportunities/:id', requirePermission('crm.manage_pipeline'), controller.updateStage);
router.post('/opportunities/:id/claim', requirePermission('leads.save'), controller.claim);
router.post('/opportunities/:id/assign', requirePermission('leads.assign'), [
  body('userId').notEmpty(),
], validate, controller.assign);
router.post('/opportunities/:id/round-robin-assign', requirePermission('leads.assign'), controller.roundRobinAssign);
router.post('/opportunities/:id/archive', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), controller.archive);
router.post('/opportunities/:id/restore', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), controller.restore);

module.exports = router;
