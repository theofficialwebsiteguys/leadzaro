'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Jest gives each test file its own module registry, so this file runs the
// real LocalDiskStorageProvider end to end while every other suite keeps
// the in-memory mock. Must be set before anything requires the app/env.
const STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leadzaro-files-'));
process.env.STORAGE_PROVIDER = 'local';
process.env.LOCAL_STORAGE_DIR = STORAGE_DIR;

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { signFileToken, verifyFileToken } = require('../core/storage/signedFileUrl');

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
});

async function adminWithClient() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const { token } = await loginAs(app, user.email, password);
  const as = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
  const client = (await as('post', '/api/v1/clients').send({ name: `Files Co ${Date.now()}` })).body.data.client;
  return { as, client };
}

function contentPath(url) {
  expect(url).toMatch(/^\/api\/v1\/files\/content\?token=/);
  return url;
}

describe('Local file storage, end to end', () => {
  test('an uploaded file downloads byte-for-byte through its signed link, as an attachment with its original name', async () => {
    const { as, client } = await adminWithClient();
    const bytes = Buffer.from('Quarterly menu — v3\n');
    const upload = await as('post', `/api/v1/clients/${client.id}/files`).attach('file', bytes, { filename: 'Menu v3.txt', contentType: 'text/plain' });
    expect(upload.status).toBe(201);

    const { url } = (await as('get', `/api/v1/clients/${client.id}/files/${upload.body.data.file.id}/download-url`)).body.data;
    const download = await request(app).get(contentPath(url)).buffer(true).parse((res, done) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body, bytes)).toBe(0);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''Menu%20v3.txt");
    expect(download.headers['x-content-type-options']).toBe('nosniff');

    // Nothing named after the upload is written to disk — objects are stored under a hash of their key.
    const stored = fs.readdirSync(STORAGE_DIR, { recursive: true }).map(String);
    expect(stored.some((name) => name.includes('Menu'))).toBe(false);
  });

  test('an uploaded HTML file is never rendered inline from our origin', async () => {
    const { as, client } = await adminWithClient();
    const upload = await as('post', `/api/v1/clients/${client.id}/files`)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'page.html', contentType: 'text/html' });
    const { url } = upload.body.data.file;

    const res = await request(app).get(contentPath(url));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  test('a tampered, forged or expired link is refused', async () => {
    const { as, client } = await adminWithClient();
    const upload = await as('post', `/api/v1/clients/${client.id}/files`)
      .attach('file', Buffer.from('secret brief'), { filename: 'brief.txt', contentType: 'text/plain' });
    const { url } = upload.body.data.file;
    const token = new URL(url, 'http://x').searchParams.get('token');

    const [body, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const tamperedBody = Buffer.from(JSON.stringify({ ...payload, k: 'orgs/someone-else/secret.txt' })).toString('base64url');
    expect((await request(app).get(`/api/v1/files/content?token=${tamperedBody}.${signature}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/files/content?token=garbage')).status).toBe(403);
    expect((await request(app).get('/api/v1/files/content')).status).toBe(403);

    const expired = signFileToken({ ...payload, exp: Date.now() - 1000 });
    expect(verifyFileToken(expired)).toBeNull();
    expect((await request(app).get(`/api/v1/files/content?token=${expired}`)).status).toBe(403);
  });

  test('deleting a file removes it from disk', async () => {
    const { as, client } = await adminWithClient();
    const upload = await as('post', `/api/v1/clients/${client.id}/files`)
      .attach('file', Buffer.from('temporary'), { filename: 'temp.txt', contentType: 'text/plain' });
    const { id, url } = upload.body.data.file;

    expect((await request(app).get(contentPath(url))).status).toBe(200);
    expect((await as('delete', `/api/v1/clients/${client.id}/files/${id}`)).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(404);
  });
});
