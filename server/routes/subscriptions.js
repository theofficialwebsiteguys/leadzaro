const router = require('express').Router();
const { getPlans, getCurrentSubscription, upgradePlan } = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/auth');

router.get('/plans', getPlans);
router.get('/current', authenticate, getCurrentSubscription);
router.post('/upgrade', authenticate, upgradePlan);

module.exports = router;
