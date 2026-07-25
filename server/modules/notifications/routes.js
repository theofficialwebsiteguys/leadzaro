const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const controller = require('./notificationController');

router.use(authenticate);

router.get('/', controller.list);
router.get('/unread-count', controller.unreadCount);
router.post('/:id/read', controller.markRead);
router.post('/read-all', controller.markAllRead);
router.get('/preferences', controller.getPreferences);
router.put('/preferences', [
  body('category').notEmpty(),
  body('channel').isIn(['in_app', 'email']),
  body('frequency').isIn(['immediate', 'daily', 'weekly', 'muted']),
], validate, controller.setPreference);

module.exports = router;
