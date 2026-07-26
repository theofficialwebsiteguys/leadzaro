'use strict';

const {
  sequelize, Opportunity, Organization, Contact, Location, AuditLog,
} = require('../../models');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function getActiveOpportunity(id, agencyOrganizationId) {
  const opportunity = await Opportunity.findOne({
    where: { id, agencyOrganizationId, deletedAt: null },
    include: [{ model: Organization, as: 'organization' }],
  });
  if (!opportunity) throw invalid('Opportunity not found', 404);
  return opportunity;
}

/**
 * Duplicate detection, Phase 2 scope: exact-normalized-business-name
 * matching within one agency's active opportunities. Fuzzy/enrichment-
 * assisted matching (address/phone similarity, external data) is
 * deferred — see docs/leadzaro/current-phase-plan.md backlog. This is
 * still directly useful: the most common real duplicate is the same
 * business re-entered manually or found again as a second Google Place
 * record with a different id.
 */
async function findPossibleDuplicates(agencyOrganizationId) {
  const opportunities = await Opportunity.findAll({
    where: { agencyOrganizationId, archivedAt: null, deletedAt: null },
    include: [{ model: Organization, as: 'organization' }],
    order: [['createdAt', 'ASC']],
  });

  const groups = new Map();
  for (const opp of opportunities) {
    const key = normalizeName(opp.organization.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(opp);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      name: group[0].organization.name,
      opportunities: group.map((o) => ({
        id: o.id, organizationId: o.organizationId, stage: o.stage, createdAt: o.createdAt,
      })),
    }));
}

async function previewMerge(winnerId, loserId, agencyOrganizationId) {
  const winner = await getActiveOpportunity(winnerId, agencyOrganizationId);
  const loser = await getActiveOpportunity(loserId, agencyOrganizationId);
  if (winner.id === loser.id) throw invalid('Cannot merge an opportunity into itself');
  // getActiveOpportunity only excludes deleted rows (undoMerge needs to
  // look up an already-archived loser), so archived-but-not-merged is
  // still possible here and must be rejected explicitly. The
  // already-merged case is checked first so it gets its more specific
  // 409 rather than the generic "already archived" 422 — merging always
  // archives, so every already-merged loser is also archived.
  if (winner.archivedAt) throw invalid('Cannot merge into an archived opportunity', 422);
  if (loser.mergedIntoOpportunityId) throw invalid('That opportunity has already been merged into another one', 409);
  if (loser.archivedAt) throw invalid('This opportunity is already archived', 422);

  const [winnerContacts, loserContacts, winnerLocations, loserLocations] = await Promise.all([
    Contact.findAll({ where: { organizationId: winner.organizationId, archivedAt: null, deletedAt: null } }),
    Contact.findAll({ where: { organizationId: loser.organizationId, archivedAt: null, deletedAt: null } }),
    Location.findAll({ where: { organizationId: winner.organizationId, archivedAt: null, deletedAt: null } }),
    Location.findAll({ where: { organizationId: loser.organizationId, archivedAt: null, deletedAt: null } }),
  ]);

  return {
    winner, loser, winnerContacts, loserContacts, winnerLocations, loserLocations,
  };
}

/**
 * Merges `loser` into `winner`: moves the loser's active Contacts/
 * Locations onto the winner's prospect Organization, archives the loser
 * (never deletes), and records a full audit snapshot — including exactly
 * which contact/location rows moved — so undoMerge can reverse it later
 * without guessing.
 */
async function merge(winnerId, loserId, agencyOrganizationId, actorUserId, reason) {
  const { winner, loser } = await previewMerge(winnerId, loserId, agencyOrganizationId);

  return sequelize.transaction(async (transaction) => {
    const movedContacts = await Contact.findAll({
      where: { organizationId: loser.organizationId, archivedAt: null, deletedAt: null }, transaction,
    });
    const movedLocations = await Location.findAll({
      where: { organizationId: loser.organizationId, archivedAt: null, deletedAt: null }, transaction,
    });
    const movedContactIds = movedContacts.map((c) => c.id);
    const movedLocationIds = movedLocations.map((l) => l.id);

    if (movedContactIds.length) {
      await Contact.update(
        { organizationId: winner.organizationId, agencyOrganizationId },
        { where: { id: movedContactIds }, transaction }
      );
    }
    if (movedLocationIds.length) {
      await Location.update(
        { organizationId: winner.organizationId, agencyOrganizationId },
        { where: { id: movedLocationIds }, transaction }
      );
    }

    const priorState = {
      stage: loser.stage, score: loser.score, scoreReason: loser.scoreReason,
    };

    await loser.update({ archivedAt: new Date(), mergedIntoOpportunityId: winner.id }, { transaction });

    await AuditLog.create({
      organizationId: agencyOrganizationId,
      actorUserId,
      action: 'opportunity.merged',
      targetType: 'Opportunity',
      targetId: loser.id,
      metadata: {
        winnerOpportunityId: winner.id,
        reason,
        movedContactIds,
        movedLocationIds,
        priorState,
      },
    }, { transaction });

    return {
      winner, loser, movedContactIds, movedLocationIds,
    };
  });
}

async function undoMerge(loserId, agencyOrganizationId, actorUserId) {
  const loser = await getActiveOpportunity(loserId, agencyOrganizationId);
  if (!loser.mergedIntoOpportunityId) throw invalid('This opportunity was not merged into another one');

  const mergeEntry = await AuditLog.findOne({
    where: { action: 'opportunity.merged', targetId: loser.id },
    order: [['createdAt', 'DESC']],
  });
  // Without this entry there is no reliable record of what moved or
  // what the prior stage/score were — proceeding anyway would silently
  // unarchive the opportunity while leaving its Contacts/Locations
  // stranded on the winner, and report success regardless.
  if (!mergeEntry) throw invalid('Merge audit record not found; cannot safely undo this merge', 409);

  const movedContactIds = mergeEntry?.metadata?.movedContactIds || [];
  const movedLocationIds = mergeEntry?.metadata?.movedLocationIds || [];
  const priorState = mergeEntry?.metadata?.priorState || {};

  return sequelize.transaction(async (transaction) => {
    if (movedContactIds.length) {
      await Contact.update(
        { organizationId: loser.organizationId },
        { where: { id: movedContactIds }, transaction }
      );
    }
    if (movedLocationIds.length) {
      await Location.update(
        { organizationId: loser.organizationId },
        { where: { id: movedLocationIds }, transaction }
      );
    }

    await loser.update({
      archivedAt: null,
      mergedIntoOpportunityId: null,
      stage: priorState.stage || loser.stage,
      score: priorState.score ?? loser.score,
      scoreReason: priorState.scoreReason ?? loser.scoreReason,
    }, { transaction });

    await AuditLog.create({
      organizationId: agencyOrganizationId,
      actorUserId,
      action: 'opportunity.merge_undone',
      targetType: 'Opportunity',
      targetId: loser.id,
      metadata: { restoredContactIds: movedContactIds, restoredLocationIds: movedLocationIds },
    }, { transaction });

    return loser;
  });
}

module.exports = {
  findPossibleDuplicates, previewMerge, merge, undoMerge,
};
