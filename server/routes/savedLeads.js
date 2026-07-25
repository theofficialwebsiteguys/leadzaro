const router = require('express').Router();
const { body } = require('express-validator');
const {
  getSavedLeads, saveLead, updateSavedLead, deleteSavedLead, getSavedLeadDetail, addNote,
} = require('../controllers/savedLeadController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getSavedLeads);
router.post('/', [body('leadData').notEmpty(), body('leadData.name').notEmpty()], validate, saveLead);
router.get('/:id', getSavedLeadDetail);
router.put('/:id', updateSavedLead);
router.delete('/:id', deleteSavedLead);
router.post('/:id/notes', [body('content').notEmpty().withMessage('Note content required')], validate, addNote);

module.exports = router;
