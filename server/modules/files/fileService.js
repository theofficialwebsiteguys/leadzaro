'use strict';

const crypto = require('node:crypto');
const { File } = require('../../models');
const {
  getProjectByIdForRequester, listFilesForRequester, getFileByIdForRequester,
  getTaskByIdForRequester, getMessageByIdForRequester, getClientRequestByIdForRequester, getWebsiteByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getStorageProvider } = require('../../core/storage/storageProvider');
const { isImage, generateImageVariants } = require('../../core/storage/imageOptimization');

const SIGNED_URL_TTL_SECONDS = 900;

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

// An uploaded filename only ever becomes part of an object key (never a
// local path — LocalDiskStorageProvider hashes keys), but it is still
// normalized so keys stay predictable across providers.
function safeKeySegment(originalName) {
  return originalName.replaceAll(/[^\w.-]/g, '_').slice(-120) || 'file';
}

/**
 * Stores the original unchanged, then best-effort image variants.
 * Tenant columns must come from an already-authorized project or client
 * organization — never from request input.
 */
async function storeFile({
  organizationId, agencyOrganizationId, projectId, scope, relatedId, buffer, originalName, mimeType, isPrivate, uploadedByUserId,
}) {
  const storageProvider = getStorageProvider();
  const location = projectId ? `projects/${projectId}` : 'client';
  const key = `orgs/${organizationId}/${location}/${crypto.randomUUID()}-${safeKeySegment(originalName)}`;
  const uploadResult = await storageProvider.upload({ key, buffer, contentType: mimeType });

  // Variant generation failing (e.g. bytes that pass the MIME check but
  // aren't a decodable image) never blocks the upload: variants are
  // additive value, not a correctness requirement.
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
    organizationId,
    agencyOrganizationId,
    projectId: projectId || null,
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

  return storeFile({
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    projectId: project.id,
    scope,
    relatedId,
    buffer,
    originalName,
    mimeType,
    isPrivate,
    uploadedByUserId,
  });
}

async function listFiles(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listFilesForRequester(context, { projectId: project.id });
}

async function signedUrlFor(file, storageKey, { download } = {}) {
  const storageProvider = getStorageProvider();
  return storageProvider.getSignedUrl(storageKey, {
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    contentType: file.mimeType,
    downloadName: download ? file.originalName : undefined,
  });
}

async function getSignedUrl(context, fileId, variant, { download } = {}) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file) throw invalid('File not found', 404);

  let storageKey = file.storageKey;
  if (variant) {
    storageKey = file.variants?.[variant];
    if (!storageKey) throw invalid(`This file has no "${variant}" variant`, 404);
  }

  const signed = await signedUrlFor(file, storageKey, { download: download && !variant });
  return { file, ...signed };
}

/**
 * Attaches short-lived display links to already-authorized File rows:
 * `url` for the original and, for images, `thumbnailUrl`/`mediumUrl` for
 * the resized variants when they exist.
 */
async function withDisplayUrls(files) {
  return Promise.all(files.map(async (file) => {
    const json = file.toJSON();
    json.url = (await signedUrlFor(file, file.storageKey)).url;
    json.thumbnailUrl = file.variants?.thumbnail ? (await signedUrlFor(file, file.variants.thumbnail)).url : null;
    json.mediumUrl = file.variants?.medium ? (await signedUrlFor(file, file.variants.medium)).url : null;
    return json;
  }));
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
  // ClientProfile.logoFileId/featuredImageFileId and Project.previewFileId
  // reference Files ON DELETE SET NULL, so a deleted featured image simply
  // clears itself rather than leaving a dangling pointer.
  await file.destroy();
  return { deleted: true };
}

module.exports = {
  storeFile, uploadFile, listFiles, getSignedUrl, withDisplayUrls, deleteFile,
};
