const { register, login, sanitizeUser } = require('../services/authService');
const { success, created, error } = require('../utils/response');
const { User, UserSubscription, SubscriptionPlan } = require('../models');
const bcrypt = require('bcryptjs');

async function registerUser(req, res, next) {
  try {
    const result = await register(req.body);
    return created(res, result, 'Account created successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function loginUser(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);
    return success(res, result, 'Login successful');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
      include: [
        {
          model: UserSubscription,
          as: 'subscription',
          include: [{ model: SubscriptionPlan, as: 'plan' }],
        },
      ],
    });
    return success(res, { user });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, companyName, salespersonType, targetIndustry, serviceArea } = req.body;

    await req.user.update({ name, companyName, salespersonType, targetIndustry, serviceArea });

    const updated = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
    });

    return success(res, { user: sanitizeUser(updated) }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findByPk(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!valid) {
      return error(res, 'Current password is incorrect', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await user.update({ passwordHash });

    return success(res, {}, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = { registerUser, loginUser, getMe, updateProfile, changePassword };
