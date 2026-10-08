'use strict';

const { ClientNote } = require('../../models');
const {
  getProjectByIdForRequester, listClientNotesForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { sensitiveDataProblem } = require('../clients/sensitiveData');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function validBody(body) {
  if (!body?.trim()) throw invalid('body is required');
  const problem = sensitiveDataProblem(body);
  if (problem) throw invalid(problem);
  return body.trim();
}

async function assertProjectAccess(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

function listNotesForClient(context, organization) {
  return listClientNotesForRequester(context, { organizationId: organization.id });
}

async function listNotesForProject(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listClientNotesForRequester(context, { projectId: project.id });
}

/**
 * `organization` must already be resolved through
 * getClientOrganizationForRequester. A note may optionally be pinned to
 * one of that client's own projects — never another client's.
 */
async function createNoteForClient({
  context, organization, projectId, body, authorUserId,
}) {
  const text = validBody(body);
  if (projectId) {
    const project = await assertProjectAccess(context, projectId);
    if (project.organizationId !== organization.id) throw invalid('That project belongs to a different client', 422);
  }

  return ClientNote.create({
    organizationId: organization.id,
    agencyOrganizationId: context.organization.id,
    projectId: projectId || null,
    authorUserId,
    body: text,
  });
}

async function createNoteForProject({
  context, projectId, body, authorUserId,
}) {
  const text = validBody(body);
  const project = await assertProjectAccess(context, projectId);

  return ClientNote.create({
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    projectId: project.id,
    authorUserId,
    body: text,
  });
}

module.exports = {
  listNotesForClient, listNotesForProject, createNoteForClient, createNoteForProject,
};
