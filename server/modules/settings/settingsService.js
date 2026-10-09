'use strict';

const {
  User, Organization, OrganizationMembership, Role, NotificationPreference, AuthSession,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { isSmtpConfigured } = require('../../core/notifications/emailAdapter');
const { categoriesFor } = require('../../core/notifications/catalog');
const { isValidTimeZone } = require('../../core/workspace/timezone');
const stripeService = require('../sales/stripeService');
const channelService = require('../sales/channelService');
const namecheapConnectionService = require('../integrations/namecheapConnectionService');
const { invalid, isEmail, assertNoSecrets } = require('../sales/salesCommon');
const { CATEGORIES, cleanAreaList, searchSettingsOf } = require('../../core/crm/searchCatalog');

/**
 * Settings (ADR 0012). One place for each kind of setting, each stored
 * where the app already reads it:
 * - personal profile: Users.name / phone, OrganizationMembership.title
 * - personal sales preferences: Users.targetIndustry / serviceArea (search
 *   defaults) and Users.preferences (signature, radius, follow-up days)
 * - workspace: the agency Organization (name, contact columns, settings)
 * Credentials are never read or returned here.
 */

const ROLE_SUMMARIES = {
  administrator: 'Everything, including team access, integrations and workspace settings.',
  sales_manager: 'All sales work plus team reports, goals, shared templates, reassigning leads, custom-priced offers and recording manual payments.',
  sales_representative: 'Finding and working leads, outreach, and creating Stripe payment links from the catalog.',
  project_manager: 'Client projects: stages, tasks, requests, meetings, files, publishing and cancellations.',
  designer: 'Client projects: tasks, requests, meetings, files and website editing.',
  advanced_designer: 'Designer access plus publishing and developer tools.',
  developer: 'Client projects plus website publishing and developer tools.',
  support: 'Client projects: tasks, requests, meetings and files.',
  billing: 'Stripe webhook recovery, service plans, SEO entitlements and recording manual payments.',
};

function textField(value, label, max, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw invalid(`${label} is required`);
  if (text.length > max) throw invalid(`${label} must be ${max} characters or fewer`);
  return text || null;
}

function intField(value, label, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}

async function membershipFor(ctx) {
  return OrganizationMembership.findByPk(ctx.authContext.membership.id, {
    include: [{ model: Role, as: 'roles', attributes: ['key', 'name'] }],
  });
}

function workspaceDefaults(org) {
  const s = org.settings || {};
  return {
    timezone: s.timezone || null,
    defaultSearchLocation: s.defaultSearchLocation || null,
    defaultSearchKeywords: s.defaultSearchKeywords || null,
    defaultFollowUpDays: s.defaultFollowUpDays || 2,
    clientGoal: s.clientGoal || 100,
  };
}

const KIT_BILLING = ['one_time', 'monthly', 'yearly'];

function salesKitOf(org) {
  const kit = org.settings?.salesKit || {};
  return {
    pitch: kit.pitch || '',
    services: Array.isArray(kit.services) ? kit.services : [],
    portfolio: Array.isArray(kit.portfolio) ? kit.portfolio : [],
    objections: Array.isArray(kit.objections) ? kit.objections : [],
  };
}

/**
 * The Sales kit (ADR 0013): approved services and prices, portfolio
 * links, the pitch and answers to common objections — shown beside every
 * lead and insertable into messages. Plain facts only; never secrets.
 */
function cleanSalesKit(input) {
  const list = (value, name, max) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw invalid(`${name} must be a list`);
    if (value.length > max) throw invalid(`${name}: at most ${max} entries`);
    return value;
  };
  const pitch = textField(input.pitch, 'Pitch', 2000) || '';
  assertNoSecrets(pitch, 'Pitch');
  const services = list(input.services, 'Services', 20).map((s, i) => {
    const name = textField(s?.name, `Service ${i + 1} name`, 120, { required: true });
    const description = textField(s?.description, `${name} description`, 500) || '';
    let priceCents = null;
    if (s?.priceCents !== undefined && s?.priceCents !== null && s?.priceCents !== '') {
      priceCents = Number(s.priceCents);
      if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000) throw invalid(`${name}: price must be a whole number of cents`);
    }
    const billing = KIT_BILLING.includes(s?.billing) ? s.billing : (priceCents === null ? null : 'one_time');
    assertNoSecrets(description, `${name} description`);
    return {
      name, description, priceCents, billing,
    };
  });
  const portfolio = list(input.portfolio, 'Portfolio links', 20).map((p, i) => {
    const label = textField(p?.label, `Portfolio ${i + 1} label`, 120, { required: true });
    let url = textField(p?.url, `${label} link`, 500, { required: true });
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('.')) throw new Error('no host');
    } catch {
      throw invalid(`${label}: that link doesn’t look valid`);
    }
    return { label, url };
  });
  const objections = list(input.objections, 'Objections', 20).map((o, i) => {
    const objection = textField(o?.objection, `Objection ${i + 1}`, 200, { required: true });
    const response = textField(o?.response, `Answer to “${objection}”`, 1500, { required: true });
    assertNoSecrets(response, 'Objection answer');
    return { objection, response };
  });
  return {
    pitch, services, portfolio, objections,
  };
}

/**
 * Lead search territories and preset searches (ADR 0014). Territories are
 * named lists of areas Google can locate (counties, cities, ZIPs);
 * presets name a set of categories and a territory. Starting points, not
 * restrictions — employees can still search anywhere.
 */
function cleanLeadSearch(input) {
  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const territories = (Array.isArray(input.territories) ? input.territories : []).slice(0, 20).map((t, i) => {
    const name = textField(t?.name, `Territory ${i + 1} name`, 60, { required: true });
    const areas = cleanAreaList(t?.areas);
    if (!areas.length) throw invalid(`${name}: add at least one county, city or ZIP`);
    return { key: slug(t?.key || name) || `territory_${i + 1}`, name, areas };
  });
  const categoryKeys = new Set(CATEGORIES.map((c) => c.key));
  const subKeys = new Set(CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.key)));
  const presets = (Array.isArray(input.presets) ? input.presets : []).slice(0, 20).map((p, i) => {
    const name = textField(p?.name, `Preset ${i + 1} name`, 80, { required: true });
    const categories = (Array.isArray(p?.categories) ? p.categories : []).filter((k) => categoryKeys.has(k));
    const subcategories = (Array.isArray(p?.subcategories) ? p.subcategories : []).filter((k) => subKeys.has(k));
    if (!categories.length && !subcategories.length) throw invalid(`${name}: choose at least one business type`);
    const territory = territories.some((t) => t.key === p?.territory) ? p.territory : null;
    if (!territory) throw invalid(`${name}: choose one of the territories`);
    return {
      key: slug(p?.key || name) || `preset_${i + 1}`, name, categories, subcategories, territory,
    };
  });
  return { territories, presets };
}

// ---------------------------------------------------------------- my account

async function getMe(ctx) {
  const [user, membership, org, sessionCount] = await Promise.all([
    User.findByPk(ctx.userId, { attributes: ['id', 'name', 'email', 'phone', 'emailVerifiedAt', 'createdAt', 'targetIndustry', 'serviceArea', 'preferences'] }),
    membershipFor(ctx),
    Organization.findByPk(ctx.agencyId),
    AuthSession.count({ where: { userId: ctx.userId, revokedAt: null } }).catch(() => null),
  ]);
  const prefs = user.preferences || {};
  const workspace = workspaceDefaults(org);
  return {
    user: {
      id: user.id, name: user.name, email: user.email, phone: user.phone, emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt,
    },
    membership: {
      type: membership.membershipType,
      title: membership.title || null,
      since: membership.createdAt,
      roles: (membership.roles || []).map((r) => ({ key: r.key, name: r.name, summary: ROLE_SUMMARIES[r.key] || null })),
    },
    workspace: { id: org.id, name: org.name },
    salesPreferences: {
      searchKeywords: user.targetIndustry || null,
      searchLocation: user.serviceArea || null,
      searchRadius: prefs.searchRadius || null,
      signature: prefs.signature || null,
      defaultFollowUpDays: prefs.defaultFollowUpDays || null,
    },
    // What actually applies after falling back to the workspace defaults.
    effective: {
      searchKeywords: user.targetIndustry || workspace.defaultSearchKeywords,
      searchLocation: user.serviceArea || workspace.defaultSearchLocation,
      searchRadius: prefs.searchRadius || 10,
      defaultFollowUpDays: prefs.defaultFollowUpDays || workspace.defaultFollowUpDays,
      timezone: workspace.timezone,
      signature: prefs.signature || [user.name, user.phone].filter(Boolean).join('\n'),
    },
    sessions: sessionCount,
  };
}

async function updateProfile(ctx, input) {
  const user = await User.findByPk(ctx.userId);
  const updates = {};
  if (input.name !== undefined) updates.name = textField(input.name, 'Name', 100, { required: true });
  if (input.phone !== undefined) {
    const phone = textField(input.phone, 'Phone', 50);
    if (phone && phone.replace(/\D/g, '').length < 10) throw invalid('Enter a full phone number, including area code.');
    updates.phone = phone;
  }
  await user.update(updates);
  if (input.title !== undefined) {
    const membership = await OrganizationMembership.findByPk(ctx.authContext.membership.id);
    await membership.update({ title: textField(input.title, 'Job title', 100) });
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'settings.profile_updated', targetType: 'User', targetId: ctx.userId, metadata: { fields: Object.keys(input) }, req: ctx.req,
  });
  return getMe(ctx);
}

async function updateSalesPreferences(ctx, input) {
  const user = await User.findByPk(ctx.userId);
  const prefs = { ...(user.preferences || {}) };
  const updates = {};
  if (input.searchKeywords !== undefined) updates.targetIndustry = textField(input.searchKeywords, 'Search keywords', 150);
  if (input.searchLocation !== undefined) updates.serviceArea = textField(input.searchLocation, 'Search location', 200);
  if (input.searchRadius !== undefined) prefs.searchRadius = intField(input.searchRadius, 'Search radius', 1, 50);
  if (input.defaultFollowUpDays !== undefined) prefs.defaultFollowUpDays = intField(input.defaultFollowUpDays, 'Follow-up days', 1, 30);
  if (input.signature !== undefined) {
    const signature = textField(input.signature, 'Signature', 500);
    assertNoSecrets(signature, 'Signature');
    prefs.signature = signature;
  }
  for (const key of Object.keys(prefs)) if (prefs[key] === null) delete prefs[key];
  await user.update({ ...updates, preferences: prefs });
  return getMe(ctx);
}

// ---------------------------------------------------------------- workspace

const COMPANY_FIELDS = {
  name: 255, phone: 50, email: 255, website: 500, addressLine1: 255, city: 100, state: 100, postalCode: 20,
};

async function getWorkspace(ctx) {
  const org = await Organization.findByPk(ctx.agencyId);
  const memberCount = await OrganizationMembership.count({
    where: {
      organizationId: org.id, membershipType: 'employee', status: 'active', deletedAt: null,
    },
  });
  return {
    company: Object.fromEntries(Object.keys(COMPANY_FIELDS).map((k) => [k, org[k] ?? null])),
    defaults: workspaceDefaults(org),
    salesKit: salesKitOf(org),
    leadSearch: searchSettingsOf(org),
    memberCount,
    canEdit: ctx.can('workspace.manage'),
  };
}

async function updateWorkspace(ctx, input) {
  if (!ctx.can('workspace.manage')) throw invalid('Only an administrator can change workspace settings.', 403);
  const org = await Organization.findByPk(ctx.agencyId);
  const updates = {};
  for (const [field, max] of Object.entries(COMPANY_FIELDS)) {
    if (input.company?.[field] === undefined) continue;
    updates[field] = textField(input.company[field], field === 'name' ? 'Company name' : field, max, { required: field === 'name' });
  }
  if (updates.email && !isEmail(updates.email)) throw invalid('The company contact email does not look valid.');
  if (updates.website && !/^https?:\/\//i.test(updates.website)) updates.website = `https://${updates.website}`;

  const settings = { ...(org.settings || {}) };
  const d = input.defaults || {};
  if (d.timezone !== undefined) {
    if (d.timezone && !isValidTimeZone(d.timezone)) throw invalid('Choose a timezone from the list.');
    settings.timezone = d.timezone || null;
  }
  if (d.defaultSearchLocation !== undefined) settings.defaultSearchLocation = textField(d.defaultSearchLocation, 'Default search location', 200);
  if (d.defaultSearchKeywords !== undefined) settings.defaultSearchKeywords = textField(d.defaultSearchKeywords, 'Default search keywords', 150);
  if (d.defaultFollowUpDays !== undefined) settings.defaultFollowUpDays = intField(d.defaultFollowUpDays, 'Default follow-up days', 1, 30);
  if (d.clientGoal !== undefined) settings.clientGoal = intField(d.clientGoal, 'Client goal', 1, 100000);
  if (input.salesKit !== undefined) settings.salesKit = cleanSalesKit(input.salesKit || {});
  if (input.leadSearch !== undefined) settings.leadSearch = input.leadSearch === null ? null : cleanLeadSearch(input.leadSearch);
  for (const key of Object.keys(settings)) if (settings[key] === null) delete settings[key];

  await org.update({ ...updates, settings });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'settings.workspace_updated', targetType: 'Organization', targetId: org.id, metadata: { company: Object.keys(updates), defaults: Object.keys(d), salesKit: input.salesKit !== undefined }, req: ctx.req,
  });
  return getWorkspace(ctx);
}

// ---------------------------------------------------------------- integrations

function googlePlacesConfigured() {
  const key = process.env.GOOGLE_PLACES_API_KEY || '';
  return Boolean(key) && !key.includes('your_google_places') && !key.includes('placeholder');
}

/**
 * One status shape for every connection. Everything comes from stored or
 * cached state — opening Settings never triggers a sync.
 */
async function getIntegrations(ctx) {
  const admin = ctx.can('integrations.manage');
  const [stripe, channels, namecheap] = await Promise.all([
    stripeService.getStatus(),
    channelService.channelStatus(ctx),
    namecheapConnectionService.getStatus(ctx.authContext).catch(() => null),
  ]);

  let stripeState = 'not_connected';
  if (stripe.connected) stripeState = stripe.problem ? 'attention' : (stripe.mode === 'live' ? 'connected' : 'test');
  const stripeCard = {
    key: 'stripe',
    name: 'Stripe',
    scope: 'workspace',
    purpose: 'Payment links, customer checkouts and confirmed payments for sales.',
    state: stripeState,
    account: stripe.account?.name || null,
    mode: stripe.mode,
    detail: stripe.problem
      || (stripe.connected ? `${stripe.mode === 'live' ? 'Live' : stripe.mode === 'test' ? 'Test' : 'Mock'} mode · payments confirmed by ${stripe.webhookSecretConfigured ? 'signed webhooks' : 'nothing yet'}` : 'Not connected — payment links can’t be created.'),
    lastActivityAt: stripe.lastWebhookAt,
    lastActivityLabel: 'Last payment event',
    manage: 'server',
    diagnostics: admin ? {
      webhookPath: stripe.webhookPath, restrictedKey: stripe.restrictedKey, failedWebhooks: stripe.failedWebhooks, automaticTax: stripe.automaticTax, defaultCurrency: stripe.defaultCurrency, accountId: stripe.account?.id || null, accountNote: stripe.accountError,
    } : null,
  };

  let ncState = 'not_connected';
  if (namecheap?.configured) {
    if (namecheap.status === 'connected' && !namecheap.lastError) ncState = 'connected';
    else ncState = 'attention';
  }
  const namecheapCard = {
    key: 'namecheap',
    name: 'Namecheap',
    scope: 'workspace',
    purpose: 'Reads domain status, expiry and renewal settings for the Domains list. Nothing is changed at Namecheap.',
    state: ncState,
    account: namecheap?.accountUserName || null,
    mode: namecheap?.environment || null,
    detail: namecheap?.lastError?.message || (namecheap?.configured ? `Last sync ${namecheap.lastSyncStatus || 'unknown'}` : 'Not connected — domain details are entered by hand.'),
    lastActivityAt: namecheap?.lastSuccessfulSyncAt || null,
    lastActivityLabel: 'Last successful sync',
    manage: admin ? 'in_app' : 'none',
    diagnostics: null,
  };

  const leadSearchCard = {
    key: 'google_places',
    name: 'Google Places (lead search)',
    scope: 'workspace',
    purpose: 'Finds local businesses in Find Leads.',
    state: process.env.DEMO_MODE === 'true' ? 'test' : (googlePlacesConfigured() ? 'connected' : 'not_connected'),
    account: null,
    mode: process.env.DEMO_MODE === 'true' ? 'demo' : null,
    detail: process.env.DEMO_MODE === 'true' ? 'Demo mode — searches return sample businesses.' : (googlePlacesConfigured() ? 'Searches use live Google results.' : 'No API key — Find Leads only offers demo results.'),
    lastActivityAt: null,
    lastActivityLabel: null,
    manage: 'server',
    diagnostics: null,
  };

  const emailCard = {
    key: 'email',
    name: 'Outreach email (SMTP)',
    scope: 'workspace',
    purpose: 'Sends sales emails from Leadzaro and delivers email notifications.',
    state: channels.email.connected ? 'connected' : 'not_connected',
    account: channels.email.from,
    mode: null,
    detail: channels.email.connected
      ? `Shared company sender. Replies go to each person’s own login email${channels.email.replyTo ? ` (yours: ${channels.email.replyTo})` : ''}.`
      : 'Not connected — salespeople send from their own email app and confirm it in Leadzaro. Email notifications are not delivered.',
    lastActivityAt: null,
    lastActivityLabel: null,
    manage: 'server',
    diagnostics: null,
  };

  const smsCard = {
    key: 'twilio',
    name: 'Texting & calling (Twilio)',
    scope: 'workspace',
    purpose: 'Sends texts, receives replies and rings your phone to connect calls.',
    state: channels.sms.connected ? (channels.sms.note ? 'attention' : 'connected') : 'not_connected',
    account: channels.sms.from,
    mode: null,
    detail: channels.sms.connected ? (channels.sms.note || 'Shared company number.') : 'Not connected — texts and calls use your own phone.',
    lastActivityAt: null,
    lastActivityLabel: null,
    manage: 'server',
    personal: {
      label: 'Your phone for click-to-call', value: channels.call.yourPhone, needed: channels.call.needsYourPhone,
    },
    diagnostics: null,
  };

  return {
    canManage: admin,
    items: [stripeCard, emailCard, smsCard, namecheapCard, leadSearchCard],
    setupSteps: admin ? {
      stripe: {
        env: ['STRIPE_PROVIDER=live', 'STRIPE_SECRET_KEY=rk_test_… (then rk_live_…)', 'STRIPE_WEBHOOK_SECRET=whsec_…'],
        permissions: 'Restricted key — Write: Customers, Checkout Sessions, Payment Links, Prices, Products, Customer portal. Read: Invoices, Subscriptions. Optional Read: Account.',
        events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded'],
        webhookPath: stripe.webhookPath,
      },
      email: { env: ['EMAIL_PROVIDER=smtp', 'SMTP_HOST, SMTP_PORT, SMTP_SECURE', 'SMTP_USER, SMTP_PASSWORD', 'SALES_EMAIL_FROM="Company <sales@yourdomain>"'] },
      twilio: { env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'PUBLIC_API_BASE_URL=https://your-api-host'], inboundPath: '/api/v1/sales/webhooks/twilio/inbound' },
      google_places: { env: ['GOOGLE_PLACES_API_KEY'] },
    } : null,
  };
}

// ---------------------------------------------------------------- notifications

async function getNotifications(ctx) {
  const categories = categoriesFor(ctx.authContext.permissionKeys);
  const prefs = await NotificationPreference.findAll({ where: { userId: ctx.userId } });
  const state = (types, channel) => !types.every((type) => prefs.some((p) => p.category === type && p.channel === channel && p.frequency === 'muted'));
  return {
    emailAvailable: isSmtpConfigured(),
    emailTo: (await User.findByPk(ctx.userId, { attributes: ['email'] })).email,
    categories: categories.map((c) => ({
      key: c.key,
      group: c.group,
      label: c.label,
      channels: c.channels,
      inApp: state(c.types, 'in_app'),
      email: c.channels.includes('email') ? state(c.types, 'email') : null,
    })),
  };
}

async function updateNotifications(ctx, input) {
  const categories = categoriesFor(ctx.authContext.permissionKeys);
  const changes = Array.isArray(input.changes) ? input.changes.slice(0, 50) : [];
  for (const change of changes) {
    const category = categories.find((c) => c.key === change.key);
    if (!category) throw invalid('Unknown notification setting');
    for (const channel of ['in_app', 'email']) {
      const field = channel === 'in_app' ? 'inApp' : 'email';
      if (typeof change[field] !== 'boolean' || !category.channels.includes(channel)) continue;
      for (const type of category.types) {
        // eslint-disable-next-line no-await-in-loop
        const [pref] = await NotificationPreference.findOrCreate({
          where: { userId: ctx.userId, category: type, channel },
          defaults: { userId: ctx.userId, category: type, channel, frequency: change[field] ? 'immediate' : 'muted' },
        });
        // eslint-disable-next-line no-await-in-loop
        await pref.update({ frequency: change[field] ? 'immediate' : 'muted' });
      }
    }
  }
  return getNotifications(ctx);
}

module.exports = {
  ROLE_SUMMARIES,
  getMe,
  updateProfile,
  updateSalesPreferences,
  getWorkspace,
  updateWorkspace,
  getIntegrations,
  getNotifications,
  updateNotifications,
  workspaceDefaults,
};
