const bcrypt = require('bcryptjs');
const { signToken } = require('../config/jwt');
const { User, SubscriptionPlan, UserSubscription } = require('../models');

const SALT_ROUNDS = 10;

async function register(data) {
  const { name, email, password, companyName, salespersonType, targetIndustry, serviceArea } = data;

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

  // Assign free trial subscription
  const freePlan = await SubscriptionPlan.findOne({ where: { name: 'Free Trial' } });
  if (freePlan) {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    await UserSubscription.create({
      userId: user.id,
      planId: freePlan.id,
      status: 'trialing',
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnd,
    });
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return { token, user: sanitizeUser(user) };
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

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return { token, user: sanitizeUser(user) };
}

function sanitizeUser(user) {
  const plain = user.get ? user.get({ plain: true }) : user;
  const { passwordHash, ...safe } = plain;
  return safe;
}

module.exports = { register, login, sanitizeUser };
