'use strict';

const { WebsiteDevelopmentHandoff } = require('../../models');
const { listWebsiteDevelopmentHandoffsForRequester } = require('../../core/authorization/clientVisibleModels');
const { getWebsite, getVersion } = require('./websiteService');
const { requireActiveRepository } = require('./websiteCodegenService');
const { deployToBranch } = require('./websiteDeploymentService');
const { createTask } = require('../tasks/taskService');
const { listAssignments } = require('../projects/projectService');
const { notify } = require('../../core/notifications/notificationService');

const NOTIFIED_ROLE_SLOTS = new Set(['developer', 'advanced_designer']);

function developmentBranchName(version) {
  return `development/v${version.versionNumber}`;
}

/**
 * Promote-to-development (architecture § 16, current-phase-plan.md §
 * 2e): one coherent, auditable action covering the full checklist —
 * "create a named design checkpoint; activate development branches;
 * create technical handoff documentation; create tasks for custom
 * requirements; deploy a preview; notify assigned roles; preserve the
 * builder version" — rather than leaving these as scattered, easy-to-
 * skip side effects a caller has to remember to trigger separately.
 * "Preserve the builder version" is satisfied simply by referencing the
 * caller-supplied, already-immutable WebsiteVersion — never copying or
 * re-snapshotting it.
 */
async function promoteToDevelopment({
  context, projectId, versionId, technicalHandoffNotes, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const repository = await requireActiveRepository(context, website);
  const branchName = developmentBranchName(version);

  // "create a named design checkpoint... activate development branches"
  // — the handoff record itself IS that named checkpoint/branch pairing.
  const handoff = await WebsiteDevelopmentHandoff.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    websiteVersionId: version.id,
    branchName,
    technicalHandoffNotes: technicalHandoffNotes || null,
    status: 'initiated',
    initiatedByUserId: actorUserId,
  });

  // "deploy a preview"
  const deployment = await deployToBranch({
    context, website, version, repository, branchName, environment: 'preview', developmentHandoffId: handoff.id, actorUserId,
  });
  await handoff.update({ status: 'preview_ready' });

  // "create tasks for custom requirements"
  const task = await createTask({
    context,
    projectId,
    title: `Technical handoff: v${version.versionNumber}`,
    description: technicalHandoffNotes || null,
    isClientVisible: false,
  });

  // "notify assigned roles" — this project's own assigned developers/
  // advanced designers (ProjectAssignment role slots), the technical
  // audience architecture § 16 names for a handoff specifically —
  // distinct from WebsiteEditorAssignment (an editing-permission level,
  // not "who is assigned as this project's developer"; most real
  // developers hold 'advanced' editing implicitly by role and may have
  // no WebsiteEditorAssignment row at all, per Phase 5's own design).
  const assignments = await listAssignments(context, projectId);
  const notifiedUserIds = new Set(
    assignments.filter((assignment) => NOTIFIED_ROLE_SLOTS.has(assignment.roleSlot)).map((assignment) => assignment.userId)
  );
  for (const userId of notifiedUserIds) {
    await notify({
      userId,
      organizationId: website.agencyOrganizationId,
      type: 'website_development_handoff',
      title: `A website was promoted to development: v${version.versionNumber}`,
      body: technicalHandoffNotes || undefined,
      data: { websiteId: website.id, handoffId: handoff.id, projectId },
    });
  }

  return { handoff, deployment, task, notifiedUserIds: [...notifiedUserIds] };
}

async function listHandoffs(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteDevelopmentHandoffsForRequester(context, { websiteId: website.id });
}

module.exports = { promoteToDevelopment, listHandoffs, developmentBranchName };
