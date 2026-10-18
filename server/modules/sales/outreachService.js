'use strict';

const crypto = require('node:crypto');
const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Contact, OutreachActivity, User, PaymentLinkRequest,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const { STAGE_LABELS, OUTCOMES } = require('../../core/crm/pipelineCatalog');
const channels = require('./channelService');
const workspaceService = require('./workspaceService');
const paymentRequestService = require('./paymentRequestService');
const { unresolvedIn } = require('./templateService');
const introEmail = require('./introEmailService');
const {
  invalid, isUniqueViolation, isEmail, toE164, phoneKey, assertNoSecrets,
} = require('./salesCommon');

/**
 * Sending through Leadzaro (ADR 0011). Every send is deliberate (an
 * explicit action with an idempotency key, so a double click never sends
 * twice), honours do-not-contact, refuses unresolved {{placeholders}},
 * and is recorded as a platform-performed conversation with its delivery
 * state. A failed send keeps the activity (and the draft on screen).
 */

const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;

async function loadForSend(ctx, opportunityId, contactId, { confirmOwner = false } = {}) {
  const opportunity = await workspaceService.loadOpportunity(ctx, opportunityId);
  if (opportunity.doNotContact) throw invalid('This business is marked Do Not Contact.', 409);
  await workspaceService.claimForOutreach(ctx, opportunity, { confirmOwner });
  let contact = null;
  if (contactId) {
    contact = await Contact.findOne({ where: { id: contactId, organizationId: opportunity.organizationId, deletedAt: null, archivedAt: null } });
    if (!contact) throw invalid('Contact not found', 404);
    if (contact.doNotContact) throw invalid(`${contact.name} is marked Do Not Contact.`, 409);
  }
  return { opportunity, contact };
}

async function existingByKey(idempotencyKey) {
  return OutreachActivity.findOne({ where: { idempotencyKey } });
}

function checkKey(input) {
  const key = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(key)) throw invalid('Missing send key — reload and try again.');
  return key;
}

async function afterSend(ctx, opportunity, activity, { channel, paymentRequestId, body }) {
  await workspaceService.recordInteraction(ctx, opportunity, {
    direction: 'outbound', summary: `${channel === 'email' ? 'Email' : 'Text'} sent: ${activity.subject || String(body).slice(0, 60)}`, advanceTo: 'contacting',
  });
  if (paymentRequestId) {
    const request = await PaymentLinkRequest.findOne({ where: { id: paymentRequestId, opportunityId: opportunity.id } });
    if (request?.stripePaymentLinkUrl && String(body).includes(request.stripePaymentLinkUrl) && ['created', 'sent'].includes(request.status)) {
      await paymentRequestService.markSent(ctx, request.id, channel);
    }
  }
}

/**
 * An address marked do-not-contact anywhere in the agency (on any
 * business or contact) can't be emailed from any lead (ADR 0014).
 */
async function assertNotSuppressed(ctx, to) {
  const lower = String(to).toLowerCase();
  const byEmail = (column) => sequelize.where(sequelize.fn('lower', sequelize.col(column)), lower);
  const contact = await Contact.findOne({
    where: {
      agencyOrganizationId: ctx.agencyId, doNotContact: true, deletedAt: null, [Op.and]: [byEmail('email')],
    },
    attributes: ['id'],
  });
  const organizations = await Organization.findAll({
    where: { managingAgencyOrganizationId: ctx.agencyId, [Op.and]: [byEmail('email')] },
    attributes: ['id'],
  });
  const optedOut = organizations.length ? await Opportunity.findOne({
    where: {
      agencyOrganizationId: ctx.agencyId, organizationId: organizations.map((o) => o.id), doNotContact: true, deletedAt: null,
    },
    attributes: ['id'],
  }) : null;
  if (contact || optedOut) throw invalid(`${to} is marked do not contact. It can’t be emailed from Leadzaro.`, 409, { code: 'suppressed' });
}

/**
 * Guards against accidental repeats: the identical email to the same
 * address within a day, or an introduction to a business someone already
 * emailed. Either can be sent anyway once the employee has seen it.
 */
async function assertNotRepeat(ctx, organization, to, { subject, body, intro }) {
  const previous = await introEmail.previousEmails(ctx.agencyId, organization.id, to, { limit: 10 });
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const identical = previous.find((p) => p.subject === subject && p.body === body && new Date(p.at).getTime() > dayAgo);
  const strip = (p) => ({
    at: p.at, subject: p.subject, to: p.to, status: p.status, user: p.user,
  });
  if (identical) {
    throw invalid(`This exact email was already sent to ${identical.to} by ${identical.user?.name || 'a teammate'} in the last day.`, 409, { code: 'duplicate_send', previous: [strip(identical)] });
  }
  if (intro && previous.length) {
    throw invalid(`${previous[0].user?.name || 'Someone'} already emailed this business — review before sending another introduction.`, 409, { code: 'previous_outreach', previous: previous.map(strip) });
  }
}

async function send(ctx, opportunityId, input) {
  const channel = input.channel === 'sms' ? 'sms' : 'email';
  const idempotencyKey = checkKey(input);
  const prior = await existingByKey(idempotencyKey);
  if (prior) return { activity: prior, duplicate: true };

  const { opportunity, contact } = await loadForSend(ctx, opportunityId, input.contactId, { confirmOwner: Boolean(input.confirmOwner) });
  const subject = channel === 'email' ? String(input.subject || '').trim().slice(0, 300) : null;
  const body = String(input.body || '').trim();
  if (!body) throw invalid('Write a message first');
  if (channel === 'email' && !subject) throw invalid('Add a subject line');
  if (channel === 'sms' && body.length > 1600) throw invalid('Texts are limited to 1,600 characters');
  if (body.length > 20000) throw invalid('Message is too long');
  const unresolved = unresolvedIn(subject, body);
  if (unresolved.length) throw invalid(`Fill in ${unresolved.map((k) => `{{${k}}}`).join(', ')} before sending.`, 422, { unresolved });
  assertNoSecrets(body, 'Message');

  let to;
  const organization = await Organization.findByPk(opportunity.organizationId);
  if (channel === 'email') {
    to = String(input.to || contact?.email || organization.email || '').trim();
    if (!isEmail(to)) throw invalid('Add a valid email address for this lead first.');
    await assertNotSuppressed(ctx, to);
    if (!input.confirmRecent) await assertNotRepeat(ctx, organization, to, { subject, body, intro: input.intent === 'intro' });
  } else {
    to = toE164(input.to || contact?.phone || organization.phone);
    if (!to || to.replace(/\D/g, '').length < 10) throw invalid('Add a valid mobile number for this lead first.');
  }

  // Refuse before recording anything, so an unconnected channel never leaves a "sending" message behind.
  if (channel === 'email') {
    const ready = await channels.emailReady(ctx);
    if (!ready.ok) throw invalid(ready.message, 503, { code: 'email_not_connected' });
  }
  const user = await User.findByPk(ctx.userId, { attributes: ['id', 'name', 'email'] });
  let activity;
  try {
    activity = await OutreachActivity.create({
      organizationId: ctx.agencyId,
      userId: ctx.userId,
      leadId: opportunity.sourceLeadId || null,
      opportunityId: opportunity.id,
      contactId: contact?.id || null,
      type: channel === 'email' ? 'email' : 'message',
      channel,
      direction: 'outbound',
      origin: 'platform',
      outcome: 'sent',
      status: 'sending',
      subject,
      body,
      toAddress: to,
      provider: channel === 'email' ? channels.emailProvider() : 'twilio',
      templateId: input.templateId || null,
      idempotencyKey,
      occurredAt: new Date(),
      completedFollowUp: Boolean(opportunity.nextActionAt && new Date(opportunity.nextActionAt).getTime() <= Date.now() + 12 * 3600 * 1000),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { activity: await existingByKey(idempotencyKey), duplicate: true };
    throw err;
  }

  const result = channel === 'email'
    ? await channels.sendEmail({
      to, subject, body, fromName: user?.name, replyTo: user?.email, activityId: activity.id, userId: ctx.userId, agencyId: ctx.agencyId,
    })
    : await channels.sendSms({ to, body });

  if (!result.ok) {
    await activity.update({ status: 'failed', errorMessage: String(result.error).slice(0, 500), outcome: null });
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'outreach.send_failed', targetType: 'Opportunity', targetId: opportunity.id, metadata: { channel }, req: ctx.req,
    });
    throw invalid(`Not sent: ${result.error}`, 502, { activityId: activity.id });
  }

  // "sent" means the provider accepted it; delivery, bounces and replies are only recorded from real events.
  await activity.update({
    status: result.status, providerMessageId: result.providerMessageId || null, fromAddress: result.from || null, provider: result.provider || activity.provider,
  });
  if (channel === 'email' && opportunity.emailDraft) await opportunity.update({ emailDraft: null });
  await afterSend(ctx, opportunity, activity, { channel, paymentRequestId: input.paymentRequestId, body });
  if (input.nextAction?.at) await workspaceService.setNextAction(ctx, opportunity.id, input.nextAction);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'outreach.sent', targetType: 'Opportunity', targetId: opportunity.id, metadata: { channel, activityId: activity.id }, req: ctx.req,
  });
  return { activity, duplicate: false };
}

/** Click-to-call: rings the salesperson, then connects the lead. The outcome is logged afterwards. */
async function startCall(ctx, opportunityId, input) {
  const idempotencyKey = checkKey(input);
  const prior = await existingByKey(idempotencyKey);
  if (prior) return { activity: prior, duplicate: true };
  const { opportunity, contact } = await loadForSend(ctx, opportunityId, input.contactId, { confirmOwner: Boolean(input.confirmOwner) });
  const organization = await Organization.findByPk(opportunity.organizationId);
  const leadPhone = toE164(input.to || contact?.phone || organization.phone);
  if (!leadPhone) throw invalid('Add a phone number for this lead first.');
  const user = await User.findByPk(ctx.userId, { attributes: ['phone'] });
  const repPhone = toE164(user?.phone);
  if (!repPhone) throw invalid('Add your own phone number in Settings → My account first — Leadzaro rings you, then connects the lead.', 409);

  const activity = await OutreachActivity.create({
    organizationId: ctx.agencyId,
    userId: ctx.userId,
    leadId: opportunity.sourceLeadId || null,
    opportunityId: opportunity.id,
    contactId: contact?.id || null,
    type: 'call',
    channel: 'call',
    direction: 'outbound',
    origin: 'platform',
    status: 'initiated',
    toAddress: leadPhone,
    provider: 'twilio',
    idempotencyKey,
    occurredAt: new Date(),
  });
  const result = await channels.startBridgedCall({ repPhone, leadPhone });
  if (!result.ok) {
    await activity.update({ status: 'failed', errorMessage: String(result.error).slice(0, 500) });
    throw invalid(`Call not started: ${result.error}`, 502, { activityId: activity.id });
  }
  await activity.update({ status: result.status, providerMessageId: result.providerMessageId });
  return { activity, duplicate: false };
}

/** Records the outcome on a platform call started with startCall. */
function completeCall(ctx, opportunityId, activityId, input) {
  if (!OUTCOMES[input.outcome]) throw invalid('Choose what happened');
  return workspaceService.logOutcome(ctx, opportunityId, {
    ...input, channel: 'call', activityId, idempotencyKey: `call-outcome-${activityId}`,
  });
}

// ----------------------------------------------------------- conversations

/**
 * Conversations, one row per business (ADR 0016): where each one stands —
 * they replied, a follow-up is due, we're waiting on them, or several tries
 * with no answer — and how many times and ways we've reached out. Tab
 * counts come from the same rules so the numbers always match the list.
 */
const CONVERSATION_FILTERS = ['all', 'needs_reply', 'due', 'waiting', 'no_response', 'failed'];
const NOT_SENT_SQL = `('failed','undelivered','sending','draft')`;

function conversationConditions(ctx, end) {
  const agency = sequelize.escape(ctx.agencyId);
  const endAt = sequelize.escape(end.toISOString());
  return {
    needs_reply: (o) => `${o}."replyNeededSince" IS NOT NULL`,
    due: (o) => `${o}."replyNeededSince" IS NULL AND ${o}."nextActionAt" < ${endAt} AND ${o}.stage NOT IN ('won','lost')`,
    waiting: (o) => `${o}."replyNeededSince" IS NULL AND (${o}."nextActionAt" IS NULL OR ${o}."nextActionAt" >= ${endAt}) AND ${o}.stage NOT IN ('won','lost')
      AND NOT ((${`SELECT COUNT(*) FROM "OutreachActivities" a WHERE a."opportunityId" = ${o}.id AND a."deletedAt" IS NULL AND a.direction = 'outbound' AND (a.status IS NULL OR a.status NOT IN ${NOT_SENT_SQL})`}) >= 3
        AND NOT EXISTS (SELECT 1 FROM "OutreachActivities" a WHERE a."opportunityId" = ${o}.id AND a."deletedAt" IS NULL AND a.direction = 'inbound'))`,
    no_response: (o) => `${o}."replyNeededSince" IS NULL AND ${o}.stage NOT IN ('won','lost')
      AND (SELECT COUNT(*) FROM "OutreachActivities" a WHERE a."opportunityId" = ${o}.id AND a."deletedAt" IS NULL AND a.direction = 'outbound' AND (a.status IS NULL OR a.status NOT IN ${NOT_SENT_SQL})) >= 3
      AND NOT EXISTS (SELECT 1 FROM "OutreachActivities" a WHERE a."opportunityId" = ${o}.id AND a."deletedAt" IS NULL AND a.direction = 'inbound')`,
    failed: (o) => `EXISTS (SELECT 1 FROM "OutreachActivities" a WHERE a."opportunityId" = ${o}.id AND a.status IN ('failed','undelivered') AND a."organizationId" = ${agency})`
  };
}

async function listConversations(ctx, {
  filter = 'all', scope = 'mine', q, page = 1, limit = 30, tzOffset,
} = {}) {
  const chosen = CONVERSATION_FILTERS.includes(filter) ? filter : 'all';
  // eslint-disable-next-line global-require
  const { dayBounds } = require('./todayService');
  // eslint-disable-next-line global-require
  const { effectiveOffset } = require('../../core/workspace/timezone');
  const { end } = dayBounds(effectiveOffset(ctx.timezone, tzOffset));
  const conditions = conversationConditions(ctx, end);
  const team = scope === 'team' && ctx.can('sales.view_team');

  const base = {
    agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, lastInteractionAt: { [Op.ne]: null },
  };
  if (!team) base.assignedToUserId = ctx.userId;
  const orgWhere = q ? { name: { [Op.iLike]: `%${String(q).slice(0, 100)}%` } } : undefined;

  // Tab counts, from the same conditions as the list.
  const scopeSql = `o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o."archivedAt" IS NULL AND o."lastInteractionAt" IS NOT NULL ${team ? '' : 'AND o."assignedToUserId" = :userId'}
    ${q ? 'AND EXISTS (SELECT 1 FROM "Organizations" g WHERE g.id = o."organizationId" AND g.name ILIKE :q)' : ''}`;
  const [[counts]] = await sequelize.query(`SELECT COUNT(*)::int AS "all",
      ${['needs_reply', 'due', 'waiting', 'no_response', 'failed'].map((k) => `COUNT(*) FILTER (WHERE ${conditions[k]('o')})::int AS "${k}"`).join(', ')}
    FROM "Opportunities" o WHERE ${scopeSql}`, { replacements: { agencyId: ctx.agencyId, userId: ctx.userId, q: `%${String(q || '').slice(0, 100)}%` } });

  const size = Math.min(100, Number(limit) || 30);
  const where = { ...base };
  if (chosen !== 'all') where[Op.and] = [sequelize.literal(conditions[chosen]('"Opportunity"'))];
  const { rows, count } = await Opportunity.findAndCountAll({
    where,
    include: [
      {
        model: Organization, as: 'organization', attributes: ['id', 'name', 'type', 'city', 'state', 'email', 'phone'], where: orgWhere, required: Boolean(orgWhere),
      },
      { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
    ],
    order: [
      [sequelize.literal('"Opportunity"."replyNeededSince" IS NULL'), 'ASC'],
      [sequelize.literal(`("Opportunity"."nextActionAt" < ${sequelize.escape(end.toISOString())}) IS NOT TRUE`), 'ASC'],
      ['nextActionAt', 'ASC NULLS LAST'],
      ['lastInteractionAt', 'DESC'],
    ],
    limit: size,
    offset: (Math.max(1, Number(page) || 1) - 1) * size,
  });

  const ids = rows.map((r) => r.id);
  const [activities, tallies] = ids.length ? await Promise.all([
    OutreachActivity.findAll({ where: { opportunityId: ids, deletedAt: null }, order: [['createdAt', 'DESC']] }),
    sequelize.query(`SELECT "opportunityId", COALESCE(channel, 'other') AS channel, direction, COUNT(*)::int AS n,
        MAX(COALESCE("occurredAt", "createdAt")) AS last
      FROM "OutreachActivities" WHERE "opportunityId" IN (:ids) AND "deletedAt" IS NULL AND (direction = 'inbound' OR status IS NULL OR status NOT IN ${NOT_SENT_SQL})
      GROUP BY 1, 2, 3`, { replacements: { ids }, type: sequelize.QueryTypes.SELECT }),
  ]) : [[], []];
  const lastByOpp = new Map();
  for (const a of activities) if (!lastByOpp.has(a.opportunityId)) lastByOpp.set(a.opportunityId, a);

  const now = Date.now();
  const items = rows.map((o) => {
    const last = lastByOpp.get(o.id);
    const mine = tallies.filter((t) => t.opportunityId === o.id);
    const out = mine.filter((t) => t.direction === 'outbound');
    const attempts = out.reduce((s, t) => s + t.n, 0);
    const replies = mine.filter((t) => t.direction === 'inbound').reduce((s, t) => s + t.n, 0);
    const lastOut = out.map((t) => new Date(t.last).getTime()).sort((a, b) => b - a)[0] || null;
    const channels = {};
    for (const t of out) channels[t.channel] = (channels[t.channel] || 0) + t.n;
    let state = 'waiting';
    if (['won', 'lost'].includes(o.stage) || o.doNotContact) state = 'closed';
    else if (o.replyNeededSince) state = 'needs_reply';
    else if (o.nextActionAt && new Date(o.nextActionAt) < end) state = 'due';
    else if (attempts >= 3 && !replies) state = 'no_response';
    return {
      opportunityId: o.id,
      businessName: o.organization?.name,
      city: o.organization?.city || null,
      state: o.organization?.state || null,
      hasEmail: Boolean(o.organization?.email),
      hasPhone: Boolean(o.organization?.phone),
      stage: o.stage,
      stageLabel: STAGE_LABELS[o.stage],
      interestLevel: o.interestLevel,
      assignedTo: o.assignedTo,
      replyNeededSince: o.replyNeededSince,
      doNotContact: o.doNotContact,
      lastInteractionAt: o.lastInteractionAt,
      nextActionAt: o.nextActionAt,
      nextActionType: o.nextActionType,
      nextActionNote: o.nextActionNote,
      status: state,
      attempts,
      replies,
      channels,
      daysSinceOutbound: lastOut ? Math.floor((now - lastOut) / 86400000) : null,
      last: last ? {
        channel: last.channel || last.type, direction: last.direction, origin: last.origin, status: last.status, outcome: last.outcome, subject: last.subject, preview: String(last.body || last.note || '').slice(0, 160), at: last.occurredAt || last.createdAt,
      } : null,
    };
  });
  return { items, total: count, counts };
}

// ----------------------------------------------------------- twilio webhooks

const DELIVERY_STATES = new Set(['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'canceled']);

async function handleTwilioStatus(params) {
  const sid = params.MessageSid || params.CallSid;
  const status = params.MessageStatus || params.CallStatus;
  if (!sid || !DELIVERY_STATES.has(status)) return;
  const activity = await OutreachActivity.findOne({ where: { providerMessageId: sid } });
  if (!activity) return;
  const updates = { status };
  if (params.ErrorCode) updates.errorMessage = `Twilio error ${params.ErrorCode}${params.ErrorMessage ? `: ${params.ErrorMessage}` : ''}`.slice(0, 500);
  if (params.CallDuration) updates.durationSeconds = Number(params.CallDuration) || null;
  await activity.update(updates);
}

/**
 * An incoming text. Matched to the lead we most recently texted from this
 * number; STOP-style replies set do-not-contact. Unmatched texts are
 * ignored (never attached to a guessed lead).
 */
async function handleTwilioInbound(params) {
  const from = toE164(params.From);
  const body = String(params.Body || '').slice(0, 5000);
  if (!from) return;
  const key = phoneKey(from);
  const lastOutbound = await OutreachActivity.findOne({
    where: { channel: 'sms', direction: 'outbound', toAddress: { [Op.like]: `%${key}` }, opportunityId: { [Op.ne]: null } },
    order: [['createdAt', 'DESC']],
  });
  if (!lastOutbound) return;
  const opportunity = await Opportunity.findByPk(lastOutbound.opportunityId);
  if (!opportunity) return;
  try {
    await OutreachActivity.create({
      organizationId: opportunity.agencyOrganizationId,
      userId: lastOutbound.userId,
      leadId: opportunity.sourceLeadId || null,
      opportunityId: opportunity.id,
      contactId: lastOutbound.contactId,
      type: 'message',
      channel: 'sms',
      direction: 'inbound',
      origin: 'platform',
      outcome: 'replied',
      status: 'received',
      body,
      fromAddress: from,
      provider: 'twilio',
      providerMessageId: params.MessageSid || null,
      idempotencyKey: params.MessageSid ? `twilio-${params.MessageSid}` : crypto.randomUUID(),
      occurredAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }
  if (STOP_WORDS.test(body)) {
    await opportunity.update({
      doNotContact: true, doNotContactAt: new Date(), doNotContactReason: `Replied “${body.trim()}” by text`, nextActionAt: null, nextActionType: null, nextActionNote: null, replyNeededSince: null, lastInteractionAt: new Date(), lastInteractionSummary: 'Opted out by text',
    });
    if (lastOutbound.contactId) await Contact.update({ doNotContact: true }, { where: { id: lastOutbound.contactId } });
    return;
  }
  await opportunity.update({ replyNeededSince: opportunity.replyNeededSince || new Date(), lastInteractionAt: new Date(), lastInteractionSummary: `Text reply: ${body.slice(0, 80)}` });
  const recipient = opportunity.assignedToUserId || lastOutbound.userId;
  if (recipient) {
    const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
    await notify({
      userId: recipient, organizationId: opportunity.agencyOrganizationId, type: 'sales.reply', title: `New text from ${organization?.name || 'a lead'}`, body: body.slice(0, 300), data: { opportunityId: opportunity.id },
    }).catch(() => null);
  }
}

async function setMyPhone(ctx, phone) {
  const value = String(phone || '').trim();
  if (value && (!toE164(value) || toE164(value).replace(/\D/g, '').length < 10)) throw invalid('Enter a full phone number, including area code.');
  await User.update({ phone: value || null }, { where: { id: ctx.userId } });
  return channels.channelStatus(ctx);
}

module.exports = {
  send, startCall, completeCall, listConversations, handleTwilioStatus, handleTwilioInbound, setMyPhone,
};
