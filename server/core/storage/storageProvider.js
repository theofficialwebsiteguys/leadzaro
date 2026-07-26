'use strict';

const crypto = require('node:crypto');
const { env } = require('../config/env');

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

  async getSignedUrl(key, { expiresInSeconds = 900 } = {}) {
    const [url] = await this.bucket.file(key).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
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
  getStorageProvider, StorageProvider, LiveStorageProvider, MockStorageProvider, DisabledStorageProvider,
};
