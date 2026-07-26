require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { env } = require('./core/config/env');
const { requestId } = require('./core/observability/requestId');
const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const savedLeadRoutes = require('./routes/savedLeads');
const outreachRoutes = require('./routes/outreach');
const dashboardRoutes = require('./routes/dashboard');
const subscriptionRoutes = require('./routes/subscriptions');
const v1Routes = require('./routes/v1');
const { handleStripeWebhook } = require('./modules/billing/webhookController');

const app = express();

app.set('trust proxy', 1);

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

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

app.use(errorHandler);

module.exports = app;
