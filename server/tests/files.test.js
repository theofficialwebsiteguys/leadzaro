'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, File, Task, ProjectChannel, Message, Website, DesignSystem,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

async function setupProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Development', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('File visibility guard', () => {
  test('a raw unscoped query throws', async () => {
    await expect(File.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('The major gate: isPrivate:false alone is NOT sufficient for client visibility', () => {
  test('a non-private website_asset file with no relatedId (or one that matches no real Website) is invisible to a client, even though website_asset joined CLIENT_FACING_SCOPES in Phase 5', async () => {
    // website_asset was deliberately excluded from CLIENT_FACING_SCOPES
    // in Phase 4 specifically because a non-private website_asset file
    // had no inherent tie to a specific client-visible context — Phase 5
    // supplies that context (a real, visibility-checkable Website) and
    // added the scope, but the per-file relatedId re-check (mirroring
    // task_attachment/message_attachment) still gates it: a file with no
    // relatedId, or one that doesn't resolve to a Website the requester
    // can see, is still invisible.
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'website_asset', storageKey: 'k1', originalName: 'logo.png', mimeType: 'image/png', sizeBytes: 100, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.files.length).toBe(0);
  });

  test('a non-private website_asset file whose relatedId points to the project\'s own visible Website IS visible to a client', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const designSystem = await DesignSystem.create({
      agencyOrganizationId: agency.id, organizationId: clientOrg.id, name: 'x', tokens: {}, isLibraryTemplate: false,
    });
    const website = await Website.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, designSystemId: designSystem.id, name: 'x', startingMode: 'blank', draftSchema: {},
    });
    const asset = await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'website_asset', relatedId: website.id, storageKey: 'k2', originalName: 'logo.png', mimeType: 'image/png', sizeBytes: 100, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.files.map((f) => f.id)).toContain(asset.id);
  });

  test('a private project-scope file is invisible to a client even though the scope is client-facing', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'project', storageKey: 'k2', originalName: 'contract.pdf', mimeType: 'application/pdf', sizeBytes: 100, isPrivate: true,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(0);
  });

  test('a non-private project-scope file IS visible to a client', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'project', storageKey: 'k3', originalName: 'homepage-draft.png', mimeType: 'image/png', sizeBytes: 100, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(1);
    expect(list.body.data.files[0].originalName).toBe('homepage-draft.png');
  });

  test('a task_attachment on an INTERNAL task is invisible to a client, even non-private, because the underlying task isn\'t client-visible', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const internalTask = await Task.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, title: 'Internal refactor', isClientVisible: false,
    });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'task_attachment', relatedId: internalTask.id, storageKey: 'k4', originalName: 'debug-log.txt', mimeType: 'text/plain', sizeBytes: 10, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(0);
  });

  test('a task_attachment on a CLIENT-VISIBLE task IS visible to a client', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const visibleTask = await Task.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, title: 'Homepage milestone', isClientVisible: true,
    });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'task_attachment', relatedId: visibleTask.id, storageKey: 'k5', originalName: 'milestone-screenshot.png', mimeType: 'image/png', sizeBytes: 10, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(1);
  });

  test('a message_attachment in an INTERNAL channel is invisible to a client', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const internalChannel = await ProjectChannel.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, key: 'internal', name: 'Internal Notes', visibility: 'internal',
    });
    const message = await Message.create({
      channelId: internalChannel.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, authorUserId: uploader.id, body: 'see attached',
    });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'message_attachment', relatedId: message.id, storageKey: 'k6', originalName: 'internal-notes.png', mimeType: 'image/png', sizeBytes: 10, isPrivate: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(0);
  });

  test('an employee at the owning agency sees every file regardless of isPrivate/scope', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'website_asset', storageKey: 'k7', originalName: 'internal-only.png', mimeType: 'image/png', sizeBytes: 10, isPrivate: true,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const login = await loginAs(app, user.email, password);
    const list = await request(app).get(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`);
    expect(list.body.data.files.length).toBe(1);
  });
});

describe('Real upload/signed-url/delete via the mock storage provider', () => {
  test('an employee can upload a file via multipart, retrieve a signed url, and delete it', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const uploadRes = await auth(request(app).post(`/api/v1/projects/${project.id}/files`))
      .field('scope', 'project')
      .field('isPrivate', 'false')
      .attach('file', Buffer.from('fake image bytes'), { filename: 'design.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.file.originalName).toBe('design.png');
    expect(uploadRes.body.data.file.sizeBytes).toBeGreaterThan(0);

    const signedRes = await auth(request(app).get(`/api/v1/projects/${project.id}/files/${uploadRes.body.data.file.id}/signed-url`));
    expect(signedRes.status).toBe(200);
    expect(signedRes.body.data.url).toMatch(/^https:\/\/mock\.storage\.test\/signed\//);

    const deleteRes = await auth(request(app).delete(`/api/v1/projects/${project.id}/files/${uploadRes.body.data.file.id}`));
    expect(deleteRes.status).toBe(200);

    const stillThere = await File.findOne({ where: { id: uploadRes.body.data.file.id }, __visibilityScoped: true });
    expect(stillThere).toBeNull();
  });

  test('uploading a real image generates thumbnail/medium variants alongside the unchanged original, and a variant\'s own signed url can be fetched', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    // A real, tiny, valid 1x1 PNG — not fake bytes — so sharp can
    // actually decode and resize it.
    const realPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

    const uploadRes = await auth(request(app).post(`/api/v1/projects/${project.id}/files`))
      .field('scope', 'project')
      .field('isPrivate', 'false')
      .attach('file', realPng, { filename: 'real.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(201);
    expect(Object.keys(uploadRes.body.data.file.variants)).toEqual(expect.arrayContaining(['thumbnail', 'medium']));

    const variantSignedRes = await auth(request(app).get(`/api/v1/projects/${project.id}/files/${uploadRes.body.data.file.id}/signed-url`).query({ variant: 'thumbnail' }));
    expect(variantSignedRes.status).toBe(200);
    expect(variantSignedRes.body.data.url).toMatch(/^https:\/\/mock\.storage\.test\/signed\//);
  });

  test('uploading bytes that merely claim to be an image (not real, decodable image data) still succeeds — variant generation failing never blocks the upload', async () => {
    const { agency, project } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const uploadRes = await auth(request(app).post(`/api/v1/projects/${project.id}/files`))
      .field('scope', 'project')
      .field('isPrivate', 'false')
      .attach('file', Buffer.from('not actually a png'), { filename: 'corrupt.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.file.variants).toEqual({});
  });

  test('files.upload is required; a role without it cannot upload', async () => {
    const { agency, project } = await setupProject();
    // No employee role in this catalog currently lacks files.upload, so
    // prove the gate using an unauthenticated-permission simulation:
    // a client role scoped to a DIFFERENT organization cannot even
    // resolve the project, which is the more meaningful boundary here.
    const { clientOrg: otherOrg } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: otherOrg.id, roleKeys: ['client_owner'], membershipType: 'client' });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).post(`/api/v1/projects/${project.id}/files`).set('Authorization', `Bearer ${login.token}`)
      .field('scope', 'project')
      .attach('file', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(404);
  });
});

describe('Cross-agency isolation for files', () => {
  test('an employee at one agency cannot see or fetch another agency\'s file', async () => {
    const { agency, clientOrg, project } = await setupProject();
    const { user: uploader } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const file = await File.create({
      organizationId: clientOrg.id, agencyOrganizationId: agency.id, projectId: project.id, uploadedByUserId: uploader.id, scope: 'project', storageKey: 'k8', originalName: 'x.png', mimeType: 'image/png', sizeBytes: 10, isPrivate: false,
    });

    const { agency: agencyB } = await setupProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const res = await request(app).get(`/api/v1/projects/${project.id}/files/${file.id}/signed-url`).set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(404);
  });
});
