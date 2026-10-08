'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, User, PaymentLinkRequest, Contact,
} = require('../../models');
const {
  STAGES, STAGE_LABELS, stallInfo, stalledSql,
} = require('../../core/crm/pipelineCatalog');
const { dayBounds } = require('./todayService');
const { effectiveOffset } = require('../../core/workspace/timezone');

/**
 * The Leads list and pipeline board (ADR 0011): one row per deal with
 * the facts a salesperson needs at a glance — owner, value, last
 * interaction and next action. Archived and do-not-contact leads have
 * their own views instead of hiding in a stage.
 */
async function listLeads(ctx, query = {}) {
  const where = { agencyOrganizationId: ctx.agencyId, deletedAt: null };
  const view = query.view || 'active';
  if (view === 'archived') where.archivedAt = { [Op.ne]: null };
  else {
    where.archivedAt = null;
    where.doNotContact = view === 'dnc';
  }
  if (query.stage === 'open') where.stage = { [Op.notIn]: ['won', 'lost'] };
  else if (STAGES.includes(query.stage)) where.stage = query.stage;

  if (query.owner === 'me') where.assignedToUserId = ctx.userId;
  else if (query.owner === 'unassigned') where.assignedToUserId = null;
  else if (query.owner && query.owner !== 'all') where.assignedToUserId = query.owner;

  const { start, end } = dayBounds(effectiveOffset(ctx.timezone, query.tzOffset));
  if (query.due === 'overdue') where.nextActionAt = { [Op.lt]: start };
  else if (query.due === 'today') where.nextActionAt = { [Op.gte]: start, [Op.lt]: end };
  else if (query.due === 'none') where.nextActionAt = null;
  if (query.due === 'reply') where.replyNeededSince = { [Op.ne]: null };
  if (query.due === 'stalled') where[Op.and] = [sequelize.literal(stalledSql('Opportunity'))];
  if (query.includeTest !== 'true') where.isTest = false;

  const orgWhere = {};
  if (query.q) {
    const text = `%${String(query.q).trim().slice(0, 100)}%`;
    orgWhere[Op.or] = [{ name: { [Op.iLike]: text } }, { city: { [Op.iLike]: text } }, { category: { [Op.iLike]: text } }, { phone: { [Op.iLike]: text } }, { email: { [Op.iLike]: text } }];
  }

  const board = query.layout === 'board';
  const limit = board ? 500 : Math.min(100, Number(query.limit) || 25);
  const page = Math.max(1, Number(query.page) || 1);
  const sorts = {
    next: [[sequelize.literal('"Opportunity"."nextActionAt" IS NULL'), 'ASC'], ['nextActionAt', 'ASC']],
    recent: [['updatedAt', 'DESC']],
    value: [['valueCents', 'DESC NULLS LAST']],
    name: [[{ model: Organization, as: 'organization' }, 'name', 'ASC']],
    last: [['lastInteractionAt', 'DESC NULLS LAST']],
  };

  const { rows, count } = await Opportunity.findAndCountAll({
    where,
    include: [
      {
        model: Organization, as: 'organization', attributes: ['id', 'name', 'type', 'phone', 'email', 'website', 'city', 'state', 'category'], where: query.q ? orgWhere : undefined,
      },
      { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
    ],
    order: [...(sorts[query.sort] || sorts.next), ['id', 'ASC']],
    limit,
    offset: board ? 0 : (page - 1) * limit,
    distinct: true,
    // Only one-to-one includes, so no row multiplication: keep ordering on joined columns simple.
    subQuery: false,
  });

  const ids = rows.map((r) => r.id);
  const [requests, contactCounts] = await Promise.all([
    ids.length ? PaymentLinkRequest.findAll({
      where: { opportunityId: ids, status: ['created', 'sent', 'processing', 'paid', 'failed'] }, attributes: ['opportunityId', 'status', 'createdAt'], order: [['createdAt', 'DESC']],
    }) : [],
    rows.length ? Contact.findAll({
      where: { organizationId: rows.map((r) => r.organizationId), archivedAt: null, deletedAt: null },
      attributes: ['organizationId', 'email', 'phone'],
    }) : [],
  ]);

  const items = rows.map((o) => {
    const request = requests.find((r) => r.opportunityId === o.id);
    const contacts = contactCounts.filter((c) => c.organizationId === o.organizationId);
    return {
      opportunityId: o.id,
      organizationId: o.organizationId,
      businessName: o.organization?.name,
      title: o.title,
      city: o.organization?.city,
      category: o.organization?.category,
      isClient: o.organization?.type === 'client',
      stage: o.stage,
      stageLabel: STAGE_LABELS[o.stage] || o.stage,
      assignedTo: o.assignedTo ? { id: o.assignedTo.id, name: o.assignedTo.name } : null,
      valueCents: o.valueCents,
      currency: o.currency || 'usd',
      lastInteractionAt: o.lastInteractionAt,
      lastInteractionSummary: o.lastInteractionSummary,
      nextActionAt: o.nextActionAt,
      nextActionType: o.nextActionType,
      nextActionNote: o.nextActionNote,
      replyNeededSince: o.replyNeededSince,
      doNotContact: o.doNotContact,
      archivedAt: o.archivedAt,
      isTest: o.isTest,
      hasPhone: Boolean(o.organization?.phone || contacts.some((c) => c.phone)),
      hasEmail: Boolean(o.organization?.email || contacts.some((c) => c.email)),
      website: o.organization?.website || null,
      paymentStatus: request?.status || null,
      stall: stallInfo(o),
    };
  });
  return {
    items,
    total: count,
    page,
    limit,
    totalPages: board ? 1 : Math.max(1, Math.ceil(count / limit)),
  };
}

module.exports = { listLeads };
