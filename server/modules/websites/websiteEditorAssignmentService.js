'use strict';

const { WebsiteEditorAssignment, User, OrganizationMembership } = require('../../models');
const {
  listWebsiteEditorAssignmentsForRequester, getWebsiteEditorAssignmentByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('./websiteService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function listAssignments(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteEditorAssignmentsForRequester(context, { websiteId: website.id });
}

/**
 * Two checks the Phase 4 closing review had to retrofit onto
 * ProjectAssignment after finding them missing — built in from the
 * start here (current-phase-plan.md § 2g corrections):
 *  1. the target user must have an active membership at this website's
 *     own tenant (client-side: the website's organizationId; employee-
 *     side: its agencyOrganizationId) — otherwise a builder.manage
 *     holder could plant an assignment referencing any user in the
 *     system, and assignment listings expose name/email to anyone with
 *     projects.view, including the client themselves.
 *  2. 'advanced' can never be assigned to a client-membership target —
 *     Advanced tier is explicitly developer/employee territory
 *     (architecture § 14: "registered components," "controlled
 *     developer functionality").
 */
async function addAssignment({
  context, projectId, userId, editingLevel, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  if (!WebsiteEditorAssignment.EDITING_LEVELS.includes(editingLevel)) throw invalid(`Unknown editingLevel: ${editingLevel}`);

  const targetUser = await User.findByPk(userId);
  if (!targetUser) throw invalid('User not found', 404);

  const clientMembership = await OrganizationMembership.findOne({
    where: { userId, organizationId: website.organizationId, status: 'active' },
  });
  const employeeMembership = clientMembership
    ? null
    : await OrganizationMembership.findOne({
      where: { userId, organizationId: website.agencyOrganizationId, status: 'active' },
    });
  if (!clientMembership && !employeeMembership) {
    throw invalid('User is not an active member of this website\'s client organization or agency', 422);
  }
  if (clientMembership && editingLevel === 'advanced') {
    throw invalid('Advanced editing access cannot be granted to a client-membership user', 422);
  }

  // findOrCreate internally issues a find first, which the model's own
  // guard hook would otherwise reject — the same sanctioned exception
  // documented for findOrCreateProjectFinancials in clientVisibleModels.js.
  const [assignment] = await WebsiteEditorAssignment.findOrCreate({
    where: { websiteId: website.id, userId },
    defaults: {
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      userId,
      editingLevel,
      assignedByUserId: actorUserId,
    },
    __visibilityScoped: true,
  });
  if (assignment.editingLevel !== editingLevel) {
    await assignment.update({ editingLevel, assignedByUserId: actorUserId });
  }
  return assignment;
}

async function removeAssignment({ context, projectId, assignmentId }) {
  const website = await getWebsite(context, projectId);
  const assignment = await getWebsiteEditorAssignmentByIdForRequester(context, assignmentId);
  if (!assignment || assignment.websiteId !== website.id) throw invalid('Assignment not found', 404);
  await assignment.destroy();
  return assignment;
}

module.exports = { listAssignments, addAssignment, removeAssignment };
