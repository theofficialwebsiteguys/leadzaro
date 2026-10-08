'use strict';

const { getStorageProvider } = require('../../core/storage/storageProvider');
const { verifyFileToken, isInlineSafe } = require('../../core/storage/signedFileUrl');

function contentDisposition(type, filename) {
  const safeAscii = filename.replaceAll(/[^\w.\- ]/g, '_');
  return `${type}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Serves a file stored by LocalDiskStorageProvider. Unauthenticated by
 * design — the signed, expiring token in the URL *is* the authorization,
 * minted only by fileService after an access check (same model as a GCS
 * signed URL). Only image/PDF types render inline; everything else is
 * forced to download and sandboxed, so an uploaded HTML/SVG file can
 * never run script in the app's origin.
 */
async function serveSignedFile(req, res, next) {
  try {
    const payload = verifyFileToken(req.query.token);
    if (!payload) {
      return res.status(403).json({ success: false, message: 'This file link is invalid or has expired.' });
    }

    const provider = getStorageProvider();
    if (typeof provider.open !== 'function') {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }
    const opened = await provider.open(payload.k);
    if (!opened) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const contentType = payload.ct || 'application/octet-stream';
    let disposition;
    if (payload.fn) {
      disposition = contentDisposition('attachment', payload.fn);
    } else if (isInlineSafe(contentType)) {
      disposition = 'inline';
    } else {
      disposition = contentDisposition('attachment', 'download');
    }

    const secondsLeft = Math.max(0, Math.floor((payload.exp - Date.now()) / 1000));
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(opened.size),
      'Content-Disposition': disposition,
      'Cache-Control': `private, max-age=${secondsLeft}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-site',
      'Referrer-Policy': 'no-referrer',
    });

    opened.stream.on('error', next);
    return opened.stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = { serveSignedFile };
