'use strict';

const { listWebsiteEditorAssignmentsForRequester } = require('../authorization/clientVisibleModels');

const EDITING_LEVEL_RANK = { basic: 0, professional: 1, advanced: 2 };

// Employee roles holding builder.edit get an implicit level from their
// role, without needing an explicit WebsiteEditorAssignment for the
// common case (current-phase-plan.md § 2g). project_manager holds
// builder.publish/builder.manage but not builder.edit itself, so it's
// deliberately absent here — it never reaches an edit-gated endpoint.
const IMPLICIT_EMPLOYEE_EDITING_LEVEL = {
  administrator: 'advanced',
  advanced_designer: 'advanced',
  developer: 'advanced',
  designer: 'professional',
};

/**
 * An explicit WebsiteEditorAssignment always wins when present (it can
 * restrict an employee below their role default, or grant a client
 * collaborator a level). A client membership with no assignment at all
 * resolves to null — no property changes are permitted until an
 * administrator/project_manager (builder.manage) explicitly assigns
 * one, exactly like ProjectAssignment requires an explicit row before
 * anyone sees a role-slot on a project.
 */
async function resolveEffectiveEditingLevel(context, websiteId) {
  const [assignment] = await listWebsiteEditorAssignmentsForRequester(context, { websiteId, userId: context.user.id });
  if (assignment) return assignment.editingLevel;
  if (context.membership.membershipType === 'client') return null;

  const roleKeys = (context.membership.roles || []).map((role) => role.key);
  const candidateLevels = roleKeys.map((key) => IMPLICIT_EMPLOYEE_EDITING_LEVEL[key]).filter(Boolean);
  if (candidateLevels.length === 0) return null;
  return candidateLevels.reduce((best, level) => (EDITING_LEVEL_RANK[level] > EDITING_LEVEL_RANK[best] ? level : best));
}

function levelSatisfies(effectiveLevel, requiredLevel) {
  if (!effectiveLevel) return false;
  return EDITING_LEVEL_RANK[effectiveLevel] >= EDITING_LEVEL_RANK[requiredLevel];
}

module.exports = {
  EDITING_LEVEL_RANK, resolveEffectiveEditingLevel, levelSatisfies,
};
