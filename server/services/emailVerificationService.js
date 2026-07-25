const { User, EmailVerificationToken } = require('../models');
const { generateRawToken, hashToken } = require('../core/security/tokens');
const { getEmailAdapter } = require('../core/notifications/emailAdapter');
const { env } = require('../core/config/env');

async function requestEmailVerification(user) {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await EmailVerificationToken.create({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt });

  const link = `${env.APP_BASE_URL}/verify-email?token=${rawToken}`;
  await getEmailAdapter().send({
    to: user.email,
    subject: 'Verify your email address',
    text: `Confirm your email address: ${link}\nThis link expires in ${env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.`,
  });
}

async function confirmEmailVerification(rawToken) {
  const record = await EmailVerificationToken.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    const err = new Error('This verification link is invalid or has expired');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findByPk(record.userId);
  if (!user) {
    const err = new Error('This verification link is invalid or has expired');
    err.statusCode = 400;
    throw err;
  }

  await user.update({ emailVerifiedAt: new Date() });
  await record.update({ usedAt: new Date() });
  return user;
}

module.exports = { requestEmailVerification, confirmEmailVerification };
