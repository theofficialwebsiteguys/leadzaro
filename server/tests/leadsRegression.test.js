'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

describe('lead search, save, notes, outreach, dashboard regression', () => {
  test('demo search -> save -> note -> outreach -> dashboard all work together, and duplicate save is rejected', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const search = await auth(request(app).get('/api/leads/search?keyword=bakery&location=Miami&demo=true'));
    expect(search.status).toBe(200);
    expect(search.body.data.items.length).toBeGreaterThan(0);
    const target = search.body.data.items[0];

    const save = await auth(request(app).post('/api/saved-leads').send({ leadData: target }));
    expect(save.status).toBe(201);
    const savedLeadId = save.body.data.savedLead.id;

    const dup = await auth(request(app).post('/api/saved-leads').send({ leadData: target }));
    expect(dup.status).toBe(409);

    const note = await auth(request(app).post(`/api/saved-leads/${savedLeadId}/notes`).send({ content: 'Called, left voicemail' }));
    expect(note.status).toBe(201);

    const detail = await auth(request(app).get(`/api/saved-leads/${savedLeadId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.data.notes).toHaveLength(1);

    const leadId = detail.body.data.savedLead.leadId;
    const activity = await auth(request(app).post('/api/outreach').send({ leadId, type: 'call', note: 'Left voicemail' }));
    expect(activity.status).toBe(201);

    const dashboard = await auth(request(app).get('/api/dashboard'));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.stats.totalSaved).toBe(1);
  });

  test('archive removes a saved lead from the default view and frees the business for re-saving; restore is blocked while a conflicting active save exists', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const placeId = `regression_${Date.now()}`;
    const save = await auth(request(app).post('/api/saved-leads').send({ leadData: { name: 'Regress Co', googlePlaceId: placeId } }));
    const savedLeadId = save.body.data.savedLead.id;

    const archive = await auth(request(app).post(`/api/saved-leads/${savedLeadId}/archive`));
    expect(archive.status).toBe(200);

    const listAfterArchive = await auth(request(app).get('/api/saved-leads'));
    expect(listAfterArchive.body.data.items.find((i) => i.id === savedLeadId)).toBeUndefined();

    const resave = await auth(request(app).post('/api/saved-leads').send({ leadData: { name: 'Regress Co', googlePlaceId: placeId } }));
    expect(resave.status).toBe(201);

    const restoreConflict = await auth(request(app).post(`/api/saved-leads/${savedLeadId}/restore`));
    expect(restoreConflict.status).toBe(409);

    const archivedView = await auth(request(app).get('/api/saved-leads?archived=true'));
    expect(archivedView.body.data.items.find((i) => i.id === savedLeadId)).toBeDefined();
  });

  test('outreach activities can be archived and restored', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const lead = await sequelize.models.Lead.create({ name: 'Outreach Archive Target', googlePlaceId: `oa_${Date.now()}` });
    const activity = await auth(request(app).post('/api/outreach').send({ leadId: lead.id, type: 'email' }));
    const activityId = activity.body.data.activity.id;

    const archive = await auth(request(app).post(`/api/outreach/${activityId}/archive`));
    expect(archive.status).toBe(200);
    const listAfterArchive = await auth(request(app).get('/api/outreach'));
    expect(listAfterArchive.body.data.items.find((a) => a.id === activityId)).toBeUndefined();

    const restore = await auth(request(app).post(`/api/outreach/${activityId}/restore`));
    expect(restore.status).toBe(200);
    const listAfterRestore = await auth(request(app).get('/api/outreach'));
    expect(listAfterRestore.body.data.items.find((a) => a.id === activityId)).toBeDefined();
  });

  test('a permission-less action is rejected: search requires leads.search', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    // A client-type membership gets none of the sales permissions in Phase 1.
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: org.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);

    const res = await request(app).get('/api/leads/search?keyword=test&demo=true').set('Authorization', `Bearer ${login.token}`);
    expect(res.status).toBe(403);
  });
});
