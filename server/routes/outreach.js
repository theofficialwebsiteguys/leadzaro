const router = require('express').Router();
const { body } = require('express-validator');
const { getActivities, addActivity, archiveActivity, restoreActivity } = require('../controllers/outreachController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');
const { validate } = require('../middleware/validate');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('outreach.read'), getActivities);
router.post('/', requirePermission('outreach.create'), [
  body('leadId').notEmpty().withMessage('leadId required'),
  body('type').isIn(['email', 'call', 'visit', 'message', 'linkedin', 'other']).withMessage('Invalid type'),
], validate, addActivity);
router.post('/:id/archive', requirePermission('outreach.archive'), archiveActivity);
router.post('/:id/restore', requirePermission('outreach.archive'), restoreActivity);
// Deprecated alias: archives instead of hard-deleting (see savedLeads.js).
router.delete('/:id', requirePermission('outreach.archive'), archiveActivity);

module.exports = router;
