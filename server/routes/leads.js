const router = require('express').Router();
const { search, getById, getAll, getContactDetails } = require('../controllers/leadController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');
const { searchLimiter } = require('../middleware/rateLimiter');

router.use(authenticate, resolveContext());

router.get('/search', searchLimiter, requirePermission('leads.search'), search);
router.get('/contact/:placeId', requirePermission('leads.contact_reveal'), getContactDetails);
router.get('/', requirePermission('leads.search'), getAll);
router.get('/:id', requirePermission('leads.read'), getById);

module.exports = router;
