'use strict';

const crypto = require('node:crypto');
const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Lead, Contact, LeadNote, OutreachActivity, User, InboundSubmission, PaymentLinkRequest, SalesPayment,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const {
  STAGES, STAGE_LABELS, OUTCOMES, CHANNELS, NEXT_ACTION_TYPES, isForward, QUALIFICATION_FIELDS, STAGE_GUIDE, CLOSE_REASONS, NURTURE_REASONS,
  STALL_DAYS, stallInfo, missingForStage,
} = require('../../core/crm/pipelineCatalog');
const opportunityService = require('../crm/opportunityService');
const handoffService = require('./handoffService');
const stripeService = require('./stripeService');
const paymentRequestService = require('./paymentRequestService');
const channels = require('./channelService');
const {
  invalid, isUniqueViolation, assertNoSecrets, isEmail,
} = require('./salesCommon');

/**
 * The lead workspace (ADR 0011): everything about one deal in one place,
 * the recommended next step, and the quick outcome flow that records what
 * happened and schedules what happens next.
 */

const OPEN_REQUEST = ['created', 'sent', 'processing'];
const USER_ATTRS = ['id', 'name', 'email'];

async function loadOpportunity(ctx, opportunityId, { transaction, lock } = {}) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    ...(transaction ? { transaction } : {}),
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!opportunity) throw invalid('Lead not found', 404);
  return opportunity;
}

function contactMethods(business, contacts) {
  const usable = contacts.filter((c) => !c.doNotContact);
  return {
    phone: Boolean(business.phone || usable.some((c) => c.phone)),
    email: Boolean(business.email || usable.some((c) => c.email)),
  };
}

function isOverdue(date) {
  return date && new Date(date) < new Date();
}

const QUAL_ASK = {
  qualNeed: 'what they need help with',
  qualService: 'which service fits',
  qualDecisionMaker: 'who makes the decision',
  qualTiming: 'when they want it done',
  qualBudget: 'what budget they have in mind',
};
// What to find out next, by stage — progressive, never all at once.
const ASK_BY_STAGE = {
  new: ['qualNeed'],
  contacting: ['qualNeed', 'qualDecisionMaker'],
  qualified: ['qualService', 'qualDecisionMaker', 'qualTiming', 'qualBudget'],
  proposal: ['qualDecisionMaker', 'qualBudget', 'qualTiming'],
  awaiting_payment: [],
  nurture: ['qualTiming'],
};
const ACTION_FOR_TYPE = {
  call: 'call', email: 'email', text: 'sms', follow_up: 'log', meeting: 'log', send_offer: 'offer', payment_follow_up: 'check_payment', handoff: 'handoff', other: 'log',
};

/** "today", "yesterday", "3 days ago", "tomorrow", "in 4 days". */
function when(date, now = Date.now()) {
  if (!date) return '';
  const days = Math.round((new Date(date).getTime() - now) / 86400000);
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  if (days === 1) return 'tomorrow';
  return days < 0 ? `${-days} days ago` : `in ${days} days`;
}

/**
 * The single most useful next step for this lead, in priority order, and
 * why (ADR 0013): the facts that led to it, the action to take, and what
 * to find out in the next conversation. Only ever derived from recorded
 * facts — never a score.
 */
function recommend({
  opportunity, business, contacts, activities, requests, handoff, hasSale,
}) {
  const methods = contactMethods(business, contacts);
  const outbound = activities.filter((a) => a.direction === 'outbound');
  const inbound = activities.filter((a) => a.direction === 'inbound');
  const lastInbound = inbound[0] || null;
  const sinceReply = lastInbound ? outbound.filter((a) => new Date(a.occurredAt) > new Date(lastInbound.occurredAt)) : outbound;
  const reached = activities.some((a) => a.direction === 'inbound' || (a.outcome && OUTCOMES[a.outcome]?.connected));
  const openRequest = requests.find((r) => r.isOpen);
  const problemRequest = requests.find((r) => ['failed', 'expired'].includes(r.status) && !r.replacedByRequestId);
  const stall = stallInfo(opportunity);
  const ask = (ASK_BY_STAGE[opportunity.stage] || []).filter((key) => !opportunity[key]).slice(0, 3).map((key) => QUAL_ASK[key]);
  const firstChoice = methods.phone ? 'call' : 'email';

  const why = [];
  if (opportunity.lastInteractionAt) why.push(`Last activity ${when(opportunity.lastInteractionAt)}${opportunity.lastInteractionSummary ? `: ${opportunity.lastInteractionSummary}` : ''}.`);
  if (sinceReply.length >= 2 && !opportunity.replyNeededSince) why.push(`${sinceReply.length} attempts ${lastInbound ? 'since their last reply' : 'so far'} with no reply.`);
  if (stall) why.push(`No activity for ${stall.days} days — deals at this stage stall after ${stall.limit}.`);

  const result = (rec) => ({
    why, ask, action: null, tip: null, ...rec,
  });

  if (opportunity.doNotContact) {
    return result({
      key: 'do_not_contact', label: 'Do not contact', detail: opportunity.doNotContactReason || 'This business asked not to be contacted.', tone: 'muted', why: [], ask: [],
    });
  }
  if (opportunity.stage === 'won') {
    const base = { why: [], ask: [], action: { type: 'handoff', label: 'Open the handoff' } };
    if (!handoff) return result({ ...base, key: 'handoff', label: 'Prepare the handoff', detail: 'Payment received — the handoff is being prepared.', tone: 'info' });
    if (handoff.status === 'failed') return result({ ...base, key: 'retry_handoff', label: 'Retry the client setup', detail: handoff.lastError || 'Payment arrived but the client setup failed.', tone: 'danger' });
    if (handoff.status !== 'complete') {
      return result({
        ...base,
        key: 'handoff',
        label: 'Complete the handoff',
        detail: handoff.missingEssential ? `${handoff.missingEssential} essential item${handoff.missingEssential === 1 ? '' : 's'} still missing before the team can start.` : 'Everything essential is in — confirm it so the client team can start.',
        tone: 'primary',
        tip: 'The client team works only from what’s in the handoff — services, promises, access and dates.',
      });
    }
    return result({
      key: 'done', label: 'Handed off', detail: 'This client is with the delivery team.', tone: 'success', why: [], ask: [], action: { type: 'client', label: 'Open client' },
    });
  }
  if (opportunity.stage === 'lost') {
    return result({
      key: 'closed', label: 'Closed — lost', detail: opportunity.lostReason || 'No further action needed.', tone: 'muted', why: [], ask: [],
    });
  }
  if (opportunity.replyNeededSince) {
    const channel = lastInbound?.channel === 'sms' ? 'sms' : (lastInbound?.channel === 'call' ? 'call' : 'email');
    return result({
      key: 'reply',
      label: 'Reply to their message',
      detail: `They replied ${when(opportunity.replyNeededSince)} and are waiting on you.`,
      tone: 'danger',
      action: { type: channel, label: channel === 'sms' ? 'Text back' : channel === 'call' ? 'Call back' : 'Reply by email' },
      tip: 'Answer their question first, then agree one concrete next step and log it.',
    });
  }
  if (!methods.phone && !methods.email) {
    return result({
      key: 'add_contact', label: 'Add contact info', detail: 'There is no phone number or email for this business yet.', tone: 'warning', action: { type: 'edit_business', label: 'Add phone or email' },
      tip: business.website ? 'Their website’s contact page usually lists a phone number or email.' : 'Check their Google listing for a phone number.',
    });
  }
  if (!outbound.length) {
    return result({
      key: 'first_contact',
      label: 'Make first contact',
      detail: methods.phone ? 'Call first — a conversation qualifies faster than email. Log how it went straight after.' : 'No phone number, so start with the first-email template.',
      tone: 'primary',
      action: { type: firstChoice, label: firstChoice === 'call' ? 'Call now' : 'Write the first email' },
      tip: business.website ? 'Open with one specific thing you noticed on their current website.' : 'They have no website listed — lead with how customers find them online today.',
    });
  }
  if (problemRequest && !openRequest && !hasSale) {
    return result({
      key: 'payment_problem',
      label: problemRequest.status === 'expired' ? 'Send a new payment link' : 'Follow up on the failed payment',
      detail: `The last payment request ${problemRequest.status === 'expired' ? 'expired before it was paid' : 'failed'}.`,
      tone: 'warning',
      action: { type: 'offer', label: 'Open offers & payments' },
      tip: problemRequest.status === 'expired' ? 'Check they still want to go ahead, then send a fresh link.' : 'Call to check the card details — a new link can be sent right after.',
    });
  }
  if (openRequest && !openRequest.sentAt) {
    return result({
      key: 'send_payment_link', label: 'Send the payment link', detail: 'A payment link was created but not sent yet. Copying it does not count as sending.', tone: 'primary', action: { type: 'offer', label: 'Send the link' },
    });
  }
  if (openRequest) {
    why.unshift(`Payment link sent ${when(openRequest.sentAt)} — not paid yet.`);
    return result({
      key: 'payment_follow_up',
      label: 'Follow up on payment',
      detail: 'Check whether they have questions before paying.',
      tone: isOverdue(opportunity.nextActionAt) ? 'warning' : 'info',
      action: { type: methods.phone ? 'call' : 'email', label: methods.phone ? 'Call about the payment' : 'Email about the payment' },
      tip: 'If they paid another way, record the payment manually so the deal is marked Won.',
    });
  }
  if (isOverdue(opportunity.nextActionAt)) {
    const type = ACTION_FOR_TYPE[opportunity.nextActionType] || 'log';
    why.unshift(`Planned ${labelForNextAction(opportunity.nextActionType).toLowerCase()} was due ${when(opportunity.nextActionAt)}${opportunity.nextActionNote ? ` (${opportunity.nextActionNote})` : ''}.`);
    return result({
      key: 'overdue',
      label: `Overdue: ${labelForNextAction(opportunity.nextActionType)}`,
      detail: opportunity.nextActionNote || 'This follow-up is past due.',
      tone: 'warning',
      action: { type, label: type === 'log' ? 'Log what happened' : labelForNextAction(opportunity.nextActionType) },
      tip: sinceReply.length >= 4 && !reached ? 'Several attempts without reaching them — try another channel, or move it to Nurture with a revisit date.' : null,
    });
  }
  if (opportunity.stage === 'proposal') {
    return result({
      key: 'create_payment_link',
      label: ask.length ? 'Confirm the details, then send the offer' : 'Send the offer and payment link',
      detail: ask.length ? 'Before asking for payment, make sure you know the points below.' : 'They’re ready — send a secure Stripe link with the agreed services.',
      tone: 'primary',
      action: { type: 'offer', label: 'Create payment link' },
    });
  }
  if (opportunity.stage === 'qualified') {
    return result({
      key: 'prepare_offer',
      label: 'Book a meeting or prepare an offer',
      detail: 'They’re interested — agree the next concrete step while it’s warm.',
      tone: 'primary',
      action: { type: firstChoice, label: firstChoice === 'call' ? 'Call to book it' : 'Email to book it' },
      tip: 'Suggest two specific times rather than asking when suits them.',
    });
  }
  if (!opportunity.nextActionAt) {
    return result({
      key: 'schedule',
      label: 'Schedule a follow-up',
      detail: 'Every open lead needs a next step and a date, or it slips through.',
      tone: 'warning',
      action: { type: 'schedule', label: 'Set the next step' },
      tip: sinceReply.length >= 4 && !reached ? 'No response after several tries — schedule one last attempt, or park it in Nurture.' : null,
    });
  }
  if (stall) {
    return result({
      key: 'stalled',
      label: 'Re-engage this deal',
      detail: `Nothing has happened for ${stall.days} days. The next step is ${when(opportunity.nextActionAt)} — consider moving it sooner.`,
      tone: 'warning',
      action: { type: firstChoice, label: firstChoice === 'call' ? 'Call now' : 'Send a follow-up' },
    });
  }
  const type = ACTION_FOR_TYPE[opportunity.nextActionType] || 'log';
  return result({
    key: 'scheduled',
    label: `Next: ${labelForNextAction(opportunity.nextActionType)} ${when(opportunity.nextActionAt)}`,
    detail: opportunity.nextActionNote || 'Nothing else is needed before then.',
    tone: 'info',
    action: type === 'log' ? null : { type, label: labelForNextAction(opportunity.nextActionType) },
  });
}

const NEXT_ACTION_LABELS = {
  call: 'Call', email: 'Email', text: 'Text', follow_up: 'Follow up', meeting: 'Meeting', send_offer: 'Send offer', payment_follow_up: 'Payment follow-up', handoff: 'Handoff', other: 'Follow up',
};
function labelForNextAction(type) {
  return NEXT_ACTION_LABELS[type] || 'Follow up';
}

function presentActivity(a) {
  const json = a.toJSON ? a.toJSON() : a;
  return {
    id: json.id,
    channel: json.channel || json.type,
    direction: json.direction,
    origin: json.origin,
    outcome: json.outcome,
    outcomeLabel: json.outcome ? OUTCOMES[json.outcome]?.label || json.outcome : null,
    status: json.status,
    subject: json.subject,
    body: json.body,
    note: json.note,
    toAddress: json.toAddress,
    errorMessage: json.errorMessage,
    durationSeconds: json.durationSeconds,
    occurredAt: json.occurredAt || json.createdAt,
    createdAt: json.createdAt,
    user: json.user ? { id: json.user.id, name: json.user.name } : null,
    contact: json.contact ? { id: json.contact.id, name: json.contact.name } : null,
  };
}

function presentBusiness(organization, lead) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
    phone: organization.phone,
    email: organization.email,
    website: organization.website,
    addressLine1: organization.addressLine1,
    city: organization.city,
    state: organization.state,
    postalCode: organization.postalCode,
    category: organization.category,
    detailsSource: organization.detailsSource || {},
    googleMapsUrl: lead?.googleMapsUrl || null,
    rating: lead?.rating ? Number(lead.rating) : null,
    reviewCount: lead?.reviewCount ?? null,
    listingSource: lead?.source || null,
  };
}

/** Stage meanings, requirements and reasons, for the workspace's stage and outcome forms. */
function pipelineGuide() {
  return {
    stages: STAGES.map((key) => ({
      key, label: STAGE_LABELS[key], ...STAGE_GUIDE[key], stallDays: STALL_DAYS[key] || null,
      requiresLabels: (STAGE_GUIDE[key]?.requires || []).map((r) => QUALIFICATION_FIELDS[r] || (r === 'closeReason' ? 'Reason' : 'Date to revisit')),
    })),
    qualificationFields: Object.entries(QUALIFICATION_FIELDS).map(([key, label]) => ({ key, label })),
    closeReasons: Object.entries(CLOSE_REASONS).map(([key, label]) => ({ key, label })),
    nurtureReasons: NURTURE_REASONS.map((key) => ({ key, label: CLOSE_REASONS[key] })),
  };
}

/** The approved services, prices, portfolio and pitch the workspace keeps in Settings (ADR 0013). */
function salesKitFor(ctx) {
  const kit = ctx.authContext?.organization?.settings?.salesKit || {};
  return {
    pitch: kit.pitch || '',
    services: Array.isArray(kit.services) ? kit.services : [],
    portfolio: Array.isArray(kit.portfolio) ? kit.portfolio : [],
    objections: Array.isArray(kit.objections) ? kit.objections : [],
  };
}

/**
 * One owner per lead (ADR 0013): contacting someone else's lead needs an
 * explicit confirmation, so two people never work the same business
 * without knowing. An unassigned lead becomes yours on first contact.
 */
async function claimForOutreach(ctx, opportunity, { confirmOwner = false, transaction } = {}) {
  if (opportunity.assignedToUserId && opportunity.assignedToUserId !== ctx.userId) {
    if (confirmOwner) return;
    const owner = await User.findByPk(opportunity.assignedToUserId, { attributes: ['id', 'name'], ...(transaction ? { transaction } : {}) });
    throw invalid(`${owner?.name || 'Someone else'} owns this lead. Check with them first, or confirm to contact it anyway.`, 409, {
      code: 'owned_by_other', owner: owner ? { id: owner.id, name: owner.name } : null,
    });
  }
  if (!opportunity.assignedToUserId) await opportunity.update({ assignedToUserId: ctx.userId }, transaction ? { transaction } : undefined);
}

async function getWorkspace(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    include: [
      { model: Organization, as: 'organization' },
      { model: Lead, as: 'sourceLead' },
      { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      { model: User, as: 'creditedTo', attributes: USER_ATTRS },
      { model: InboundSubmission, as: 'inboundSubmission' },
    ],
  });
  if (!opportunity) throw invalid('Lead not found', 404);
  const organization = opportunity.organization;

  const [contacts, activities, notes, requests, payments, handoff, others, stripeCustomer] = await Promise.all([
    Contact.findAll({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] }),
    OutreachActivity.findAll({
      where: { organizationId: ctx.agencyId, opportunityId, deletedAt: null, archivedAt: null },
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }, { model: Contact, as: 'contact', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit: 200,
    }),
    LeadNote.findAll({
      where: {
        organizationId: ctx.agencyId,
        [Op.or]: [{ opportunityId }, ...(opportunity.sourceLeadId ? [{ leadId: opportunity.sourceLeadId, opportunityId: null }] : [])],
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit: 200,
    }),
    paymentRequestService.listForOpportunity(ctx, opportunityId),
    SalesPayment.findAll({
      where: { agencyOrganizationId: ctx.agencyId, organizationId: organization.id },
      include: [{ model: User, as: 'recordedBy', attributes: ['id', 'name'] }],
      order: [['paidAt', 'DESC']],
    }),
    handoffService.getForOpportunity(ctx.agencyId, opportunityId),
    Opportunity.findAll({
      where: {
        organizationId: organization.id, agencyOrganizationId: ctx.agencyId, deletedAt: null, id: { [Op.ne]: opportunityId },
      },
      attributes: ['id', 'title', 'stage', 'createdAt', 'archivedAt'],
      order: [['createdAt', 'DESC']],
    }),
    stripeService.describeLink(ctx.agencyId, organization.id),
  ]);

  const presentedActivities = activities.map(presentActivity);
  const business = presentBusiness(organization, opportunity.sourceLead);
  const hasSale = payments.some((p) => p.opportunityId === opportunityId && p.kind === 'initial');
  const primary = contacts.find((c) => c.isPrimary) || contacts[0] || null;

  return {
    opportunity: {
      id: opportunity.id,
      title: opportunity.title,
      stage: opportunity.stage,
      stageLabel: STAGE_LABELS[opportunity.stage] || opportunity.stage,
      legacyStage: opportunity.legacyStage,
      valueCents: opportunity.valueCents,
      currency: opportunity.currency || 'usd',
      assignedTo: opportunity.assignedTo,
      creditedTo: opportunity.creditedTo,
      nextActionAt: opportunity.nextActionAt,
      nextActionType: opportunity.nextActionType,
      nextActionNote: opportunity.nextActionNote,
      lastInteractionAt: opportunity.lastInteractionAt,
      lastInteractionSummary: opportunity.lastInteractionSummary,
      replyNeededSince: opportunity.replyNeededSince,
      doNotContact: opportunity.doNotContact,
      doNotContactReason: opportunity.doNotContactReason,
      lostReason: opportunity.lostReason,
      wonAt: opportunity.wonAt,
      archivedAt: opportunity.archivedAt,
      isTest: opportunity.isTest,
      score: opportunity.score,
      scoreReason: opportunity.scoreReason,
      createdAt: opportunity.createdAt,
      stageChangedAt: opportunity.stageChangedAt,
      closeReasonCode: opportunity.closeReasonCode,
      closeReasonLabel: opportunity.closeReasonCode ? CLOSE_REASONS[opportunity.closeReasonCode] || null : null,
      qualification: Object.fromEntries(Object.keys(QUALIFICATION_FIELDS).map((key) => [key, opportunity[key] || null])),
      stall: stallInfo(opportunity),
      inboundSubmission: opportunity.inboundSubmission,
      paymentStatus: hasSale ? 'paid' : (requests.find((r) => r.isOpen)?.status || null),
    },
    business,
    contacts,
    primaryContact: primary,
    otherOpportunities: others,
    activities: presentedActivities,
    notes,
    paymentRequests: requests,
    payments: payments.map((p) => ({ ...p.toJSON(), forThisDeal: p.opportunityId === opportunityId })),
    handoff,
    stripe: stripeCustomer,
    clientId: organization.type === 'client' ? organization.id : null,
    recommendation: recommend({
      opportunity, business, contacts, activities: presentedActivities, requests, handoff, hasSale,
    }),
    channels: await channels.channelStatus(ctx),
    pipeline: pipelineGuide(),
    salesKit: salesKitFor(ctx),
    ownership: {
      mine: opportunity.assignedToUserId === ctx.userId,
      unassigned: !opportunity.assignedToUserId,
    },
    permissions: {
      send: ctx.can('outreach.send'),
      logOutreach: ctx.can('outreach.create'),
      createPayment: ctx.can('payments.create'),
      customOffer: ctx.can('payments.custom_offer'),
      recordManualPayment: ctx.can('payments.record_manual'),
      assign: ctx.can('leads.assign'),
      managePipeline: ctx.can('crm.manage_pipeline'),
      archive: ctx.can('leads.archive') || ctx.can('crm.manage_pipeline'),
      editBusiness: ctx.can('leads.update'),
    },
  };
}

const BUSINESS_FIELDS = {
  name: 255, phone: 50, email: 255, website: 500, addressLine1: 255, city: 100, state: 100, postalCode: 20, category: 150,
};
const SOURCE_KEY = { addressLine1: 'address' };

async function updateBusiness(ctx, opportunityId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const organization = await Organization.findByPk(opportunity.organizationId);
  const updates = {};
  const detailsSource = { ...(organization.detailsSource || {}) };
  for (const [field, max] of Object.entries(BUSINESS_FIELDS)) {
    if (input[field] === undefined) continue;
    const value = String(input[field] ?? '').trim();
    if (value.length > max) throw invalid(`${field} is too long`);
    if (field === 'name' && !value) throw invalid('Business name is required');
    if (field === 'email' && value && !isEmail(value)) throw invalid('That email address does not look valid.');
    if (field === 'website' && value && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(value)) throw invalid('That website address does not look valid.');
    updates[field] = value || null;
    if (field !== 'name') {
      const key = SOURCE_KEY[field] || field;
      if (value) detailsSource[key] = 'manual';
      else delete detailsSource[key];
    }
  }
  for (const key of Array.isArray(input.verified) ? input.verified : []) {
    if (['phone', 'email', 'website', 'address'].includes(key) && (organization[key === 'address' ? 'addressLine1' : key])) detailsSource[key] = 'verified';
  }
  if (updates.website && !/^https?:\/\//i.test(updates.website)) updates.website = `https://${updates.website}`;
  await organization.update({ ...updates, detailsSource });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.business_updated', targetType: 'Organization', targetId: organization.id, metadata: { fields: Object.keys(updates) }, req: ctx.req,
  });
  return getWorkspace(ctx, opportunityId);
}

async function updateDeal(ctx, opportunityId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const updates = {};
  if (input.title !== undefined) updates.title = String(input.title || '').trim().slice(0, 200) || null;
  if (input.valueCents !== undefined) {
    const value = input.valueCents === null || input.valueCents === '' ? null : Number(input.valueCents);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100000000)) throw invalid('Deal value must be a whole number of cents');
    updates.valueCents = value;
  }
  await opportunity.update(updates);
  return getWorkspace(ctx, opportunityId);
}

function cleanContact(input) {
  const out = {};
  if (input.name !== undefined) {
    out.name = String(input.name || '').trim().slice(0, 255);
    if (!out.name) throw invalid('Contact name is required');
  }
  if (input.title !== undefined) out.title = String(input.title || '').trim().slice(0, 150) || null;
  if (input.email !== undefined) {
    out.email = String(input.email || '').trim().slice(0, 255) || null;
    if (out.email && !isEmail(out.email)) throw invalid('That email address does not look valid.');
  }
  if (input.phone !== undefined) out.phone = String(input.phone || '').trim().slice(0, 50) || null;
  if (input.doNotContact !== undefined) out.doNotContact = Boolean(input.doNotContact);
  if (input.verified !== undefined) out.verifiedAt = input.verified ? new Date() : null;
  return out;
}

async function addContact(ctx, opportunityId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const fields = cleanContact({ name: input.name, ...input });
  const count = await Contact.count({ where: { organizationId: opportunity.organizationId, archivedAt: null, deletedAt: null } });
  await Contact.create({
    ...fields,
    organizationId: opportunity.organizationId,
    agencyOrganizationId: ctx.agencyId,
    source: 'manual',
    isPrimary: count === 0 || Boolean(input.isPrimary),
  });
  if (input.isPrimary && count > 0) {
    const created = await Contact.findOne({ where: { organizationId: opportunity.organizationId }, order: [['createdAt', 'DESC']] });
    await setPrimary(opportunity.organizationId, created.id);
  }
  return getWorkspace(ctx, opportunityId);
}

async function setPrimary(organizationId, contactId) {
  await sequelize.transaction(async (transaction) => {
    await Contact.update({ isPrimary: false }, { where: { organizationId }, transaction });
    await Contact.update({ isPrimary: true }, { where: { organizationId, id: contactId }, transaction });
  });
}

async function loadContact(opportunity, contactId) {
  const contact = await Contact.findOne({ where: { id: contactId, organizationId: opportunity.organizationId, deletedAt: null } });
  if (!contact) throw invalid('Contact not found', 404);
  return contact;
}

async function updateContact(ctx, opportunityId, contactId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const contact = await loadContact(opportunity, contactId);
  await contact.update(cleanContact(input));
  if (input.isPrimary) await setPrimary(opportunity.organizationId, contact.id);
  if (input.archived) await contact.update({ archivedAt: new Date(), isPrimary: false });
  return getWorkspace(ctx, opportunityId);
}

async function addNote(ctx, opportunityId, content) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const text = String(content || '').trim();
  if (!text) throw invalid('Write something first');
  if (text.length > 5000) throw invalid('Notes are limited to 5,000 characters');
  assertNoSecrets(text, 'Note');
  const note = await LeadNote.create({
    organizationId: ctx.agencyId, userId: ctx.userId, leadId: opportunity.sourceLeadId || null, opportunityId, content: text,
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'lead_note.created', targetType: 'LeadNote', targetId: note.id, req: ctx.req,
  });
  return note;
}

function parseNextAction(input) {
  if (!input || !input.at) return null;
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw invalid('Choose a valid date for the next step');
  if (at.getTime() > Date.now() + 366 * 86400000) throw invalid('Next step must be within a year');
  const type = NEXT_ACTION_TYPES.includes(input.type) ? input.type : 'follow_up';
  const note = input.note ? String(input.note).trim().slice(0, 500) : null;
  assertNoSecrets(note, 'Next step note');
  return { nextActionAt: at, nextActionType: type, nextActionNote: note };
}

async function setNextAction(ctx, opportunityId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const next = parseNextAction(input);
  await opportunity.update(next || { nextActionAt: null, nextActionType: null, nextActionNote: null });
  return getWorkspace(ctx, opportunityId);
}

async function applyStage(ctx, opportunity, stage, {
  lostReason, reason, transaction, closeReasonCode,
} = {}) {
  if (!STAGES.includes(stage)) throw invalid('Unknown stage');
  if (stage === opportunity.stage) return;
  if (stage === 'won') throw invalid('A deal becomes Won automatically when its first payment is received. Use “Record payment” for a payment made outside Stripe.');
  if (opportunity.stage === 'won') throw invalid('This deal is already won and paid — start a new deal for this business instead.', 409);
  const from = opportunity.stage;
  const updates = { stage, stageChangedAt: new Date() };
  if (stage === 'lost') {
    const code = CLOSE_REASONS[closeReasonCode] ? closeReasonCode : 'other';
    updates.closeReasonCode = code;
    updates.lostReason = String(lostReason || '').trim().slice(0, 255) || CLOSE_REASONS[code];
    updates.nextActionAt = null;
    updates.nextActionType = null;
    updates.nextActionNote = null;
  } else if (stage === 'nurture') {
    updates.closeReasonCode = CLOSE_REASONS[closeReasonCode] ? closeReasonCode : 'other';
    if (from === 'lost') updates.lostReason = null;
  } else {
    if (from === 'lost') updates.lostReason = null;
    if (from === 'lost' || from === 'nurture') updates.closeReasonCode = null;
  }
  await opportunity.update(updates, transaction ? { transaction } : undefined);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.stage_changed', targetType: 'Opportunity', targetId: opportunity.id, metadata: { from, to: stage, reason: reason || 'manual' }, req: ctx.req,
  });
}

/**
 * A manual stage move. Moving forward (or closing) first checks the
 * stage's requirements and answers 422 with what's missing, so the
 * form can ask for exactly that (ADR 0013). Moving back is always allowed.
 */
async function changeStage(ctx, opportunityId, {
  stage, lostReason, closeReasonCode, revisitAt, revisitNote,
}) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  if (!STAGES.includes(stage)) throw invalid('Unknown stage');
  if (stage === opportunity.stage) return getWorkspace(ctx, opportunityId);
  const checks = isForward(opportunity.stage, stage) || stage === 'lost' || stage === 'nurture';
  const revisit = stage === 'nurture' ? parseNextAction({ at: revisitAt, type: 'follow_up', note: revisitNote || `Revisit — ${CLOSE_REASONS[closeReasonCode] || 'check back in'}` }) : null;
  if (checks && stage !== 'won') {
    const missing = missingForStage(stage, opportunity, { closeReasonCode, revisitAt: revisit?.nextActionAt });
    if (missing.length) {
      throw invalid(`Before moving to ${STAGE_LABELS[stage]}: add ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 422, { missing, code: 'stage_requirements' });
    }
  }
  if (stage === 'lost' && closeReasonCode === 'other' && !String(lostReason || '').trim()) throw invalid('Say briefly why the deal was lost.', 422, { missing: [{ key: 'lostReason', label: 'Details' }], code: 'stage_requirements' });
  await sequelize.transaction(async (transaction) => {
    await applyStage(ctx, opportunity, stage, { lostReason, closeReasonCode, transaction });
    if (revisit) await opportunity.update(revisit, { transaction });
  });
  return getWorkspace(ctx, opportunityId);
}

const QUAL_LIMITS = {
  qualNeed: 2000, qualService: 200, qualDecisionMaker: 200, qualTiming: 200, qualBudget: 200,
};

/** Progressive qualification: any subset of need, service, decision-maker, timing and budget. */
async function updateQualification(ctx, opportunityId, input) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const updates = {};
  for (const [key, max] of Object.entries(QUAL_LIMITS)) {
    if (input[key] === undefined) continue;
    const value = String(input[key] ?? '').trim();
    if (value.length > max) throw invalid(`${QUALIFICATION_FIELDS[key]} is too long (max ${max} characters)`);
    assertNoSecrets(value, QUALIFICATION_FIELDS[key]);
    updates[key] = value || null;
  }
  if (!Object.keys(updates).length) return getWorkspace(ctx, opportunityId);
  await opportunity.update(updates);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.qualification_updated', targetType: 'Opportunity', targetId: opportunity.id, metadata: { fields: Object.keys(updates) }, req: ctx.req,
  });
  return getWorkspace(ctx, opportunityId);
}

async function setDoNotContact(ctx, opportunityId, { doNotContact, reason }) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const on = Boolean(doNotContact);
  await opportunity.update({
    doNotContact: on,
    doNotContactAt: on ? new Date() : null,
    doNotContactReason: on ? (String(reason || '').trim().slice(0, 255) || 'Asked not to be contacted') : null,
    ...(on ? { nextActionAt: null, nextActionType: null, nextActionNote: null } : {}),
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: on ? 'sales.do_not_contact_set' : 'sales.do_not_contact_cleared', targetType: 'Opportunity', targetId: opportunity.id, req: ctx.req,
  });
  return getWorkspace(ctx, opportunityId);
}

/**
 * Updates the lead after any interaction (logged here or sent through a
 * channel): last interaction, reply state, completed follow-ups, and a
 * forward-only stage move.
 */
async function recordInteraction(ctx, opportunity, {
  direction, summary, advanceTo, occurredAt = new Date(), transaction,
}) {
  const updates = { lastInteractionAt: occurredAt, lastInteractionSummary: String(summary || '').slice(0, 255) };
  if (direction === 'inbound') updates.replyNeededSince = opportunity.replyNeededSince || occurredAt;
  else updates.replyNeededSince = null;
  await opportunity.update(updates, transaction ? { transaction } : undefined);
  if (advanceTo && isForward(opportunity.stage, advanceTo) && opportunity.stage !== 'won') {
    await applyStage(ctx, opportunity, advanceTo, { reason: 'outcome', transaction });
  }
}

/**
 * The quick outcome flow: one call saves what happened, applies its
 * effect (stage, do-not-contact, wrong contact) and schedules the next
 * step. A repeated submit with the same key returns the first result.
 */
async function logOutcome(ctx, opportunityId, input) {
  const channel = CHANNELS.includes(input.channel) ? input.channel : 'call';
  const outcome = input.outcome;
  if (!OUTCOMES[outcome]) throw invalid('Choose what happened');
  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 100) : crypto.randomUUID();
  const existing = await OutreachActivity.findOne({ where: { idempotencyKey } });
  if (existing) return getWorkspace(ctx, opportunityId);

  const note = input.note ? String(input.note).trim().slice(0, 5000) : null;
  assertNoSecrets(note, 'Note');
  const next = parseNextAction(input.nextAction);
  const direction = outcome === 'replied' ? 'inbound' : 'outbound';

  try {
    await sequelize.transaction(async (transaction) => {
      const opportunity = await loadOpportunity(ctx, opportunityId, { transaction, lock: true });
      if (opportunity.doNotContact && direction === 'outbound' && outcome !== 'do_not_contact') {
        throw invalid('This business is marked Do Not Contact. Remove the flag first if they asked to be contacted again.', 409);
      }
      if (direction === 'outbound') await claimForOutreach(ctx, opportunity, { confirmOwner: Boolean(input.confirmOwner), transaction });
      let contact = null;
      if (input.contactId) contact = await Contact.findOne({ where: { id: input.contactId, organizationId: opportunity.organizationId, deletedAt: null }, transaction });

      const dueFollowUp = opportunity.nextActionAt && new Date(opportunity.nextActionAt).getTime() <= Date.now() + 12 * 3600 * 1000;
      if (input.activityId) {
        // The outcome of a call placed through Leadzaro: that call record carries it.
        const call = await OutreachActivity.findOne({
          where: {
            id: input.activityId, opportunityId: opportunity.id, organizationId: ctx.agencyId, channel: 'call', origin: 'platform', outcome: null,
          },
          transaction,
        });
        if (!call) throw invalid('That call already has an outcome, or was not found.', 409);
        await call.update({
          outcome, note, completedFollowUp: Boolean(dueFollowUp), contactId: contact?.id || call.contactId,
        }, { transaction });
      } else await OutreachActivity.create({
        organizationId: ctx.agencyId,
        userId: ctx.userId,
        leadId: opportunity.sourceLeadId || null,
        opportunityId: opportunity.id,
        contactId: contact?.id || null,
        type: { email: 'email', call: 'call', in_person: 'visit', linkedin: 'linkedin', sms: 'message', message: 'message' }[channel] || 'other',
        channel,
        direction,
        origin: input.origin === 'external' ? 'external' : 'manual',
        outcome,
        note,
        durationSeconds: Number.isInteger(input.durationSeconds) ? input.durationSeconds : null,
        completedFollowUp: Boolean(dueFollowUp && direction === 'outbound'),
        idempotencyKey,
        occurredAt: new Date(),
      }, { transaction });

      const effect = OUTCOMES[outcome];
      await recordInteraction(ctx, opportunity, {
        direction, summary: `${effect.label} (${channel.replace('_', ' ')})`, advanceTo: effect.advanceTo, transaction,
      });

      if (outcome === 'do_not_contact') {
        await opportunity.update({
          doNotContact: true, doNotContactAt: new Date(), doNotContactReason: note || 'Asked not to be contacted', nextActionAt: null, nextActionType: null, nextActionNote: null,
        }, { transaction });
        if (contact) await contact.update({ doNotContact: true }, { transaction });
        return;
      }
      if (outcome === 'wrong_contact' && contact) await contact.update({ archivedAt: new Date(), isPrimary: false }, { transaction });
      let revisit = null;
      if (outcome === 'not_interested') {
        const code = CLOSE_REASONS[input.closeReasonCode] ? input.closeReasonCode : (input.nurture ? 'bad_timing' : 'not_interested');
        if (input.nurture) {
          await applyStage(ctx, opportunity, 'nurture', { reason: 'outcome', closeReasonCode: code, transaction });
          // A parked deal always has a date to revisit — 90 days unless one was chosen.
          if (!next) revisit = { nextActionAt: new Date(Date.now() + 90 * 86400000), nextActionType: 'follow_up', nextActionNote: `Revisit — ${CLOSE_REASONS[code]}` };
        } else {
          await applyStage(ctx, opportunity, 'lost', {
            lostReason: input.lostReason || CLOSE_REASONS[code], closeReasonCode: code, reason: 'outcome', transaction,
          });
        }
      }
      if (revisit) await opportunity.update(revisit, { transaction });
      else if (next && opportunity.stage !== 'lost') await opportunity.update(next, { transaction });
      else if (dueFollowUp || ['lost'].includes(opportunity.stage)) await opportunity.update({ nextActionAt: null, nextActionType: null, nextActionNote: null }, { transaction });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return getWorkspace(ctx, opportunityId);
    throw err;
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'outreach.created', targetType: 'Opportunity', targetId: opportunityId, metadata: { channel, outcome }, req: ctx.req,
  });
  return getWorkspace(ctx, opportunityId);
}

/** A reply that arrived outside Leadzaro (e.g. in the rep's own inbox), logged by hand. */
async function logReply(ctx, opportunityId, { channel, note, idempotencyKey }) {
  return logOutcome(ctx, opportunityId, {
    channel, outcome: 'replied', note, idempotencyKey,
  });
}

async function markReplyHandled(ctx, opportunityId) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  await opportunity.update({ replyNeededSince: null });
  return getWorkspace(ctx, opportunityId);
}

/** Another deal for the same business (an upsell or a new project). */
async function createAdditionalOpportunity(ctx, opportunityId, { title }) {
  const opportunity = await loadOpportunity(ctx, opportunityId);
  const created = await Opportunity.create({
    organizationId: opportunity.organizationId,
    agencyOrganizationId: ctx.agencyId,
    sourceLeadId: null,
    stage: 'new',
    title: String(title || '').trim().slice(0, 200) || null,
    assignedToUserId: ctx.userId,
    createdByUserId: ctx.userId,
    stageChangedAt: new Date(),
    isTest: opportunity.isTest,
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.created', targetType: 'Opportunity', targetId: created.id, metadata: { fromOpportunityId: opportunityId }, req: ctx.req,
  });
  return { opportunityId: created.id };
}

async function assign(ctx, opportunityId, userId) {
  if (userId === ctx.userId && !ctx.can('leads.assign')) {
    await opportunityService.claim(opportunityId, ctx.agencyId, ctx.userId);
  } else {
    if (!ctx.can('leads.assign')) throw invalid('Only a manager can reassign leads', 403);
    const opportunity = await opportunityService.assign(opportunityId, ctx.agencyId, userId);
    if (userId !== ctx.userId) {
      const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
      await notify({
        userId,
        organizationId: ctx.agencyId,
        type: 'lead_assignment',
        title: `${organization?.name || 'A lead'} was assigned to you`,
        body: `${ctx.user?.name || 'A manager'} assigned this lead to you.`,
        data: { opportunityId },
      }).catch(() => null);
    }
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.assigned', targetType: 'Opportunity', targetId: opportunityId, metadata: { userId }, req: ctx.req,
  });
  return getWorkspace(ctx, opportunityId);
}

module.exports = {
  getWorkspace,
  updateBusiness,
  updateDeal,
  addContact,
  updateContact,
  addNote,
  setNextAction,
  changeStage,
  updateQualification,
  claimForOutreach,
  setDoNotContact,
  logOutcome,
  logReply,
  markReplyHandled,
  recordInteraction,
  createAdditionalOpportunity,
  assign,
  loadOpportunity,
  recommend,
  OPEN_REQUEST,
};
