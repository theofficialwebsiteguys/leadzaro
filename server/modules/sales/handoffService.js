'use strict';

const {
  Opportunity, Organization, Contact, LeadNote, PaymentLinkRequest, SalesPayment, SalesHandoff, ConversionAttempt, User,
} = require('../../models');
const {
  listClientProfilesForRequester, listClientNotesForRequester, findProjectByConversionAttemptIdSystemLevel,
} = require('../../core/authorization/clientVisibleModels');
const { recordAudit } = require('../../core/audit/auditService');
const { triggerClientInvitationIfNew } = require('../billing/clientInvitationService');
const { ensureProjectForConversion } = require('../projects/projectService');
const clientService = require('../clients/clientService');
const noteService = require('../notes/noteService');
const {
  invalid, assertNoSecrets, registrableDomain, formatMoney, systemAuthContext,
} = require('./salesCommon');

/**
 * The guided sale → client handoff (ADR 0011). Prepared automatically the
 * moment a sale is paid, then reviewed and completed by the salesperson.
 * Missing details become onboarding items, never blockers, and a failure
 * after payment leaves a retryable `failed` state instead of a lost sale.
 */

const ACCESS_STATES = ['unknown', 'client_has', 'we_have', 'needs_setup', 'not_applicable'];
const ACCESS_LABELS = {
  unknown: 'Not asked yet', client_has: 'Client has access', we_have: 'We have access', needs_setup: 'Needs to be set up', not_applicable: 'Not applicable',
};
const INTERVAL_TO_FREQUENCY = { month: 'monthly', year: 'annually' };

function contactsSnapshot(contacts) {
  return contacts.map((c) => ({
    name: c.name, title: c.title || null, email: c.email || null, phone: c.phone || null, isPrimary: Boolean(c.isPrimary),
  }));
}

async function buildInitialData(opportunity) {
  const organization = await Organization.findByPk(opportunity.organizationId);
  const contacts = await Contact.findAll({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] });
  const request = await PaymentLinkRequest.findOne({ where: { opportunityId: opportunity.id, status: 'paid' }, order: [['paidAt', 'DESC']] });
  const payment = await SalesPayment.findOne({ where: { opportunityId: opportunity.id, kind: 'initial' }, order: [['paidAt', 'ASC']] });
  const notes = await LeadNote.findAll({ where: { opportunityId: opportunity.id }, order: [['createdAt', 'DESC']], limit: 5 });
  const owner = opportunity.creditedUserId || opportunity.assignedToUserId;
  const ownerUser = owner ? await User.findByPk(owner, { attributes: ['id', 'name'] }) : null;

  return {
    businessName: organization.name,
    website: organization.website || null,
    domain: registrableDomain(organization.website),
    phone: organization.phone || null,
    email: organization.email || null,
    address: {
      line1: organization.addressLine1 || null, city: organization.city || null, state: organization.state || null, postalCode: organization.postalCode || null,
    },
    contacts: contactsSnapshot(contacts),
    agreedServices: (request?.lineItems || []).map((item) => item.name).filter(Boolean),
    pricing: request ? {
      currency: request.currency,
      initialAmountCents: request.initialAmountCents,
      recurringAmountCents: request.recurringAmountCents,
      recurringInterval: request.recurringInterval,
    } : null,
    payment: payment ? {
      source: payment.source, amountCents: payment.amountCents, currency: payment.currency, paidAt: payment.paidAt,
      paymentRequestId: request?.id || null, stripeCustomerId: payment.stripeCustomerId, stripeSubscriptionId: payment.stripeSubscriptionId,
    } : null,
    // Notes that trip the secrets check are left out rather than copied into the client record.
    salesNotes: notes.map((n) => n.content).filter((text) => {
      try { assertNoSecrets(text); return true; } catch { return false; }
    }).reverse().join('\n\n').slice(0, 4000),
    promisedWork: '',
    targetDates: { kickoff: null, launch: null },
    registrarAccess: 'unknown',
    hostingAccess: 'unknown',
    socialLinks: {
      facebook: '', instagram: '', linkedin: '', google: '',
    },
    checklist: { logo: false, photos: false, content: false },
    ownerUserId: ownerUser?.id || null,
    ownerName: ownerUser?.name || null,
  };
}

function computeItems(data) {
  const contacts = data.contacts || [];
  const hasEmail = Boolean(data.email || contacts.some((c) => c.email));
  const hasPhone = Boolean(data.phone || contacts.some((c) => c.phone));
  const social = Object.values(data.socialLinks || {}).some(Boolean);
  const item = (key, label, essential, done, hint) => ({
    key, label, essential, done: Boolean(done), hint,
  });
  return [
    item('contact_email', 'Client contact email', true, hasEmail, 'Add it on the lead’s contacts.'),
    item('contact_phone', 'Client contact phone', true, hasPhone, 'Add it on the lead’s contacts.'),
    item('agreed_services', 'Agreed services', true, (data.agreedServices || []).length, 'List what was sold.'),
    item('website_domain', 'Website or domain', true, data.website || data.domain || data.registrarAccess === 'not_applicable', 'Their current site/domain, or mark registrar access “Not applicable” if they have none.'),
    item('registrar_access', 'Domain registrar access status', true, data.registrarAccess && data.registrarAccess !== 'unknown', 'Who can log in to the registrar — never the password itself.'),
    item('target_launch', 'Target launch date', true, data.targetDates?.launch, 'When the client expects to go live.'),
    item('hosting_access', 'Hosting access status', false, data.hostingAccess && data.hostingAccess !== 'unknown', 'Who can log in to hosting, if any.'),
    item('promised_work', 'Promised work and extras', false, data.promisedWork, 'Anything promised during the sale.'),
    item('social_links', 'Social profiles', false, social, 'Facebook, Instagram, LinkedIn, Google profile.'),
    item('logo', 'Logo and brand files', false, data.checklist?.logo, 'Upload to the client’s Media tab.'),
    item('photos', 'Photos', false, data.checklist?.photos, 'Upload to the client’s Media tab.'),
    item('content', 'Website text / content', false, data.checklist?.content, 'Collected later during onboarding.'),
  ];
}

function statusFor(handoff, items) {
  if (handoff.status === 'complete') return 'complete';
  return items.some((i) => i.essential && !i.done) ? 'needs_info' : 'pending';
}

function summaryBody(data, items) {
  const lines = [`Sales handoff — ${data.businessName}`];
  if (data.ownerName) lines.push(`Sold by: ${data.ownerName}`);
  if ((data.agreedServices || []).length) lines.push(`Agreed services: ${data.agreedServices.join(', ')}`);
  if (data.pricing) {
    const p = data.pricing;
    const parts = [];
    if (p.initialAmountCents) parts.push(`${formatMoney(p.initialAmountCents, p.currency)} due at start`);
    if (p.recurringAmountCents) parts.push(`then ${formatMoney(p.recurringAmountCents, p.currency)}/${p.recurringInterval}`);
    if (parts.length) lines.push(`Pricing: ${parts.join(', ')}`);
  }
  if (data.payment) lines.push(`Payment: ${formatMoney(data.payment.amountCents, data.payment.currency)} received ${new Date(data.payment.paidAt).toDateString()} (${data.payment.source === 'stripe' ? 'confirmed by Stripe' : 'recorded manually'})`);
  if (data.promisedWork) lines.push(`Promised work: ${data.promisedWork}`);
  if (data.targetDates?.kickoff || data.targetDates?.launch) {
    lines.push(`Target dates: ${[data.targetDates.kickoff && `kickoff ${data.targetDates.kickoff}`, data.targetDates.launch && `launch ${data.targetDates.launch}`].filter(Boolean).join(', ')}`);
  }
  lines.push(`Registrar access: ${ACCESS_LABELS[data.registrarAccess] || 'Not asked yet'} · Hosting access: ${ACCESS_LABELS[data.hostingAccess] || 'Not asked yet'}`);
  const social = Object.entries(data.socialLinks || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (social.length) lines.push(`Social: ${social.join(' · ')}`);
  if (data.salesNotes) lines.push(`Sales notes:\n${data.salesNotes}`);
  const missing = items.filter((i) => !i.done).map((i) => `${i.label}${i.essential ? ' (needed)' : ''}`);
  if (missing.length) lines.push(`Still to collect: ${missing.join(', ')}`);
  return lines.join('\n');
}

async function ensureHandoffRow(opportunity) {
  const existing = await SalesHandoff.findOne({ where: { opportunityId: opportunity.id } });
  if (existing) return existing;
  const data = await buildInitialData(opportunity);
  try {
    return await SalesHandoff.create({
      agencyOrganizationId: opportunity.agencyOrganizationId,
      opportunityId: opportunity.id,
      clientOrganizationId: opportunity.organizationId,
      status: 'pending',
      data,
      items: computeItems(data),
      startedAt: new Date(),
    });
  } catch (err) {
    const again = await SalesHandoff.findOne({ where: { opportunityId: opportunity.id } });
    if (again) return again;
    throw err;
  }
}

/** Fills blanks on the client profile and keeps one handoff summary note up to date. Never overwrites existing client data. */
async function applyToClient(handoff, authContext, actorUserId) {
  const organization = await Organization.findByPk(handoff.clientOrganizationId);
  if (!organization || organization.type !== 'client') return;
  const { data } = handoff;
  const [profile] = await listClientProfilesForRequester(authContext, [organization.id]);
  const blank = (field) => !profile || profile[field] === null || profile[field] === undefined || profile[field] === '';
  const fields = {};
  if (data.website && blank('websiteUrl')) fields.websiteUrl = data.website;
  if (data.address?.line1 && blank('addressLine1')) fields.addressLine1 = data.address.line1;
  if (data.address?.city && blank('city')) fields.city = data.address.city;
  if (data.address?.state && blank('state')) fields.state = data.address.state;
  if (data.address?.postalCode && blank('postalCode')) fields.postalCode = data.address.postalCode;
  if (data.pricing) {
    const setup = (data.pricing.initialAmountCents || 0) - (data.pricing.recurringAmountCents || 0);
    if (setup > 0 && blank('setupPriceCents')) fields.setupPriceCents = setup;
    if (data.pricing.recurringAmountCents && blank('recurringPriceCents')) fields.recurringPriceCents = data.pricing.recurringAmountCents;
    const frequency = data.pricing.recurringInterval ? INTERVAL_TO_FREQUENCY[data.pricing.recurringInterval] : 'one_time';
    if (frequency && blank('billingFrequency')) fields.billingFrequency = frequency;
  }
  if (data.payment && blank('paymentStatus')) fields.paymentStatus = 'current';
  // Account details (ADR 0013): what was sold and who looks after them, so
  // the client record carries the sale forward rather than only a note.
  if ((data.agreedServices || []).length && (!profile || !(profile.services || []).length)) {
    fields.services = data.agreedServices.slice(0, 20).map((name) => String(name).slice(0, 120));
  }
  if (data.promisedWork && blank('scopeNotes')) fields.scopeNotes = data.promisedWork;
  if (data.ownerUserId && blank('accountManagerUserId')) {
    // Only someone still on the team can look after the account.
    const team = await clientService.listTeam(authContext.organization.id);
    if (team.some((member) => member.id === data.ownerUserId)) fields.accountManagerUserId = data.ownerUserId;
  }
  const launch = data.targetDates?.launch ? new Date(`${data.targetDates.launch}T12:00:00.000Z`) : null;
  // Only a sensible upcoming date becomes the client's next action; anything else stays in the handoff.
  if (launch && !Number.isNaN(launch.getTime()) && launch.getTime() < Date.now() + 700 * 86400000 && blank('nextActionAt') && handoff.status !== 'complete') {
    fields.nextActionAt = launch.toISOString();
    fields.nextActionNote = 'Target launch';
  }
  if (Object.keys(fields).length) await clientService.updateClient(authContext, organization.id, fields, actorUserId);

  const body = summaryBody(data, handoff.items);
  const authorUserId = actorUserId || data.ownerUserId;
  if (handoff.summaryNoteId) {
    const [note] = await listClientNotesForRequester(authContext, { id: handoff.summaryNoteId });
    if (note) {
      await note.update({ body });
      return;
    }
  }
  if (!authorUserId) return;
  const note = await noteService.createNoteForClient({
    context: authContext, organization, projectId: handoff.projectId || null, body, authorUserId,
  });
  await handoff.update({ summaryNoteId: note.id });
}

async function projectFor(conversionAttempt) {
  const existing = await findProjectByConversionAttemptIdSystemLevel(conversionAttempt.id);
  if (existing) return existing;
  return ensureProjectForConversion({ alreadyConverted: false, conversionAttempt });
}

/**
 * Runs right after a successful conversion (webhook, reconcile or manual
 * payment). Never throws: a failure is recorded on the handoff for retry.
 */
async function runAfterConversion({ opportunityId, conversion, actorUserId = null }) {
  const opportunity = await Opportunity.findByPk(opportunityId);
  if (!opportunity) return null;
  let handoff = null;
  try {
    handoff = await ensureHandoffRow(opportunity);
    if (!conversion.conversionAttempt.clientInvitationStatus) await triggerClientInvitationIfNew(conversion);
    const project = await projectFor(conversion.conversionAttempt);
    await handoff.update({ projectId: project?.id || handoff.projectId, clientOrganizationId: opportunity.organizationId });
    await applyToClient(handoff, systemAuthContext(opportunity.agencyOrganizationId), actorUserId);
    const items = computeItems(handoff.data);
    await handoff.update({
      items, status: statusFor(handoff, items), lastError: null, attempts: handoff.attempts + 1,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sales] handoff for opportunity ${opportunityId} failed:`, err.message);
    if (!handoff) handoff = await SalesHandoff.findOne({ where: { opportunityId } });
    if (handoff) await handoff.update({ status: 'failed', lastError: err.message, attempts: handoff.attempts + 1 });
    else {
      await SalesHandoff.create({
        agencyOrganizationId: opportunity.agencyOrganizationId, opportunityId, clientOrganizationId: opportunity.organizationId, status: 'failed', data: {}, items: [], lastError: err.message, attempts: 1, startedAt: new Date(),
      }).catch(() => null);
    }
  }
  return handoff;
}

/** Payment arrived but converting the business into a client failed. */
async function markConversionFailed(opportunity, message) {
  const [handoff] = await SalesHandoff.findOrCreate({
    where: { opportunityId: opportunity.id },
    defaults: {
      agencyOrganizationId: opportunity.agencyOrganizationId, opportunityId: opportunity.id, clientOrganizationId: null, status: 'failed', data: {}, items: [], startedAt: new Date(),
    },
  });
  await handoff.update({ status: 'failed', lastError: message, attempts: handoff.attempts + 1 });
  return handoff;
}

function present(handoff) {
  if (!handoff) return null;
  const json = handoff.toJSON();
  return {
    ...json,
    accessStates: ACCESS_STATES.map((key) => ({ key, label: ACCESS_LABELS[key] })),
    missingEssential: (json.items || []).filter((i) => i.essential && !i.done).length,
  };
}

async function getForOpportunity(agencyId, opportunityId) {
  return present(await SalesHandoff.findOne({ where: { opportunityId, agencyOrganizationId: agencyId } }));
}

const TEXT_FIELDS = { promisedWork: 2000, salesNotes: 4000 };

function cleanUpdate(input, current) {
  const next = { ...current };
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (input[field] === undefined) continue;
    const value = String(input[field] || '').trim().slice(0, max);
    assertNoSecrets(value, field === 'promisedWork' ? 'Promised work' : 'Sales notes');
    next[field] = value;
  }
  for (const field of ['registrarAccess', 'hostingAccess']) {
    if (input[field] === undefined) continue;
    if (!ACCESS_STATES.includes(input[field])) throw invalid(`Unknown ${field} value`);
    next[field] = input[field];
  }
  if (input.targetDates) {
    const dates = { ...(current.targetDates || {}) };
    for (const key of ['kickoff', 'launch']) {
      if (input.targetDates[key] === undefined) continue;
      const value = input.targetDates[key];
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('Dates must be YYYY-MM-DD');
      dates[key] = value || null;
    }
    next.targetDates = dates;
  }
  if (input.socialLinks) {
    const links = { ...(current.socialLinks || {}) };
    for (const key of ['facebook', 'instagram', 'linkedin', 'google']) {
      if (input.socialLinks[key] === undefined) continue;
      const value = String(input.socialLinks[key] || '').trim().slice(0, 300);
      if (value && !/^https?:\/\//i.test(value)) throw invalid('Social links must start with http:// or https://');
      links[key] = value;
    }
    next.socialLinks = links;
  }
  if (input.checklist) {
    next.checklist = { ...(current.checklist || {}) };
    for (const key of ['logo', 'photos', 'content']) {
      if (input.checklist[key] !== undefined) next.checklist[key] = Boolean(input.checklist[key]);
    }
  }
  if (Array.isArray(input.agreedServices)) {
    next.agreedServices = input.agreedServices.map((s) => String(s || '').trim().slice(0, 150)).filter(Boolean).slice(0, 20);
    next.agreedServices.forEach((s) => assertNoSecrets(s, 'Agreed services'));
  }
  if (input.website !== undefined) {
    const value = String(input.website || '').trim().slice(0, 500);
    next.website = value || null;
    next.domain = registrableDomain(value);
  }
  return next;
}

async function loadOwned(ctx, opportunityId) {
  const handoff = await SalesHandoff.findOne({ where: { opportunityId, agencyOrganizationId: ctx.agencyId } });
  if (!handoff) throw invalid('This lead has no handoff yet — it starts automatically when the first payment is received.', 404);
  return handoff;
}

async function update(ctx, opportunityId, input, { complete = false } = {}) {
  const handoff = await loadOwned(ctx, opportunityId);
  if (handoff.status === 'failed') throw invalid('Retry the handoff first — the client was not set up yet.', 409);
  // Refresh the contact snapshot so fixes made on the lead are picked up.
  const contacts = await Contact.findAll({ where: { organizationId: handoff.clientOrganizationId, archivedAt: null, deletedAt: null } });
  const data = cleanUpdate(input, { ...handoff.data, contacts: contactsSnapshot(contacts) });
  const items = computeItems(data);
  const status = complete ? 'complete' : statusFor({ status: handoff.status === 'complete' ? 'complete' : 'pending' }, items);
  await handoff.update({
    data, items, status, completedAt: complete ? new Date() : handoff.completedAt, completedByUserId: complete ? ctx.userId : handoff.completedByUserId,
  });
  await applyToClient(handoff, ctx.authContext, ctx.userId);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: complete ? 'sales.handoff_completed' : 'sales.handoff_updated', targetType: 'Opportunity', targetId: opportunityId, metadata: { status }, req: ctx.req,
  });
  return present(handoff);
}

/** Retries whatever failed after payment: the conversion itself, or the client setup that follows it. */
async function retry(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  const attempt = await ConversionAttempt.findOne({ where: { opportunityId, status: 'completed' } });
  if (!attempt) {
    const payment = await SalesPayment.findOne({ where: { opportunityId, kind: 'initial' } });
    if (!payment) throw invalid('No payment has been recorded for this lead yet.', 409);
    // eslint-disable-next-line global-require
    const paymentEvents = require('./paymentEventsService');
    await paymentEvents.completeSale({
      opportunityId, agencyOrganizationId: ctx.agencyId, payment, source: 'manual', actorUserId: ctx.userId,
    });
  } else {
    await runAfterConversion({ opportunityId, conversion: { alreadyConverted: false, conversionAttempt: attempt }, actorUserId: ctx.userId });
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.handoff_retried', targetType: 'Opportunity', targetId: opportunityId, req: ctx.req,
  });
  return getForOpportunity(ctx.agencyId, opportunityId);
}

module.exports = {
  runAfterConversion, markConversionFailed, getForOpportunity, update, retry, computeItems, ACCESS_STATES,
};
