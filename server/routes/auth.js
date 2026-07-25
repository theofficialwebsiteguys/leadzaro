const router = require('express').Router();
const { body } = require('express-validator');
const {
  registerUser, loginUser, refreshSession, logoutUser, getMe, updateProfile, changePassword,
  requestPasswordResetHandler, confirmPasswordResetHandler,
  requestEmailVerificationHandler, confirmEmailVerificationHandler,
} = require('../controllers/authController');
const { authenticate, blockDuringImpersonation } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

const SALESPERSON_TYPES = [
  'Website Developer', 'Marketing Agency', 'Roofing Company', 'Real Estate Agent',
  'Insurance Agent', 'Local Service Business', 'Cannabis Sales', 'Custom / Other',
];

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('salespersonType').optional().isIn(SALESPERSON_TYPES),
  body('companyName').optional().trim().isLength({ max: 150 }),
];

const loginRules = [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

router.post('/register', authLimiter, registerRules, validate, registerUser);
router.post('/login', authLimiter, loginRules, validate, loginUser);
router.post('/refresh', refreshSession);
router.post('/logout', logoutUser);
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/password', authenticate, blockDuringImpersonation, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], validate, changePassword);

router.post('/password-reset/request', authLimiter, [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
], validate, requestPasswordResetHandler);
router.post('/password-reset/confirm', authLimiter, [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], validate, confirmPasswordResetHandler);

router.post('/email-verification/request', authenticate, requestEmailVerificationHandler);
router.post('/email-verification/confirm', [
  body('token').notEmpty(),
], validate, confirmEmailVerificationHandler);

module.exports = router;
