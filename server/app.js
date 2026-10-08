require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { env } = require('./core/config/env');
const { requestId } = require('./core/observability/requestId');
const { rateLimiter, fileContentLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const savedLeadRoutes = require('./routes/savedLeads');
const outreachRoutes = require('./routes/outreach');
const dashboardRoutes = require('./routes/dashboard');
const subscriptionRoutes = require('./routes/subscriptions');
const v1Routes = require('./routes/v1');
const { handleStripeWebhook } = require('./modules/billing/webhookController');
const { serveSignedFile } = require('./modules/files/fileContentController');

const app = express();

app.set('trust proxy', 1);

// Behind Heroku's router TLS ends at the edge; send plain-http visitors to https.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.secure || req.path === '/api/health') return next();
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
}));

// Stripe webhook signature verification needs the exact raw bytes it
// signed — mounted here, before the global JSON body parser below, with
// its own express.raw() so req.body stays an unparsed Buffer for this
// one route only. No auth: the signature itself is the authorization.
app.post('/api/v1/billing/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestId());

// Signed file links (thumbnails, logos, downloads) — mounted ahead of the
// general API limiter with a separate, more generous one: a single media
// grid can request dozens of images, which would otherwise exhaust the
// 200-request window that protects the JSON API. No auth header: the
// signed, expiring token in the URL is the authorization.
app.get('/api/v1/files/content', fileContentLimiter, serveSignedFile);

app.use('/api/', rateLimiter);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Leadzaro API is running', timestamp: new Date().toISOString() });
});

// Legacy (pre-organization) routes: kept operational during migration,
// delegating internally to organization-aware services where applicable.
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/saved-leads', savedLeadRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

// Phase 1+ versioned surface: organizations, memberships, invitations,
// sessions, audit, notifications, and any new foundation endpoints.
// Auth is mounted at both prefixes — it predates versioning but every new
// Phase 1 action on it (refresh, logout, password reset, email
// verification) is meant to be reached through /api/v1 going forward.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', v1Routes);

// Production: this same app serves the built Angular frontend, so the
// browser talks to one origin — relative /api calls, signed file links and
// the first-party session cookie all work with no cross-site setup.
const FRONTEND_DIR = path.resolve(__dirname, '..', 'dist', 'leadzaro', 'browser');
if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      // Hashed bundles can be cached forever; anything else is revalidated.
      if (/-[0-9A-Z]{8}\.(js|css)$/.test(path.basename(filePath))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

app.use(errorHandler);

module.exports = app;
