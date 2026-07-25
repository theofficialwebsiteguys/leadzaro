const router = require('express').Router();
const { getDashboard } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { resolveContext, requirePermission } = require('../core/authorization/context');

router.get('/', authenticate, resolveContext(), requirePermission('dashboard.view'), getDashboard);

module.exports = router;
