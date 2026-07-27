'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, ProjectChannel, Message, Task,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { CHANNEL_DEFAULTS } = require('../core/projects/projectCatalog');
const { getMessageByIdForRequester, listMessagesForRequester } = require('../core/authorization/clientVisibleModels');

afterAll(async () => {
  await sequelize.close();
});

async function setupProjectWithChannels() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });
  const channels = await ProjectChannel.bulkCreate(CHANNEL_DEFAULTS.map((c) => ({
    projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, key: c.key, name: c.name, visibility: c.visibility,
  })), { returning: true });
  const generalChannel = channels.find((c) => c.key === 'general');
  const internalChannel = channels.find((c) => c.key === 'internal');
  return {
    agency, clientOrg, project, generalChannel, internalChannel,
  };
}

describe('Channel/Message visibility guard', () => {
  test('raw unscoped queries throw', async () => {
    await expect(ProjectChannel.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(Message.findAll()).rejects.toThrow(/must be queried through/i);
  });

  test('getMessageByIdForRequester/listMessagesForRequester are themselves safe against an internal-channel message, independent of any caller checking the channel first', async () => {
    // Regression test for a real bug: these two functions originally
    // scoped Message by tenant columns alone (organizationId is the
    // same for every channel on a project regardless of visibility),
    // relying on messagingService's own "check the channel, then list
    // its messages" call order to keep internal-channel messages away
    // from clients. That's exactly the caller-discipline problem ADR
    // 0007 exists to eliminate — found when Slice 6's File visibility
    // filter called getMessageByIdForRequester directly, skipping that
    // order, and it leaked an internal-channel message's attachment.
    const { clientOrg, internalChannel } = await setupProjectWithChannels();
    const { user: employee } = await createRoleAssignedMember(sequelize.models, { organizationId: internalChannel.agencyOrganizationId, roleKeys: ['developer'] });
    const message = await Message.create({
      channelId: internalChannel.id, organizationId: internalChannel.organizationId, agencyOrganizationId: internalChannel.agencyOrganizationId, authorUserId: employee.id, body: 'internal-only',
    });

    const clientContext = { organization: { id: clientOrg.id }, membership: { membershipType: 'client' } };
    expect(await getMessageByIdForRequester(clientContext, message.id)).toBeNull();
    expect(await listMessagesForRequester(clientContext, { channelId: internalChannel.id })).toEqual([]);

    const employeeContext = { organization: { id: internalChannel.agencyOrganizationId }, membership: { membershipType: 'employee' } };
    expect(await getMessageByIdForRequester(employeeContext, message.id)).not.toBeNull();
  });
});

describe('Default channel seeding', () => {
  test('a project gets exactly 7 client-visible channels and 1 internal channel', async () => {
    const { project } = await setupProjectWithChannels();
    const channels = await ProjectChannel.findAll({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(channels.length).toBe(8);
    expect(channels.filter((c) => c.visibility === 'client').length).toBe(7);
    expect(channels.filter((c) => c.visibility === 'internal').length).toBe(1);
  });
});

describe('The major gate: a client never sees an internal channel or its messages', () => {
  test('the internal channel is absent from a client\'s channel list', async () => {
    const { clientOrg, generalChannel, internalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get(`/api/v1/projects/${generalChannel.projectId}/channels`));
    expect(list.status).toBe(200);
    const ids = list.body.data.channels.map((c) => c.id);
    expect(ids).toContain(generalChannel.id);
    expect(ids).not.toContain(internalChannel.id);
  });

  test('a client cannot list messages in the internal channel by guessing its id', async () => {
    const { clientOrg, internalChannel } = await setupProjectWithChannels();
    await Message.create({
      channelId: internalChannel.id, organizationId: internalChannel.organizationId, agencyOrganizationId: internalChannel.agencyOrganizationId, authorUserId: (await createRoleAssignedMember(sequelize.models, { organizationId: internalChannel.agencyOrganizationId, roleKeys: ['developer'] })).user.id, body: 'Internal-only discussion',
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).get(`/api/v1/projects/${internalChannel.projectId}/channels/${internalChannel.id}/messages`));
    expect(res.status).toBe(404);
  });

  test('a client cannot post into the internal channel by guessing its id', async () => {
    const { clientOrg, internalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${internalChannel.projectId}/channels/${internalChannel.id}/messages`).send({ body: 'Trying to sneak in' }));
    expect(res.status).toBe(404);
  });

  test('a client CAN read and post in a client-visible channel', async () => {
    const { clientOrg, generalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const post = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`).send({ body: 'Hi team, excited to get started!' }));
    expect(post.status).toBe(201);

    const list = await auth(request(app).get(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`));
    expect(list.status).toBe(200);
    expect(list.body.data.messages.map((m) => m.body)).toContain('Hi team, excited to get started!');
  });

  test('the "viewer" client role cannot post messages at all', async () => {
    const { clientOrg, generalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['viewer'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`).send({ body: 'Should be blocked' }));
    expect(res.status).toBe(403);
  });
});

describe('An employee sees both client and internal channels', () => {
  test('an employee at the owning agency lists all 8 channels and can post in the internal one', async () => {
    const { agency, generalChannel, internalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get(`/api/v1/projects/${generalChannel.projectId}/channels`));
    expect(list.body.data.channels.length).toBe(8);

    const post = await auth(request(app).post(`/api/v1/projects/${internalChannel.projectId}/channels/${internalChannel.id}/messages`).send({ body: 'Internal-only note about scope creep' }));
    expect(post.status).toBe(201);
  });
});

describe('Message threading and conversion to task', () => {
  test('a thread reply must belong to the same channel as its parent', async () => {
    const { agency, generalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const parent = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`).send({ body: 'Original question' }));
    const reply = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`).send({ body: 'Reply', threadParentMessageId: parent.body.data.message.id }));
    expect(reply.status).toBe(201);
    expect(reply.body.data.message.threadParentMessageId).toBe(parent.body.data.message.id);
  });

  test('converting a message to a task creates a real Task and links it back', async () => {
    const { agency, generalChannel } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const posted = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`).send({ body: 'Can we add a contact form to the footer?' }));
    const converted = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages/${posted.body.data.message.id}/convert-to-task`).send({ isClientVisible: true }));
    expect(converted.status).toBe(201);
    expect(converted.body.data.task.title).toMatch(/contact form/);

    const task = await Task.findOne({ where: { id: converted.body.data.task.id }, __visibilityScoped: true });
    expect(task.isClientVisible).toBe(true);

    const again = await auth(request(app).post(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages/${posted.body.data.message.id}/convert-to-task`).send({}));
    expect(again.status).toBe(409);
  });
});

describe('Cross-agency isolation for channels/messages', () => {
  test('an employee at one agency cannot read or post in another agency\'s channel', async () => {
    const { generalChannel } = await setupProjectWithChannels();
    const { agency: agencyB } = await setupProjectWithChannels();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).get(`/api/v1/projects/${generalChannel.projectId}/channels/${generalChannel.id}/messages`));
    expect(res.status).toBe(404);
  });
});

describe('ensureProjectForConversion (closing the Phase 3 -> Phase 4 loop)', () => {
  test('a brand-new client conversion automatically gets a Project and its 8 default channels', async () => {
    const { getStripeAdapter } = require('../core/integrations/stripe/stripeAdapter');
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const oppRes = await auth(request(app).post('/api/v1/crm/opportunities').send({
      leadData: { name: 'Auto Project Test Biz', googlePlaceId: `autoproject_${Date.now()}` },
    }));
    expect(oppRes.status).toBe(201);
    const { opportunity, organization } = oppRes.body.data;

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({ opportunityId: opportunity.id, agencyOrganizationId: opportunity.agencyOrganizationId });
    const webhookRes = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(webhookRes.status).toBe(200);

    const project = await Project.findOne({ where: { organizationId: organization.id }, __visibilityScoped: true });
    expect(project).not.toBeNull();
    expect(project.agencyOrganizationId).toBe(org.id);

    const channels = await ProjectChannel.findAll({ where: { projectId: project.id }, __visibilityScoped: true });
    expect(channels.length).toBe(8);
  });
});
