const bcrypt = require('bcryptjs');
const { User } = require('../models');

const SALT_ROUNDS = 10;

/**
 * Public self-registration. Only reachable when FEATURE_PUBLIC_REGISTRATION
 * is enabled (enforced by the route/controller) — Phase 1's primary
 * onboarding path is invitation acceptance (see modules/invitations).
 * No subscription/trial is created here; that was the old public-SaaS
 * behavior and is out of scope for the Website Guys operating platform.
 */
async function register(data) {
  const {
    name, email, password, companyName, salespersonType, targetIndustry, serviceArea,
  } = data;

  const existing = await User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    const err = new Error('An account with this email already exists');
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    companyName,
    salespersonType: salespersonType || 'Custom / Other',
    targetIndustry,
    serviceArea,
  });

  return sanitizeUser(user);
}

async function login(email, password) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('Account is deactivated. Please contact support.');
    err.statusCode = 403;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  return user;
}

function sanitizeUser(user) {
  const plain = user.get ? user.get({ plain: true }) : user;
  const { passwordHash, ...safe } = plain;
  return safe;
}

module.exports = {
  register, login, sanitizeUser, SALT_ROUNDS,
};
