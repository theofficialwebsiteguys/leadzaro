'use strict';

/**
 * Single source of truth for the sales pipeline (ADR 0011). One stage per
 * opportunity, stored as a short key; follow-up dates, archive and
 * do-not-contact are separate fields, never stages. Stage order is the
 * natural progression — outcomes only ever move a deal forward
 * automatically, and `won` is reachable only through a recorded payment
 * (Stripe-confirmed or an authorized manual payment).
 */
const STAGES = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'won', 'lost', 'nurture'];

const STAGE_LABELS = {
  new: 'New',
  contacting: 'Contacting',
  qualified: 'Interested / Qualified',
  proposal: 'Meeting / Proposal',
  awaiting_payment: 'Awaiting Payment',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
};

const CLOSED_STAGES = new Set(['won', 'lost']);
// The forward path a deal travels; lost/nurture sit outside it.
const PROGRESSION = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'won'];

/**
 * The pre-ADR-0011 stage names, mapped once by migration. The original
 * value is kept in Opportunity.legacyStage so no history is lost.
 */
const LEGACY_STAGE_TO_STAGE = {
  Discovered: 'new',
  'New Lead': 'new',
  Researching: 'new',
  'Attempting Contact': 'contacting',
  Contacted: 'contacting',
  Engaged: 'qualified',
  Qualified: 'qualified',
  'Proposal or Offer Prepared': 'proposal',
  'Payment Link Sent': 'awaiting_payment',
  'Closed Won': 'won',
  'Closed Lost': 'lost',
  Nurture: 'nurture',
  'Do Not Contact': 'lost',
};

/** Maps a legacy SavedLead.status value to a stage (Phase 2 backfill). */
const LEGACY_STATUS_TO_STAGE = {
  New: 'new',
  Saved: 'new',
  Contacted: 'contacting',
  'Follow Up': 'qualified',
  Interested: 'qualified',
  'Not Interested': 'lost',
  Closed: 'won',
  Archived: 'nurture',
};

const OUTCOMES = {
  no_answer: { label: 'No answer', advanceTo: 'contacting', connected: false },
  voicemail: { label: 'Left voicemail', advanceTo: 'contacting', connected: false },
  connected: { label: 'Connected', advanceTo: 'contacting', connected: true },
  interested: { label: 'Interested', advanceTo: 'qualified', connected: true },
  meeting_arranged: { label: 'Meeting arranged', advanceTo: 'proposal', connected: true },
  not_interested: { label: 'Not interested', advanceTo: null, connected: true },
  wrong_contact: { label: 'Wrong contact', advanceTo: null, connected: false },
  do_not_contact: { label: 'Do not contact', advanceTo: null, connected: true },
  sent: { label: 'Sent', advanceTo: 'contacting', connected: false },
  replied: { label: 'Replied', advanceTo: 'contacting', connected: true },
  // Guided workflow (ADR 0016): an email sent outside Leadzaro, and "not now".
  email_sent: { label: 'Email sent — awaiting reply', advanceTo: 'contacting', connected: false },
  not_now: { label: 'Not now', advanceTo: null, connected: true },
  // ADR 0017: they asked for information, and "not a business we can help" (disqualify).
  info_requested: { label: 'Asked for information', advanceTo: 'contacting', connected: true },
  not_a_fit: { label: 'Not a fit for us', advanceTo: null, connected: false },
};

/** How warm a lead is — tracked apart from the stage; a qualified lead is not automatically interested. */
const INTEREST_LEVELS = ['unknown', 'cold', 'warm', 'hot'];

/**
 * Qualification progress (ADR 0016), kept apart from the sales stage. null
 * means the lead never went through qualification (legacy or added by
 * sales directly). Only `assigned` (and null) leads are in sales queues.
 */
const QUALIFICATION_STATUSES = ['draft', 'needs_research', 'needs_correction', 'needs_review', 'ready', 'assigned', 'unsuitable'];
const QUALIFICATION_LABELS = {
  draft: 'Research in progress',
  needs_research: 'Needs more information',
  needs_correction: 'Returned for correction',
  // ADR 0017: saved as a separate record while a manager checks a possible duplicate.
  needs_review: 'Possible duplicate — being checked',
  ready: 'Ready for assignment',
  assigned: 'Assigned to sales',
  unsuitable: 'Not suitable',
};
const IN_QUALIFICATION = ['draft', 'needs_research', 'needs_correction', 'needs_review', 'ready'];

/**
 * Where the relationship stands (ADR 0017), derived from the fields that
 * already exist — qualification progress, stage and client status — so it
 * never drifts from them. What happened on a call is an activity outcome
 * and what happens next is the next action; neither is a lifecycle stage.
 * Do-not-contact is a separate restriction shown alongside, never a stage.
 */
const LIFECYCLE_LABELS = {
  research: 'Research',
  needs_info: 'Needs information',
  needs_review: 'Duplicate check',
  ready: 'Qualified — ready for outreach',
  active: 'Active outreach',
  opportunity: 'Interested',
  nurture: 'Nurture / on hold',
  client: 'Won — client',
  lost: 'Closed lost',
  disqualified: 'Disqualified',
};

function lifecycleOf(opportunity, { isClient = false } = {}) {
  const o = opportunity;
  if (isClient || o.stage === 'won') return 'client';
  if (['draft', 'needs_correction'].includes(o.qualificationStatus)) return 'research';
  if (o.qualificationStatus === 'needs_research') return 'needs_info';
  if (o.qualificationStatus === 'needs_review') return 'needs_review';
  if (o.qualificationStatus === 'unsuitable') return 'disqualified';
  if (o.qualificationStatus === 'ready') return 'ready';
  if (o.stage === 'lost') return o.closeReasonCode === 'not_a_fit' ? 'disqualified' : 'lost';
  if (o.stage === 'nurture') return 'nurture';
  if (['qualified', 'proposal', 'awaiting_payment'].includes(o.stage)) return 'opportunity';
  if (o.stage === 'contacting' || o.lastInteractionAt) return 'active';
  return 'ready';
}

const CHANNELS = ['email', 'sms', 'call', 'in_person', 'linkedin', 'message', 'other'];
const NEXT_ACTION_TYPES = ['call', 'email', 'text', 'follow_up', 'meeting', 'send_offer', 'payment_follow_up', 'handoff', 'other'];

/**
 * What each stage means and what must be known before a person moves a
 * deal into it by hand (ADR 0013). Logged outcomes and payments still
 * move deals forward on their own; requirements only guard manual moves,
 * so the pipeline stays honest without slowing down quick logging.
 */
const QUALIFICATION_FIELDS = {
  qualNeed: 'Their need or problem',
  qualService: 'Service that fits',
  qualDecisionMaker: 'Decision-maker',
  qualTiming: 'Timing',
  qualBudget: 'Budget',
};

const STAGE_GUIDE = {
  new: { meaning: 'Found, not contacted yet.', exit: 'Make first contact.', requires: [] },
  contacting: { meaning: 'Reaching out or talking — not qualified yet.', exit: 'Learn their need and whether they’re interested.', requires: [] },
  qualified: { meaning: 'Interested, with a real need we can meet.', exit: 'Book a meeting or prepare an offer.', requires: ['qualNeed'] },
  proposal: { meaning: 'Meeting held or offer being prepared and sent.', exit: 'Get a yes, then send a payment link.', requires: ['qualNeed', 'qualService', 'qualDecisionMaker'] },
  awaiting_payment: { meaning: 'They agreed; waiting for the first payment.', exit: 'The first payment moves it to Won automatically.', requires: ['qualNeed', 'qualService', 'qualDecisionMaker', 'qualBudget'] },
  won: { meaning: 'First payment received (Stripe or recorded manually).', exit: 'Complete the handoff to the client team.', requires: [] },
  lost: { meaning: 'Not going ahead — with a recorded reason.', exit: '', requires: ['closeReason'] },
  nurture: { meaning: 'Not now, but worth revisiting on a set date.', exit: 'Check back on the revisit date.', requires: ['closeReason', 'revisitDate'] },
};

/** Structured reasons a deal was lost or parked, so reports can count them. */
const CLOSE_REASONS = {
  not_interested: 'Not interested',
  no_budget: 'No budget / too expensive',
  chose_competitor: 'Went with someone else',
  has_website: 'Happy with their current website',
  bad_timing: 'Bad timing — maybe later',
  no_response: 'Never responded',
  not_a_fit: 'Not a fit for us',
  out_of_business: 'Closed / out of business',
  do_not_contact: 'Asked not to be contacted',
  duplicate: 'Duplicate lead',
  other: 'Other',
};
const NURTURE_REASONS = ['bad_timing', 'no_budget', 'has_website', 'no_response', 'not_interested', 'other'];

/**
 * Days without any recorded activity after which an open deal counts as
 * stalled, per stage. Warm deals cool fastest; nurture is parked on
 * purpose and never stalls.
 */
const STALL_DAYS = {
  new: 7, contacting: 10, qualified: 7, proposal: 7, awaiting_payment: 4,
};

function stageRank(stage) {
  return PROGRESSION.indexOf(stage);
}

/** Days since the last real activity on a deal (interaction, stage change or creation). */
function daysIdle(opportunity, now = Date.now()) {
  const times = [opportunity.lastInteractionAt, opportunity.stageChangedAt, opportunity.createdAt]
    .filter(Boolean).map((d) => new Date(d).getTime());
  if (!times.length) return null;
  return Math.floor((now - Math.max(...times)) / 86400000);
}

/** SQL condition for a stalled deal on table alias `alias` (catalog numbers only, never user input). */
function stalledSql(alias) {
  const a = `"${alias}"`;
  const cases = Object.entries(STALL_DAYS).map(([s, d]) => `WHEN '${s}' THEN ${Number(d)}`).join(' ');
  return `${a}."stage" IN (${Object.keys(STALL_DAYS).map((s) => `'${s}'`).join(', ')})
    AND GREATEST(COALESCE(${a}."lastInteractionAt", 'epoch'), COALESCE(${a}."stageChangedAt", 'epoch'), ${a}."createdAt")
      < NOW() - (CASE ${a}."stage" ${cases} END) * INTERVAL '1 day'`;
}

/** Stalled details for an open deal, or null. */
function stallInfo(opportunity, now = Date.now()) {
  const limit = STALL_DAYS[opportunity.stage];
  if (!limit || opportunity.archivedAt || opportunity.doNotContact) return null;
  const idle = daysIdle(opportunity, now);
  if (idle === null || idle < limit) return null;
  return { days: idle, limit, label: `No activity for ${idle} days` };
}

/** Qualification and reason requirements not yet met for a manual move into `stage`. */
function missingForStage(stage, opportunity, { closeReasonCode, revisitAt } = {}) {
  const guide = STAGE_GUIDE[stage];
  if (!guide) return [];
  const missing = [];
  for (const key of guide.requires) {
    if (key === 'closeReason') {
      if (!closeReasonCode || !CLOSE_REASONS[closeReasonCode]) missing.push({ key, label: 'Reason' });
    } else if (key === 'revisitDate') {
      if (!revisitAt) missing.push({ key, label: 'Date to revisit' });
    } else if (!String(opportunity[key] || '').trim()) {
      missing.push({ key, label: QUALIFICATION_FIELDS[key] });
    }
  }
  return missing;
}

/** True when moving from `from` to `to` is a step forward on the main path. */
function isForward(from, to) {
  const a = stageRank(from);
  const b = stageRank(to);
  if (b < 0) return false;
  if (a < 0) return from === 'nurture';
  return b > a;
}

/** Sequelize condition: leads that belong in sales views (not still being qualified). */
function inSalesWhere() {
  // eslint-disable-next-line global-require
  const { Op } = require('sequelize');
  return { [Op.or]: [{ qualificationStatus: null }, { qualificationStatus: 'assigned' }] };
}

module.exports = {
  INTEREST_LEVELS,
  QUALIFICATION_STATUSES,
  QUALIFICATION_LABELS,
  IN_QUALIFICATION,
  LIFECYCLE_LABELS,
  lifecycleOf,
  inSalesWhere,
  STAGES,
  STAGE_LABELS,
  CLOSED_STAGES,
  PROGRESSION,
  LEGACY_STAGE_TO_STAGE,
  LEGACY_STATUS_TO_STAGE,
  OUTCOMES,
  CHANNELS,
  NEXT_ACTION_TYPES,
  QUALIFICATION_FIELDS,
  STAGE_GUIDE,
  CLOSE_REASONS,
  NURTURE_REASONS,
  STALL_DAYS,
  stageRank,
  isForward,
  daysIdle,
  stallInfo,
  stalledSql,
  missingForStage,
};
