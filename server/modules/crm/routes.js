const router = require('express').Router();
const { body, query } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireAnyPermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./opportunityController');
const mergeController = require('./mergeController');
const dashboardController = require('./dashboardController');

router.use(authenticate, resolveContext());

router.get('/dashboard', requirePermission('leads.read'), dashboardController.getSummary);

router.get('/duplicates', requirePermission('crm.manage_pipeline'), mergeController.listDuplicates);
router.get('/merge/preview', requirePermission('crm.manage_pipeline'), [
  query('winnerId').notEmpty(),
  query('loserId').notEmpty(),
], validate, mergeController.preview);
router.post('/merge', requirePermission('crm.manage_pipeline'), [
  body('winnerId').notEmpty(),
  body('loserId').notEmpty(),
], validate, mergeController.merge);
router.post('/opportunities/:id/undo-merge', requirePermission('crm.manage_pipeline'), mergeController.undoMerge);

router.get('/opportunities', requirePermission('leads.read'), controller.list);
router.post('/opportunities', requirePermission('leads.save'), [
  body('leadData').notEmpty(),
  body('leadData.name').notEmpty(),
], validate, controller.create);
router.get('/opportunities/:id', requirePermission('leads.read'), controller.getById);
router.put('/opportunities/:id', requirePermission('crm.manage_pipeline'), [
  body('stage').optional().isString(),
  body('score').optional().isInt({ min: 0, max: 100 }),
  body('scoreReason').optional().isString().isLength({ max: 255 }),
], validate, controller.updateStage);
router.post('/opportunities/:id/recalculate-score', requirePermission('crm.manage_pipeline'), controller.recalculateScore);
router.post('/opportunities/:id/claim', requirePermission('leads.save'), controller.claim);
router.post('/opportunities/:id/assign', requirePermission('leads.assign'), [
  body('userId').notEmpty(),
], validate, controller.assign);
router.post('/opportunities/:id/round-robin-assign', requirePermission('leads.assign'), controller.roundRobinAssign);
router.post('/opportunities/:id/archive', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), controller.archive);
router.post('/opportunities/:id/restore', requireAnyPermission(['leads.archive', 'crm.manage_pipeline']), controller.restore);

module.exports = router;
