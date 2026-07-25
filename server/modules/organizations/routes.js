const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const { resolveContext } = require('../../core/authorization/context');
const { getCurrent } = require('./organizationController');

router.use(authenticate, resolveContext());

router.get('/current', getCurrent);

module.exports = router;
