const bcrypt = require('bcryptjs');
const { User, PasswordResetToken } = require('../models');
const { generateRawToken, hashToken } = require('../core/security/tokens');
const { getEmailAdapter } = require('../core/notifications/emailAdapter');
const { env } = require('../core/config/env');

// Always resolves without indicating whether the email exists, to avoid
// account enumeration through response-timing/content differences.
async function requestPasswordReset(email) {
  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) return;

  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  await PasswordResetToken.create({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt });

  const link = `${env.APP_BASE_URL}/reset-password?token=${rawToken}`;
  await getEmailAdapter().send({
    to: user.email,
    subject: 'Reset your Leadzaro password',
    text: `Reset your password: ${link}\nThis link expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
  });
}

async function confirmPasswordReset(rawToken, newPassword) {
  const record = await PasswordResetToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    const err = new Error('This password reset link is invalid or has expired');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findByPk(record.userId);
  if (!user) {
    const err = new Error('This password reset link is invalid or has expired');
    err.statusCode = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await user.update({ passwordHash });
  await record.update({ usedAt: new Date() });
  return user;
}

module.exports = { requestPasswordReset, confirmPasswordReset };
