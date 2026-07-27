'use strict';

const sharp = require('sharp');

/**
 * "No-extra-service image optimization" (architecture § 13, current-
 * phase-plan.md § 2l): an in-process library invoked at upload time,
 * not a new external adapter/service — this is a transformation step,
 * not a storage concern, so it deliberately does not live inside
 * StorageProvider. The original is always uploaded unchanged; these
 * variants are additional objects alongside it, never a replacement.
 */
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const VARIANT_WIDTHS = { thumbnail: 200, medium: 800 };

function isImage(mimeType) {
  return IMAGE_MIME_TYPES.has(mimeType);
}

async function generateImageVariants(buffer) {
  const variants = {};
  for (const [name, width] of Object.entries(VARIANT_WIDTHS)) {
    // eslint-disable-next-line no-await-in-loop
    variants[name] = await sharp(buffer).resize({ width, withoutEnlargement: true }).toBuffer();
  }
  return variants;
}

module.exports = { isImage, generateImageVariants, VARIANT_WIDTHS };
