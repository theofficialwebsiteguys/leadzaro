const router = require('express').Router();
const { body } = require('express-validator');
const { getActivities, addActivity, deleteActivity } = require('../controllers/outreachController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.use(authenticate);

router.get('/', getActivities);
router.post('/', [
  body('leadId').notEmpty().withMessage('leadId required'),
  body('type').isIn(['email', 'call', 'visit', 'message', 'linkedin', 'other']).withMessage('Invalid type'),
], validate, addActivity);
router.delete('/:id', deleteActivity);

module.exports = router;
