'use strict';

const { Op } = require('sequelize');
const {
  MessageTemplate, Opportunity, Organization, Contact, User, PaymentLinkRequest,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { invalid, assertNoSecrets } = require('./salesCommon');

/**
 * Message templates (ADR 0011): shared ones are managed by managers,
 * personal ones by their owner. Rendering only fills placeholders with
 * facts Leadzaro actually has — anything unknown stays visible as an
 * unresolved {{placeholder}} and blocks sending until it is edited.
 */

const PLACEHOLDERS = {
  business_name: 'Business name',
  contact_name: 'Contact’s full name',
  contact_first_name: 'Contact’s first name',
  website: 'Business website',
  city: 'Business city',
  my_name: 'Your name',
  my_first_name: 'Your first name',
  my_email: 'Your email',
  my_phone: 'Your phone',
  my_signature: 'Your email signature (Settings → Sales)',
  my_company: 'Our company name',
  payment_link: 'The open payment link',
  meeting_time: 'Meeting time (always typed in)',
  their_need: 'Their need, from the lead’s qualification',
  portfolio_link: 'First portfolio link in the Sales kit (Settings → Sales kit & goals)',
  services_list: 'Approved services and prices from the Sales kit',
};

const BILLING_WORDS = { one_time: 'one-time', monthly: '/month', yearly: '/year' };

function serviceLine(service) {
  const price = Number.isInteger(service.priceCents)
    ? ` — ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: service.priceCents % 100 ? 2 : 0 }).format(service.priceCents / 100)}${service.billing === 'one_time' ? ' one-time' : BILLING_WORDS[service.billing] || ''}`
    : '';
  return `• ${service.name}${price}`;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

function unresolvedIn(...texts) {
  const found = new Set();
  for (const text of texts) {
    for (const match of String(text || '').matchAll(PLACEHOLDER_PATTERN)) found.add(match[1]);
    if (/\{\{|\}\}/.test(String(text || '').replace(PLACEHOLDER_PATTERN, ''))) found.add('(incomplete placeholder)');
  }
  return [...found];
}

function canEdit(ctx, template) {
  if (template.scope === 'shared') return ctx.can('templates.manage_shared');
  return template.ownerUserId === ctx.userId;
}

function present(ctx, template) {
  return { ...template.toJSON(), canEdit: canEdit(ctx, template) };
}

async function list(ctx, { channel, category, includeArchived } = {}) {
  const where = {
    agencyOrganizationId: ctx.agencyId,
    [Op.or]: [{ scope: 'shared' }, { scope: 'personal', ownerUserId: ctx.userId }],
  };
  if (!includeArchived) where.archivedAt = null;
  if (channel) where.channel = channel;
  if (category) where.category = category;
  const templates = await MessageTemplate.findAll({ where, order: [['scope', 'DESC'], ['category', 'ASC'], ['name', 'ASC']] });
  return templates.map((t) => present(ctx, t));
}

function clean(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    out.name = String(input.name || '').trim().slice(0, 150);
    if (!out.name) throw invalid('Give the template a name');
  }
  if (!partial || input.channel !== undefined) {
    if (!MessageTemplate.CHANNELS.includes(input.channel)) throw invalid('Choose email, text or call script');
    out.channel = input.channel;
  }
  if (!partial || input.category !== undefined) {
    out.category = MessageTemplate.CATEGORIES.includes(input.category) ? input.category : 'other';
  }
  if (input.subject !== undefined) out.subject = String(input.subject || '').trim().slice(0, 300) || null;
  if (!partial || input.body !== undefined) {
    out.body = String(input.body || '').trim();
    if (!out.body) throw invalid('The template needs a message');
    if (out.body.length > 10000) throw invalid('Templates are limited to 10,000 characters');
  }
  const unknown = unresolvedIn(out.subject, out.body).filter((key) => !PLACEHOLDERS[key]);
  if (unknown.length) throw invalid(`Unknown placeholder${unknown.length === 1 ? '' : 's'}: ${unknown.map((k) => `{{${k}}}`).join(', ')}. Available: ${Object.keys(PLACEHOLDERS).map((k) => `{{${k}}}`).join(', ')}`);
  assertNoSecrets(out.body, 'Template');
  return out;
}

async function create(ctx, input) {
  const scope = input.scope === 'shared' ? 'shared' : 'personal';
  if (scope === 'shared' && !ctx.can('templates.manage_shared')) throw invalid('Only managers can create shared templates — save it as a personal template instead.', 403);
  const template = await MessageTemplate.create({
    ...clean(input),
    agencyOrganizationId: ctx.agencyId,
    scope,
    ownerUserId: scope === 'personal' ? ctx.userId : null,
    createdByUserId: ctx.userId,
    updatedByUserId: ctx.userId,
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'template.created', targetType: 'MessageTemplate', targetId: template.id, metadata: { scope }, req: ctx.req,
  });
  return present(ctx, template);
}

async function load(ctx, id) {
  const template = await MessageTemplate.findOne({ where: { id, agencyOrganizationId: ctx.agencyId } });
  if (!template || (template.scope === 'personal' && template.ownerUserId !== ctx.userId)) throw invalid('Template not found', 404);
  return template;
}

async function update(ctx, id, input) {
  const template = await load(ctx, id);
  if (!canEdit(ctx, template)) throw invalid('Only managers can change shared templates.', 403);
  const fields = clean(input, { partial: true });
  if (input.archived !== undefined) fields.archivedAt = input.archived ? new Date() : null;
  await template.update({ ...fields, updatedByUserId: ctx.userId });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: input.archived ? 'template.archived' : 'template.updated', targetType: 'MessageTemplate', targetId: template.id, req: ctx.req,
  });
  return present(ctx, template);
}

/** Saves a copy of a shared template as the caller's own personal template. */
async function copyToPersonal(ctx, id) {
  const source = await load(ctx, id);
  return create(ctx, {
    scope: 'personal', name: `${source.name} (my copy)`.slice(0, 150), channel: source.channel, category: source.category, subject: source.subject, body: source.body,
  });
}

async function valuesFor(ctx, opportunityId, { contactId, paymentRequestId } = {}) {
  const values = {};
  const user = await User.findByPk(ctx.userId, { attributes: ['name', 'email', 'phone', 'preferences'] });
  if (user?.name) {
    values.my_name = user.name;
    [values.my_first_name] = user.name.split(' ');
  }
  if (user?.email) values.my_email = user.email;
  if (user?.phone) values.my_phone = user.phone;
  // A signature set in Settings, otherwise name and phone (ADR 0012).
  const signature = String(user?.preferences?.signature || '').trim() || [user?.name, user?.phone].filter(Boolean).join('\n');
  if (signature) values.my_signature = signature;
  if (ctx.agencyName) values.my_company = ctx.agencyName;
  const kit = ctx.authContext?.organization?.settings?.salesKit || {};
  if (Array.isArray(kit.portfolio) && kit.portfolio[0]?.url) values.portfolio_link = kit.portfolio[0].url;
  if (Array.isArray(kit.services) && kit.services.length) values.services_list = kit.services.map(serviceLine).join('\n');
  if (!opportunityId) return values;

  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  const organization = await Organization.findByPk(opportunity.organizationId);
  values.business_name = organization.name;
  if (opportunity.qualNeed) values.their_need = opportunity.qualNeed;
  if (organization.website) values.website = organization.website;
  if (organization.city) values.city = organization.city;
  const contact = contactId
    ? await Contact.findOne({ where: { id: contactId, organizationId: organization.id, deletedAt: null } })
    : await Contact.findOne({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] });
  if (contact?.name) {
    values.contact_name = contact.name;
    [values.contact_first_name] = contact.name.split(' ');
  }
  const request = paymentRequestId
    ? await PaymentLinkRequest.findOne({ where: { id: paymentRequestId, opportunityId } })
    : await PaymentLinkRequest.findOne({ where: { opportunityId, status: ['created', 'sent'] }, order: [['createdAt', 'DESC']] });
  if (request?.stripePaymentLinkUrl && ['created', 'sent'].includes(request.status)) {
    values.payment_link = request.stripePaymentLinkUrl;
    values.__paymentRequestId = request.id;
  }
  return values;
}

function fill(text, values) {
  return String(text || '').replace(PLACEHOLDER_PATTERN, (whole, key) => (key !== 'meeting_time' && values[key] ? values[key] : whole));
}

/** Fills a template (or free text) for one lead. Unknown facts stay as {{placeholders}}. */
async function render(ctx, opportunityId, input) {
  let subject = input.subject;
  let body = input.body;
  let template = null;
  if (input.templateId) {
    template = await load(ctx, input.templateId);
    subject = template.subject;
    body = template.body;
  }
  const values = await valuesFor(ctx, opportunityId, input);
  const renderedSubject = subject ? fill(subject, values) : null;
  const renderedBody = fill(body, values);
  return {
    templateId: template?.id || null,
    channel: template?.channel || input.channel || null,
    subject: renderedSubject,
    body: renderedBody,
    unresolved: unresolvedIn(renderedSubject, renderedBody),
    paymentRequestId: values.__paymentRequestId || null,
  };
}

module.exports = {
  PLACEHOLDERS, list, create, update, copyToPersonal, render, unresolvedIn,
};
