const router = require('express').Router();
const {
  search, searchOptions, guidedSearch, discoverEmail, getById, getAll, getContactDetails, getFullDetails, getMapImage,
} = require('../controllers/leadController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');
const { searchLimiter, discoveryLimiter } = require('../middleware/rateLimiter');

router.use(authenticate, resolveContext());

router.get('/search', searchLimiter, requirePermission('leads.search'), search);
router.get('/search-options', requirePermission('leads.search'), searchOptions);
router.post('/search/guided', searchLimiter, requirePermission('leads.search'), guidedSearch);
router.post('/discover-email', discoveryLimiter, requirePermission('leads.search'), discoverEmail);
router.get('/contact/:placeId', requirePermission('leads.contact_reveal'), getContactDetails);
router.get('/details/:placeId', searchLimiter, requirePermission('leads.contact_reveal'), getFullDetails);
router.get('/map', searchLimiter, requirePermission('leads.search'), getMapImage);
router.get('/', requirePermission('leads.search'), getAll);
router.get('/:id', requirePermission('leads.read'), getById);

module.exports = router;
