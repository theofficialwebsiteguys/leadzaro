'use strict';

const request = require('supertest');
const app = require('../app');
const { sequelize } = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

function uniquePlaceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function createOpportunity(auth, name, prefix) {
  const res = await auth(request(app).post('/api/v1/crm/opportunities').send({
    leadData: { name, googlePlaceId: uniquePlaceId(prefix) },
  }));
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('CRM duplicate detection and merge', () => {
  test('finds duplicates by normalized name, previews, merges (moving contacts/locations), rejects a second merge, then undoes it', async () => {
    const { Contact, Location } = sequelize.models;
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const first = await createOpportunity(auth, 'Ace Plumbing Co', 'dupA');
    const second = await createOpportunity(auth, 'ACE PLUMBING CO!!', 'dupB');
    const unrelated = await createOpportunity(auth, 'Totally Different Biz', 'dupC');

    const duplicates = await auth(request(app).get('/api/v1/crm/duplicates'));
    expect(duplicates.status).toBe(200);
    const group = duplicates.body.data.duplicateGroups.find(
      (g) => g.opportunities.some((o) => o.id === first.opportunity.id)
    );
    expect(group).toBeDefined();
    expect(group.opportunities.map((o) => o.id).sort()).toEqual(
      [first.opportunity.id, second.opportunity.id].sort()
    );
    expect(duplicates.body.data.duplicateGroups.some(
      (g) => g.opportunities.some((o) => o.id === unrelated.opportunity.id)
    )).toBe(false);

    const loserContact = await Contact.create({
      organizationId: second.organization.id,
      agencyOrganizationId: org.id,
      name: 'Loser Contact',
    });
    const loserLocation = await Location.create({
      organizationId: second.organization.id,
      agencyOrganizationId: org.id,
      address: '123 Loser St',
    });

    const preview = await auth(request(app).get('/api/v1/crm/merge/preview').query({
      winnerId: first.opportunity.id, loserId: second.opportunity.id,
    }));
    expect(preview.status).toBe(200);
    expect(preview.body.data.loserContacts.map((c) => c.id)).toContain(loserContact.id);
    expect(preview.body.data.loserLocations.map((l) => l.id)).toContain(loserLocation.id);

    const selfMerge = await auth(request(app).post('/api/v1/crm/merge').send({
      winnerId: first.opportunity.id, loserId: first.opportunity.id,
    }));
    expect(selfMerge.status).toBe(422);

    const merge = await auth(request(app).post('/api/v1/crm/merge').send({
      winnerId: first.opportunity.id, loserId: second.opportunity.id, reason: 'Same business, duplicate entry',
    }));
    expect(merge.status).toBe(200);
    expect(merge.body.data.loser.archivedAt).not.toBeNull();
    expect(merge.body.data.loser.mergedIntoOpportunityId).toBe(first.opportunity.id);
    expect(merge.body.data.movedContactIds).toContain(loserContact.id);
    expect(merge.body.data.movedLocationIds).toContain(loserLocation.id);

    await loserContact.reload();
    await loserLocation.reload();
    expect(loserContact.organizationId).toBe(first.organization.id);
    expect(loserLocation.organizationId).toBe(first.organization.id);

    const secondMerge = await auth(request(app).post('/api/v1/crm/merge').send({
      winnerId: first.opportunity.id, loserId: second.opportunity.id, reason: 'retry',
    }));
    expect(secondMerge.status).toBe(409);

    const undo = await auth(request(app).post(`/api/v1/crm/opportunities/${second.opportunity.id}/undo-merge`));
    expect(undo.status).toBe(200);
    expect(undo.body.data.opportunity.archivedAt).toBeNull();
    expect(undo.body.data.opportunity.mergedIntoOpportunityId).toBeNull();
    expect(undo.body.data.opportunity.stage).toBe(second.opportunity.stage);

    await loserContact.reload();
    await loserLocation.reload();
    expect(loserContact.organizationId).toBe(second.organization.id);
    expect(loserLocation.organizationId).toBe(second.organization.id);
  });

  test('merge and preview are rejected across agency boundaries', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_manager'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_manager'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    const loginB = await loginAs(app, userB.email, passwordB);
    const authB = (r) => r.set('Authorization', `Bearer ${loginB.token}`);

    const oppA1 = await createOpportunity(authA, 'Agency A Biz One', 'xagA1');
    const oppA2 = await createOpportunity(authA, 'Agency A Biz Two', 'xagA2');

    const crossPreview = await authB(request(app).get('/api/v1/crm/merge/preview').query({
      winnerId: oppA1.opportunity.id, loserId: oppA2.opportunity.id,
    }));
    expect(crossPreview.status).toBe(404);

    const crossMerge = await authB(request(app).post('/api/v1/crm/merge').send({
      winnerId: oppA1.opportunity.id, loserId: oppA2.opportunity.id,
    }));
    expect(crossMerge.status).toBe(404);

    // Agency B has no duplicates of its own; agency A's opportunities must not leak into B's view.
    const duplicatesB = await authB(request(app).get('/api/v1/crm/duplicates'));
    expect(duplicatesB.status).toBe(200);
    expect(duplicatesB.body.data.duplicateGroups.some(
      (g) => g.opportunities.some((o) => o.id === oppA1.opportunity.id || o.id === oppA2.opportunity.id)
    )).toBe(false);
  });
});
