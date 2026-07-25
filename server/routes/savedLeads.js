const router = require('express').Router();
const { body } = require('express-validator');
const {
  getSavedLeads, saveLead, updateSavedLead, archiveSavedLead, restoreSavedLead, getSavedLeadDetail, addNote,
} = require('../controllers/savedLeadController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');
const { validate } = require('../middleware/validate');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('leads.read'), getSavedLeads);
router.post('/', requirePermission('leads.save'), [body('leadData').notEmpty(), body('leadData.name').notEmpty()], validate, saveLead);
router.get('/:id', requirePermission('leads.read'), getSavedLeadDetail);
router.put('/:id', requirePermission('leads.update'), updateSavedLead);
router.post('/:id/archive', requirePermission('leads.archive'), archiveSavedLead);
router.post('/:id/restore', requirePermission('leads.archive'), restoreSavedLead);
// Deprecated alias: previously a hard delete, now archives (never
// permanently destroys data). Kept so any pre-Phase-1 frontend build
// still calling DELETE degrades safely rather than breaking.
router.delete('/:id', requirePermission('leads.archive'), archiveSavedLead);
router.post('/:id/notes', requirePermission('notes.create'), [body('content').notEmpty().withMessage('Note content required')], validate, addNote);

module.exports = router;
