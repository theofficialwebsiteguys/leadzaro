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

const fileContentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many file requests, please try again later.' },
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

// Phase 7 (current-phase-plan.md § 2e, review finding #3): a separate
// instance from publicFormLimiter above, not a reuse of it. That
// limiter is keyed by IP alone and was built for a single tenant's own
// marketing pages (/inbound-leads); this one serves potentially
// thousands of different client websites through one route pattern —
// keying by IP alone would let one shared office/NAT/coffee-shop IP
// submitting to Client A's contact form exhaust the same budget as
// Client B's, an unrelated tenant. Keying by IP + websiteId keeps each
// website's own budget independent.
const publicWebsiteFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.params.websiteId}`,
  message: { success: false, message: 'Too many submissions, please try again later.' },
});

// Materially higher budget than publicWebsiteFormLimiter (review
// finding #3) — normal browsing generates many events per session (a
// page view plus several scroll/click events per page, across several
// pages), and a form-submission-sized budget would silently break
// analytics for real, non-abusive visitors from day one.
const publicAnalyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.params.websiteId}`,
  message: { success: false, message: 'Too many events, please try again later.' },
});

// Email discovery (ADR 0014) fetches businesses' public websites; each call
// is bounded server-side, this caps how many a person can start per minute.
const discoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many email checks at once — wait a minute and try again.' },
});

module.exports = {
  rateLimiter, authLimiter, searchLimiter, publicFormLimiter, publicWebsiteFormLimiter, publicAnalyticsLimiter, fileContentLimiter, discoveryLimiter,
};
