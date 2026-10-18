'use strict';

const {
  sequelize, Opportunity, Organization, Contact, OutreachActivity, User, SalesHandoff,
} = require('../../models');
const { OUTCOMES } = require('../../core/crm/pipelineCatalog');
const handoffService = require('./handoffService');
const { invalid } = require('./salesCommon');

/**
 * Client onboarding (ADR 0016). After an admin approves a sale, the client
 * manager it was assigned to works the handoff checklist here: business
 * details, contacts, branding, content, requirements and access. A client
 * manager sees only the onboardings assigned to them; admins see all.
 */

const USER_ATTRS = ['id', 'name'];

function seesAll(ctx) {
  return ctx.can('sales.approve_close') || ctx.can('team.review_work');
}

async function loadAssigned(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    include: [
      { model: Organization, as: 'organization' },
      { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      { model: User, as: 'qualifiedBy', attributes: USER_ATTRS },
      { model: User, as: 'clientManager', attributes: USER_ATTRS },
    ],
  });
  if (!opportunity || (!seesAll(ctx) && opportunity.clientManagerUserId !== ctx.userId)) throw invalid('Onboarding not found', 404);
  return opportunity;
}

async function getOnboarding(ctx, opportunityId) {
  const opportunity = await loadAssigned(ctx, opportunityId);
  const organization = opportunity.organization;
  const [handoff, contacts, activities] = await Promise.all([
    handoffService.getForOpportunity(ctx.agencyId, opportunityId),
    Contact.findAll({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] }),
    OutreachActivity.findAll({
      where: { organizationId: ctx.agencyId, opportunityId, deletedAt: null, archivedAt: null },
      include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
      order: [['createdAt', 'DESC']],
      limit: 30,
    }),
  ]);
  return {
    opportunityId,
    clientId: organization.type === 'client' ? organization.id : null,
    business: {
      name: organization.name,
      phone: organization.phone,
      email: organization.email,
      website: organization.website,
      facebookUrl: organization.facebookUrl,
      addressLine1: organization.addressLine1,
      city: organization.city,
      state: organization.state,
      postalCode: organization.postalCode,
      category: organization.category,
    },
    contacts: contacts.map((c) => ({
      id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, isPrimary: c.isPrimary,
    })),
    sale: {
      title: opportunity.title,
      outreachReason: opportunity.outreachReason,
      need: opportunity.qualNeed,
      service: opportunity.qualService,
      decisionMaker: opportunity.qualDecisionMaker,
      timing: opportunity.qualTiming,
      proposal: opportunity.proposal,
      approvedAt: opportunity.closingReviewedAt || opportunity.wonAt,
      exception: opportunity.closingException,
      salesperson: opportunity.assignedTo,
      qualifiedBy: opportunity.qualifiedBy,
      clientManager: opportunity.clientManager,
    },
    history: activities.map((a) => ({
      id: a.id,
      channel: a.channel || a.type,
      direction: a.direction,
      outcomeLabel: a.outcome ? OUTCOMES[a.outcome]?.label || a.outcome : null,
      subject: a.subject,
      note: a.note,
      at: a.occurredAt || a.createdAt,
      user: a.user,
    })),
    handoff,
    canEdit: Boolean(handoff && handoff.status !== 'failed'),
  };
}

async function save(ctx, opportunityId, input, { complete = false } = {}) {
  await loadAssigned(ctx, opportunityId);
  await handoffService.update(ctx, opportunityId, input, { complete });
  return getOnboarding(ctx, opportunityId);
}

/** New and in-progress onboardings, and the clients this person looks after. */
async function listForMe(ctx) {
  const where = { agencyOrganizationId: ctx.agencyId, status: ['pending', 'needs_info', 'failed'] };
  const handoffs = await SalesHandoff.findAll({
    where,
    include: [{
      model: Opportunity,
      as: 'opportunity',
      where: { deletedAt: null, ...(seesAll(ctx) ? {} : { clientManagerUserId: ctx.userId }) },
      include: [{ model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state'] }, { model: User, as: 'clientManager', attributes: USER_ATTRS }],
    }],
    order: [['createdAt', 'ASC']],
    limit: 100,
  });
  // ClientProfile is visibility-guarded; this read is pinned to the agency and the user.
  const [clients] = await sequelize.query(
    `SELECT o.id, o.name, p."nextActionAt", p."nextActionNote", p."waitingOn"
       FROM "ClientProfiles" p JOIN "Organizations" o ON o.id = p."organizationId"
      WHERE p."agencyOrganizationId" = :agencyId AND p."accountManagerUserId" = :userId AND o."deletedAt" IS NULL AND p."clientEndedAt" IS NULL
      ORDER BY p."nextActionAt" ASC NULLS LAST, o.name ASC LIMIT 50`,
    { replacements: { agencyId: ctx.agencyId, userId: ctx.userId } },
  );
  const card = (h) => ({
    opportunityId: h.opportunityId,
    businessName: h.opportunity?.organization?.name,
    city: h.opportunity?.organization?.city,
    state: h.opportunity?.organization?.state,
    status: h.status,
    missingEssential: (h.items || []).filter((i) => i.essential && !i.done).length,
    openItems: (h.items || []).filter((i) => !i.done).length,
    clientManager: h.opportunity?.clientManager,
    startedAt: h.startedAt || h.createdAt,
    error: h.lastError,
  });
  const recent = Date.now() - 3 * 86400000;
  return {
    newHandoffs: handoffs.filter((h) => new Date(h.createdAt).getTime() >= recent && h.status !== 'failed').map(card),
    incomplete: handoffs.filter((h) => new Date(h.createdAt).getTime() < recent || h.status === 'failed').map(card),
    clients,
  };
}

module.exports = { getOnboarding, save, listForMe };
