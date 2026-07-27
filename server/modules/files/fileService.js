'use strict';

const crypto = require('node:crypto');
const { File } = require('../../models');
const {
  getProjectByIdForRequester, listFilesForRequester, getFileByIdForRequester,
  getTaskByIdForRequester, getMessageByIdForRequester, getClientRequestByIdForRequester, getWebsiteByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getStorageProvider } = require('../../core/storage/storageProvider');
const { isImage, generateImageVariants } = require('../../core/storage/imageOptimization');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const RELATED_LOOKUPS = {
  task_attachment: getTaskByIdForRequester,
  message_attachment: getMessageByIdForRequester,
  request_attachment: getClientRequestByIdForRequester,
  website_asset: getWebsiteByIdForRequester,
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

  // The original is always uploaded above, unchanged — variant
  // generation failing (e.g. corrupted or unusually-encoded image
  // bytes that pass the MIME-type check but aren't a real decodable
  // image) never blocks the upload itself, it just means this file has
  // no variants: responsive variants are additive value, not a
  // correctness requirement for the file to be stored.
  const variants = {};
  if (isImage(mimeType)) {
    try {
      const variantBuffers = await generateImageVariants(buffer);
      for (const [variantName, variantBuffer] of Object.entries(variantBuffers)) {
        // eslint-disable-next-line no-await-in-loop
        const variantUpload = await storageProvider.upload({ key: `${key}-${variantName}`, buffer: variantBuffer, contentType: mimeType });
        variants[variantName] = variantUpload.key;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[files] image variant generation failed for ${originalName}:`, err.message);
    }
  }

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
    variants,
  });
}

async function listFiles(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listFilesForRequester(context, { projectId: project.id });
}

async function getSignedUrl(context, fileId, variant) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file) throw invalid('File not found', 404);

  let storageKey = file.storageKey;
  if (variant) {
    storageKey = file.variants?.[variant];
    if (!storageKey) throw invalid(`This file has no "${variant}" variant`, 404);
  }

  const storageProvider = getStorageProvider();
  const signed = await storageProvider.getSignedUrl(storageKey, { expiresInSeconds: 900 });
  return { file, ...signed };
}

async function deleteFile(context, fileId) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file) throw invalid('File not found', 404);
  const storageProvider = getStorageProvider();
  await storageProvider.delete(file.storageKey);
  for (const variantKey of Object.values(file.variants || {})) {
    // eslint-disable-next-line no-await-in-loop
    await storageProvider.delete(variantKey);
  }
  await file.destroy();
  return { deleted: true };
}

module.exports = {
  uploadFile, listFiles, getSignedUrl, deleteFile,
};
