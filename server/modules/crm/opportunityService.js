'use strict';

const crypto = require('node:crypto');
const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Lead, OrganizationMembership, MembershipRole, Role, User,
} = require('../../models');
const { STAGES, CLOSED_STAGES } = require('../../core/crm/pipelineCatalog');

const SALES_CAPABLE_ROLE_KEYS = ['sales_representative', 'sales_manager', 'administrator'];

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'prospect';
}

/**
 * Creates a new prospect Organization + Opportunity for the given agency,
 * upserting the canonical Lead the same way saveLead() already does.
 * Rejects if an active Opportunity already exists for this
 * (agency, lead) pair — the DB-level partial unique index backs this up,
 * but a pre-check gives a clean 409 instead of a raw constraint error.
 */
async function createFromLead({
  agencyOrganizationId, leadData, assignedToUserId, actorUserId,
}) {
  const leadDefaults = { ...leadData };
  delete leadDefaults.id;
  delete leadDefaults.isSaved;

  let lead;
  if (leadDefaults.googlePlaceId) {
    [lead] = await Lead.findOrCreate({ where: { googlePlaceId: leadDefaults.googlePlaceId }, defaults: leadDefaults });
  } else {
    lead = await Lead.create(leadDefaults);
  }

  const existing = await Opportunity.findOne({
    where: { agencyOrganizationId, sourceLeadId: lead.id, archivedAt: null, deletedAt: null },
  });
  if (existing) throw invalid('An active opportunity already exists for this business', 409);

  return sequelize.transaction(async (transaction) => {
    const orgId = crypto.randomUUID();
    const prospectOrg = await Organization.create({
      id: orgId,
      name: lead.name,
      slug: `prospect-${slugify(lead.name)}-${orgId.slice(0, 8)}`,
      type: 'prospect',
      status: 'active',
      managingAgencyOrganizationId: agencyOrganizationId,
    }, { transaction });

    const opportunity = await Opportunity.create({
      organizationId: prospectOrg.id,
      agencyOrganizationId,
      sourceLeadId: lead.id,
      stage: STAGES[0],
      assignedToUserId: assignedToUserId || actorUserId,
    }, { transaction });

    return { opportunity, organization: prospectOrg, lead };
  });
}

function listForAgency(agencyOrganizationId, {
  stage, assignedToUserId, archived, limit = 20, offset = 0,
} = {}) {
  const where = { agencyOrganizationId, deletedAt: null };
  where.archivedAt = archived === 'true' ? { [Op.ne]: null } : null;
  if (stage) where.stage = stage;
  if (assignedToUserId) where.assignedToUserId = assignedToUserId;

  return Opportunity.findAndCountAll({
    where,
    include: [
      { model: Organization, as: 'organization' },
      { model: User, as: 'assignedTo', attributes: ['id', 'name', 'email'] },
    ],
    order: [['updatedAt', 'DESC']],
    limit,
    offset,
  });
}

async function getInAgency(id, agencyOrganizationId) {
  const opportunity = await Opportunity.findOne({
    where: { id, agencyOrganizationId, deletedAt: null },
    include: [
      { model: Organization, as: 'organization' },
      { model: Lead, as: 'sourceLead' },
      { model: User, as: 'assignedTo', attributes: ['id', 'name', 'email'] },
    ],
  });
  if (!opportunity) throw invalid('Opportunity not found', 404);
  return opportunity;
}

async function updateStage(id, agencyOrganizationId, { stage, score, scoreReason }) {
  const opportunity = await getInAgency(id, agencyOrganizationId);
  if (stage && !STAGES.includes(stage)) throw invalid('Unknown pipeline stage');
  await opportunity.update({
    stage: stage || opportunity.stage,
    score: score === undefined ? opportunity.score : score,
    scoreReason: scoreReason === undefined ? opportunity.scoreReason : scoreReason,
  });
  return opportunity;
}

async function claim(id, agencyOrganizationId, userId) {
  const opportunity = await getInAgency(id, agencyOrganizationId);
  if (opportunity.assignedToUserId) throw invalid('This opportunity is already assigned', 409);
  await opportunity.update({ assignedToUserId: userId });
  return opportunity;
}

async function assign(id, agencyOrganizationId, targetUserId) {
  const opportunity = await getInAgency(id, agencyOrganizationId);
  const membership = await OrganizationMembership.findOne({
    where: {
      organizationId: agencyOrganizationId, userId: targetUserId, status: 'active', deletedAt: null,
    },
  });
  if (!membership) throw invalid('That user is not an active member of your organization', 422);
  await opportunity.update({ assignedToUserId: targetUserId });
  return opportunity;
}

/**
 * Assigns to whichever eligible (sales-capable, active) employee in the
 * agency currently has the fewest active Opportunities — a stateless
 * load-balancing interpretation of "round-robin" that needs no persisted
 * rotation cursor.
 */
async function roundRobinAssign(id, agencyOrganizationId) {
  const opportunity = await getInAgency(id, agencyOrganizationId);

  const memberships = await OrganizationMembership.findAll({
    where: {
      organizationId: agencyOrganizationId, membershipType: 'employee', status: 'active', deletedAt: null,
    },
    include: [{ model: Role, as: 'roles', where: { key: SALES_CAPABLE_ROLE_KEYS }, attributes: [] }],
  });
  const eligibleUserIds = [...new Set(memberships.map((m) => m.userId))];
  if (eligibleUserIds.length === 0) throw invalid('No eligible employees to assign to', 422);

  const counts = await Opportunity.findAll({
    where: {
      agencyOrganizationId,
      assignedToUserId: eligibleUserIds,
      archivedAt: null,
      deletedAt: null,
      // Closed opportunities are no longer open work — counting them
      // toward "load" would make a rep's past wins/losses make them look
      // busier than they are and starve them of new assignments.
      stage: { [Op.notIn]: [...CLOSED_STAGES] },
    },
    attributes: ['assignedToUserId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['assignedToUserId'],
    raw: true,
  });
  const countByUserId = new Map(counts.map((c) => [c.assignedToUserId, Number(c.count)]));

  let winner = eligibleUserIds[0];
  let winnerCount = countByUserId.get(winner) || 0;
  for (const userId of eligibleUserIds) {
    const c = countByUserId.get(userId) || 0;
    if (c < winnerCount) {
      winner = userId;
      winnerCount = c;
    }
  }

  await opportunity.update({ assignedToUserId: winner });
  return opportunity;
}

async function archive(id, agencyOrganizationId) {
  const opportunity = await getInAgency(id, agencyOrganizationId);
  await opportunity.update({ archivedAt: new Date() });
  return opportunity;
}

async function restore(id, agencyOrganizationId) {
  const opportunity = await getInAgency(id, agencyOrganizationId);
  if (!opportunity.archivedAt) throw invalid('Opportunity is not archived');
  // A merged-away opportunity must go through undo-merge, which also
  // moves its Contacts/Locations back and restores prior stage/score —
  // plain restore would unarchive it while leaving those behind.
  if (opportunity.mergedIntoOpportunityId) {
    throw invalid('This opportunity was merged into another one — use undo-merge to restore it', 409);
  }
  const conflict = await Opportunity.findOne({
    where: {
      agencyOrganizationId, sourceLeadId: opportunity.sourceLeadId, archivedAt: null, deletedAt: null, id: { [Op.ne]: opportunity.id },
    },
  });
  if (conflict) throw invalid('An active opportunity already exists for this business', 409);
  await opportunity.update({ archivedAt: null });
  return opportunity;
}

module.exports = {
  createFromLead,
  listForAgency,
  getInAgency,
  updateStage,
  claim,
  assign,
  roundRobinAssign,
  archive,
  restore,
};
