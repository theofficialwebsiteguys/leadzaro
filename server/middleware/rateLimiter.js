const rateLimit = require('express-rate-limit');
const { env } = require('../core/config/env');

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// The real limit (20/15min) is a production security control against
// login brute-forcing, not a constraint the test suite should have to
// work around by rationing how many `loginAs` calls a growing test file
// is allowed to make. Every test file shares one Express app instance
// (and therefore one in-memory limiter) across all its own tests, so
// this scales with total test count, not with anything meaningful about
// auth behavior itself — raised only under NODE_ENV=test.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.IS_TEST ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many search requests, please slow down.' },
});

// Public, unauthenticated form submissions (inbound marketing pages) create
// real database records — stricter than the generic API limiter to blunt
// spam/scripted abuse, on top of the honeypot field in the form itself.
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many submissions, please try again later.' },
});

module.exports = {
  rateLimiter, authLimiter, searchLimiter, publicFormLimiter,
};
