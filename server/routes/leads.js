const router = require('express').Router();
const { search, getById, getAll, getContactDetails } = require('../controllers/leadController');
const { authenticate } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimiter');

router.use(authenticate);

router.get('/search', searchLimiter, search);
router.get('/contact/:placeId', getContactDetails);
router.get('/', getAll);
router.get('/:id', getById);

module.exports = router;
