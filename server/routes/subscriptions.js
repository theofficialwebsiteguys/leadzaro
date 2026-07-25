const router = require('express').Router();
const { getPlans, getCurrentSubscription, upgradePlan } = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');

router.get('/plans', getPlans);
// profile.manage is granted to every seeded role (self-service) —
// viewing/upgrading your own legacy subscription was never admin-gated,
// so this preserves that behavior while still resolving organization
// context (closing the "no active membership" / cross-org gap this
// route previously had no check for at all).
router.get('/current', authenticate, resolveContext(), requirePermission('profile.manage'), getCurrentSubscription);
router.post('/upgrade', authenticate, resolveContext(), requirePermission('profile.manage'), upgradePlan);

module.exports = router;
