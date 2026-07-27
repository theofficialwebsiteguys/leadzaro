'use strict';

const crypto = require('node:crypto');
const { File } = require('../../models');
const {
  getProjectByIdForRequester, listFilesForRequester, getFileByIdForRequester,
  getTaskByIdForRequester, getMessageByIdForRequester, getClientRequestByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getStorageProvider } = require('../../core/storage/storageProvider');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const RELATED_LOOKUPS = {
  task_attachment: getTaskByIdForRequester,
  message_attachment: getMessageByIdForRequester,
  request_attachment: getClientRequestByIdForRequester,
};

async function assertProjectAccess(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

async function uploadFile({
  context, projectId, scope, relatedId, buffer, originalName, mimeType, isPrivate, uploadedByUserId,
}) {
  if (!File.SCOPES.includes(scope)) throw invalid(`Unknown scope: ${scope}`);
  const project = await assertProjectAccess(context, projectId);

  const lookup = RELATED_LOOKUPS[scope];
  if (lookup) {
    if (!relatedId) throw invalid(`relatedId is required for scope ${scope}`);
    const related = await lookup(context, relatedId);
    if (!related) throw invalid('The related item for this attachment was not found', 404);
  }

  const storageProvider = getStorageProvider();
  const key = `orgs/${project.organizationId}/projects/${project.id}/${crypto.randomUUID()}-${originalName}`;
  const uploadResult = await storageProvider.upload({ key, buffer, contentType: mimeType });

  return File.create({
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    projectId: project.id,
    uploadedByUserId,
    scope,
    relatedId: relatedId || null,
    storageKey: uploadResult.key,
    originalName,
    mimeType,
    sizeBytes: buffer.length,
    isPrivate: isPrivate !== false,
  });
}

async function listFiles(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listFilesForRequester(context, { projectId: project.id });
}

async function getSignedUrl(context, fileId) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file) throw invalid('File not found', 404);
  const storageProvider = getStorageProvider();
  const signed = await storageProvider.getSignedUrl(file.storageKey, { expiresInSeconds: 900 });
  return { file, ...signed };
}

async function deleteFile(context, fileId) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file) throw invalid('File not found', 404);
  const storageProvider = getStorageProvider();
  await storageProvider.delete(file.storageKey);
  await file.destroy();
  return { deleted: true };
}

module.exports = {
  uploadFile, listFiles, getSignedUrl, deleteFile,
};
