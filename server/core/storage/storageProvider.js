'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { env } = require('../config/env');
const { signFileToken } = require('./signedFileUrl');

/**
 * File storage provider interface (Phase 4 files — master architecture
 * § 13/§ 24 integration priority #3: Google Cloud Storage behind a
 * `StorageProvider` interface). No real GCS credentials exist in this
 * environment (see .env.example). Files are private by default and
 * accessed only through short-lived signed URLs — never a public bucket
 * URL — so every implementation's `getSignedUrl` returns a URL with a
 * real or simulated expiry, never a permanent link.
 */
class StorageProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async upload({
    key, buffer, contentType,
  }) {
    throw new Error('StorageProvider.upload must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getSignedUrl(key, { expiresInSeconds } = {}) {
    throw new Error('StorageProvider.getSignedUrl must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async delete(key) {
    throw new Error('StorageProvider.delete must be implemented by a subclass');
  }
}

/**
 * Real Google Cloud Storage-backed implementation. Untestable in this
 * environment (no real service account credentials), but structurally
 * complete — `@google-cloud/storage` is lazily required only when this
 * class is actually instantiated, matching LiveStripeAdapter's pattern.
 */
class LiveStorageProvider extends StorageProvider {
  constructor(credentialsJson, bucketName) {
    super();
    // eslint-disable-next-line global-require
    const { Storage } = require('@google-cloud/storage');
    this.storage = new Storage({ credentials: JSON.parse(credentialsJson) });
    this.bucket = this.storage.bucket(bucketName);
  }

  async upload({ key, buffer, contentType }) {
    const file = this.bucket.file(key);
    await file.save(buffer, { contentType, resumable: false, private: true });
    return { key, provider: 'gcs' };
  }

  async getSignedUrl(key, { expiresInSeconds = 900, downloadName } = {}) {
    const [url] = await this.bucket.file(key).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
      ...(downloadName ? { responseDisposition: `attachment; filename="${downloadName.replaceAll('"', '')}"` } : {}),
    });
    return { url, expiresInSeconds };
  }

  async delete(key) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
    return { deleted: true };
  }
}

/**
 * Simulates upload/signed-URL/delete without any real network call or
 * disk write. Every key/URL it returns is clearly prefixed `mock_` so it
 * can never be confused with a real GCS object in logs or the database.
 */
class MockStorageProvider extends StorageProvider {
  constructor() {
    super();
    // In-memory only — never persisted, and never a substitute for a
    // real object store. Sized and lived for tests/dev only.
    this.objects = new Map();
  }

  async upload({ key, buffer, contentType }) {
    const storedKey = key || `mock_key_${crypto.randomUUID()}`;
    this.objects.set(storedKey, { buffer, contentType });
    return { key: storedKey, provider: 'mock' };
  }

  // eslint-disable-next-line class-methods-use-this
  async getSignedUrl(key, { expiresInSeconds = 900 } = {}) {
    return { url: `https://mock.storage.test/signed/${encodeURIComponent(key)}?exp=${Date.now() + expiresInSeconds * 1000}`, expiresInSeconds };
  }

  async delete(key) {
    this.objects.delete(key);
    return { deleted: true };
  }
}

/**
 * Real files on local disk, for development (and single-server
 * deployments that accept that trade-off). Objects are stored under a
 * hash of their key, never the key itself, so an uploaded filename can
 * never influence the on-disk path. Reads go only through signed links
 * (see signedFileUrl.js and the /api/v1/files/content route), mirroring
 * the private-bucket + signed-URL model of the GCS provider.
 */
class LocalDiskStorageProvider extends StorageProvider {
  constructor(rootDir) {
    super();
    this.rootDir = path.resolve(rootDir);
  }

  pathForKey(key) {
    const digest = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.rootDir, digest.slice(0, 2), digest);
  }

  async upload({ key, buffer }) {
    const filePath = this.pathForKey(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
    return { key, provider: 'local' };
  }

  // eslint-disable-next-line class-methods-use-this
  async getSignedUrl(key, { expiresInSeconds = 900, contentType, downloadName } = {}) {
    const token = signFileToken({
      k: key, exp: Date.now() + expiresInSeconds * 1000, ct: contentType || 'application/octet-stream', fn: downloadName || null,
    });
    return { url: `/api/v1/files/content?token=${token}`, expiresInSeconds };
  }

  async open(key) {
    const filePath = this.pathForKey(key);
    try {
      const stat = await fs.promises.stat(filePath);
      return { stream: fs.createReadStream(filePath), size: stat.size };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key) {
    try {
      await fs.promises.unlink(this.pathForKey(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return { deleted: true };
  }
}

class DisabledStorageProvider extends StorageProvider {
  // eslint-disable-next-line class-methods-use-this
  async upload() {
    const err = new Error('File storage is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async getSignedUrl() {
    const err = new Error('File storage is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async delete() {
    const err = new Error('File storage is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedProvider = null;

function getStorageProvider() {
  if (cachedProvider) return cachedProvider;

  if (env.STORAGE_PROVIDER === 'live') {
    cachedProvider = new LiveStorageProvider(env.GCS_CREDENTIALS_JSON, env.GCS_BUCKET_NAME);
    return cachedProvider;
  }

  if (env.STORAGE_PROVIDER === 'local') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: STORAGE_PROVIDER=local is set in production — files live on this server\'s disk only (not shared across instances, not backed up by the app).');
    }
    cachedProvider = new LocalDiskStorageProvider(env.LOCAL_STORAGE_DIR);
    return cachedProvider;
  }

  if (env.STORAGE_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: STORAGE_PROVIDER=mock is set in production — uploaded files are held in memory only and will not survive a restart.');
    }
    cachedProvider = new MockStorageProvider();
    return cachedProvider;
  }

  cachedProvider = new DisabledStorageProvider();
  return cachedProvider;
}

module.exports = {
  getStorageProvider, StorageProvider, LiveStorageProvider, LocalDiskStorageProvider, MockStorageProvider, DisabledStorageProvider,
};
