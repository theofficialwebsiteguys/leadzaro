'use strict';

const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const {
  sequelize, Project, ProjectChannel, ClientProfile, ClientNote,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { CHANNEL_DEFAULTS } = require('../core/projects/projectCatalog');

afterAll(async () => {
  await sequelize.close();
});

async function adminOf(agency) {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['administrator'] });
  const { token } = await loginAs(app, user.email, password);
  return (method, url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

async function newAgencyAdmin() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  return { agency, as: await adminOf(agency) };
}

async function createClient(as, body) {
  const res = await as('post', '/api/v1/clients').send(body);
  expect(res.status).toBe(201);
  return res.body.data.client;
}

function tinyPng() {
  return sharp({
    create: {
      width: 8, height: 8, channels: 3, background: '#6366f1',
    },
  }).png().toBuffer();
}

describe('Client hub visibility guard', () => {
  test('raw unscoped queries against ClientProfile and ClientNote throw', async () => {
    await expect(ClientProfile.findAll()).rejects.toThrow(/must be queried through/i);
    await expect(ClientNote.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Client hub access', () => {
  test('a client membership is refused even though it holds projects.view', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const { token } = await loginAs(app, user.email, password);

    const list = await request(app).get('/api/v1/clients').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);
    const detail = await request(app).get(`/api/v1/clients/${clientOrg.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(403);
  });

  test('internal cost and access notes are only sent to people who can manage projects', async () => {
    const { agency, as: asAdmin } = await newAgencyAdmin();
    const client = await createClient(asAdmin, { name: 'Margin Test Cafe' });
    expect((await asAdmin('patch', `/api/v1/clients/${client.id}`).send({
      recurringPriceCents: 9900, billingFrequency: 'monthly', internalMonthlyCostCents: 1800, internalCostNotes: 'Hosting 12', accessNotes: 'Logins in 1Password vault',
    })).status).toBe(200);

    const adminView = await asAdmin('get', `/api/v1/clients/${client.id}`);
    expect(adminView.body.data.canSeeInternals).toBe(true);
    expect(adminView.body.data.profile.internalMonthlyCostCents).toBe(1800);
    expect(adminView.body.data.profile.accessNotes).toBe('Logins in 1Password vault');

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const { token } = await loginAs(app, user.email, password);
    const designerView = await request(app).get(`/api/v1/clients/${client.id}`).set('Authorization', `Bearer ${token}`);
    expect(designerView.status).toBe(200);
    expect(designerView.body.data.canSeeInternals).toBe(false);
    expect(designerView.body.data.profile.recurringPriceCents).toBe(9900);
    for (const field of ['internalMonthlyCostCents', 'internalCostNotes', 'accessNotes']) {
      expect(designerView.body.data.profile).not.toHaveProperty(field);
    }
  });

  test('another agency\'s employee can neither see nor edit a client', async () => {
    const { as: asA } = await newAgencyAdmin();
    const { as: asB } = await newAgencyAdmin();
    const client = await createClient(asA, { name: 'Isolated Bakery' });

    const listB = await asB('get', '/api/v1/clients');
    expect(listB.body.data.clients.map((c) => c.id)).not.toContain(client.id);
    expect((await asB('get', `/api/v1/clients/${client.id}`)).status).toBe(404);
    expect((await asB('patch', `/api/v1/clients/${client.id}`).send({ name: 'Hijacked' })).status).toBe(404);
    expect((await asB('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Nope' })).status).toBe(404);
  });
});

describe('Creating and editing a client', () => {
  test('only a name is required, and nothing is fabricated to fill the profile', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Haven Test Club' });

    const detail = await as('get', `/api/v1/clients/${client.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.client.name).toBe('Haven Test Club');
    expect(detail.body.data.contacts).toEqual([]);
    expect(detail.body.data.projects).toEqual([]);
    expect(detail.body.data.files).toEqual([]);
    expect(detail.body.data.profile.websiteUrl).toBeNull();
    expect(detail.body.data.profile.recurringPriceCents).toBeNull();
  });

  test('a duplicate client name at the same agency is rejected', async () => {
    const { as } = await newAgencyAdmin();
    await createClient(as, { name: 'Best Diner Test' });
    const dup = await as('post', '/api/v1/clients').send({ name: 'best diner test' });
    expect(dup.status).toBe(409);

    const other = await createClient(as, { name: 'Second Diner Test' });
    const rename = await as('patch', `/api/v1/clients/${other.id}`).send({ name: 'BEST DINER TEST', description: 'Should not be saved' });
    expect(rename.status).toBe(409);
    const reloaded = await as('get', `/api/v1/clients/${other.id}`);
    expect(reloaded.body.data.client.name).toBe('Second Diner Test');
    expect(reloaded.body.data.profile.description).toBeNull();
    // Re-saving a client's own name (or changing only its case) is not a conflict.
    expect((await as('patch', `/api/v1/clients/${other.id}`).send({ name: 'second diner test' })).status).toBe(200);
  });

  test('profile fields are normalized, persisted, and survive a reload', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'J and J Test Restoration', websiteUrl: 'jjtest.example.com' });

    const patch = await as('patch', `/api/v1/clients/${client.id}`).send({
      description: 'Masonry and restoration',
      // Retired profile fields (ADR 0009) are ignored rather than stored.
      domainName: 'https://www.JJTest.example.com/about',
      registrar: 'Namecheap',
      domainRenewalDate: '2027-03-01',
      adminLinks: [{ label: 'cPanel', url: 'cpanel.example.com' }, { label: '', url: '' }],
      setupPriceCents: 150000,
      recurringPriceCents: 9900,
      billingFrequency: 'monthly',
      paymentStatus: 'current',
      internalMonthlyCostCents: 1800,
      accessNotes: 'Logins are in 1Password under JJ.',
    });
    expect(patch.status).toBe(200);

    const { profile } = (await as('get', `/api/v1/clients/${client.id}`)).body.data;
    expect(profile.websiteUrl).toBe('https://jjtest.example.com');
    expect(profile.adminLinks).toEqual([{ label: 'cPanel', url: 'https://cpanel.example.com' }]);
    expect(profile.recurringPriceCents).toBe(9900);
    expect(profile.billingFrequency).toBe('monthly');
    expect(profile.internalMonthlyCostCents).toBe(1800);
    for (const retired of ['domainName', 'registrar', 'domainRenewalDate', 'hostingProvider', 'hostingRenewalDate']) {
      expect(profile).not.toHaveProperty(retired);
    }

    // The website address became the client's domain link instead.
    const domains = (await as('get', `/api/v1/clients/${client.id}/domains`)).body.data.domains;
    expect(domains.map((domain) => domain.domainName)).toEqual(['example.com']);
    expect(domains[0].links[0]).toMatchObject({ hostname: 'jjtest.example.com', source: 'client_website', isPrimary: true });
  });

  test('invalid values are rejected with a 422, and nothing is saved', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Validation Test Co' });

    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ billingFrequency: 'weekly' })).status).toBe(422);
    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ recurringPriceCents: -5 })).status).toBe(422);
    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ websiteUrl: 'javascript:alert(1)' })).status).toBe(422);
    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ name: '   ' })).status).toBe(422);

    const { profile } = (await as('get', `/api/v1/clients/${client.id}`)).body.data;
    expect(profile.billingFrequency).toBeNull();
    expect(profile.recurringPriceCents).toBeNull();
  });

  test('passwords and card numbers are refused in free-text fields', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Secrets Test Co' });

    const password = await as('patch', `/api/v1/clients/${client.id}`).send({ accessNotes: 'wp-admin password: hunter2' });
    expect(password.status).toBe(422);
    expect(password.body.message).toMatch(/password/i);

    const card = await as('patch', `/api/v1/clients/${client.id}`).send({ billingNotes: 'Card 4242 4242 4242 4242 exp 12/30' });
    expect(card.status).toBe(422);

    const note = await as('post', `/api/v1/clients/${client.id}/notes`).send({ body: 'pwd=letmein' });
    expect(note.status).toBe(422);

    // A phone number is not mistaken for a card number.
    const ok = await as('patch', `/api/v1/clients/${client.id}`).send({ billingNotes: 'Call the owner at 555-867-5309 before invoicing' });
    expect(ok.status).toBe(200);
  });
});

describe('Projects under a client', () => {
  test('a client can own several projects, each with the default channel set', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Multi Project Test Co' });

    const site = await as('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Main website', projectType: 'website', liveUrl: 'multi.example.com' });
    const app2 = await as('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Booking app', projectType: 'web_app' });
    expect(site.status).toBe(201);
    expect(app2.status).toBe(201);
    expect(site.body.data.project.liveUrl).toBe('https://multi.example.com');

    const channels = await ProjectChannel.findAll({ where: { projectId: app2.body.data.project.id }, __visibilityScoped: true });
    expect(channels).toHaveLength(CHANNEL_DEFAULTS.length);

    const { projects } = (await as('get', `/api/v1/clients/${client.id}`)).body.data;
    expect(projects.map((p) => p.displayName)).toEqual(['Main website', 'Booking app']);

    // The existing project workspace still works for a manually created project.
    const workspace = await as('get', `/api/v1/projects/${app2.body.data.project.id}`);
    expect(workspace.status).toBe(200);
  });

  test('still-needed items are saved with stable ids, and a project from another client cannot be edited through this client', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Needs Test Co' });
    const other = await createClient(as, { name: 'Other Needs Co' });
    const project = (await as('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Site' })).body.data.project;

    const res = await as('patch', `/api/v1/clients/${client.id}/projects/${project.id}`).send({
      outstandingNeeds: [{ label: 'Logo files' }, { id: 'keep-me', label: 'Menu PDF', done: true }, { label: '  ' }],
    });
    expect(res.status).toBe(200);
    const needs = res.body.data.project.outstandingNeeds;
    expect(needs).toHaveLength(2);
    expect(needs[0].id).toEqual(expect.any(String));
    expect(needs[1]).toEqual({ id: 'keep-me', label: 'Menu PDF', done: true });

    const crossClient = await as('patch', `/api/v1/clients/${other.id}/projects/${project.id}`).send({ name: 'Moved?' });
    expect(crossClient.status).toBe(404);
  });

  test('a pre-existing single project (no name) displays under the client name', async () => {
    const agency = await createOrganization(sequelize.models, { type: 'agency' });
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id, name: 'Legacy Client Co' });
    await Project.create({ organizationId: clientOrg.id, agencyOrganizationId: agency.id });
    const as = await adminOf(agency);

    const { projects } = (await as('get', `/api/v1/clients/${clientOrg.id}`)).body.data;
    expect(projects[0].displayName).toBe('Legacy Client Co');
  });
});

describe('Contacts', () => {
  test('the first contact becomes primary; marking another primary moves the flag', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Contacts Test Co' });

    const first = (await as('post', `/api/v1/clients/${client.id}/contacts`).send({ name: 'Ana', email: '' })).body.data.contact;
    expect(first.isPrimary).toBe(true);
    expect(first.email).toBeNull();

    const second = (await as('post', `/api/v1/clients/${client.id}/contacts`).send({ name: 'Ben', phone: '555-0100' })).body.data.contact;
    expect(second.isPrimary).toBe(false);

    await as('patch', `/api/v1/clients/${client.id}/contacts/${second.id}`).send({ isPrimary: true });
    const { contacts } = (await as('get', `/api/v1/clients/${client.id}`)).body.data;
    expect(contacts.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(['Ben']);

    const badEmail = await as('post', `/api/v1/clients/${client.id}/contacts`).send({ name: 'Cy', email: 'not-an-email' });
    expect(badEmail.status).toBe(422);
  });
});

describe('Files and featured images', () => {
  test('a logo must be an image that belongs to the same client', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Logo Test Co' });
    const other = await createClient(as, { name: 'Other Logo Co' });

    const png = await tinyPng();
    const upload = await as('post', `/api/v1/clients/${client.id}/files`).attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    const otherUpload = await as('post', `/api/v1/clients/${other.id}/files`).attach('file', png, { filename: 'theirs.png', contentType: 'image/png' });
    const doc = await as('post', `/api/v1/clients/${client.id}/files`).attach('file', Buffer.from('%PDF-1.4'), { filename: 'brief.pdf', contentType: 'application/pdf' });

    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ logoFileId: otherUpload.body.data.file.id })).status).toBe(422);
    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ logoFileId: doc.body.data.file.id })).status).toBe(422);
    expect((await as('patch', `/api/v1/clients/${client.id}`).send({ logoFileId: upload.body.data.file.id })).status).toBe(200);

    const { profile, files } = (await as('get', `/api/v1/clients/${client.id}`)).body.data;
    expect(profile.logo.id).toBe(upload.body.data.file.id);
    expect(files).toHaveLength(2);

    // Deleting the logo file clears the reference instead of leaving it dangling.
    expect((await as('delete', `/api/v1/clients/${client.id}/files/${upload.body.data.file.id}`)).status).toBe(200);
    const after = (await as('get', `/api/v1/clients/${client.id}`)).body.data.profile;
    expect(after.logoFileId).toBeNull();
  });

  test('a file cannot be downloaded or deleted through a different client', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Download Test Co' });
    const other = await createClient(as, { name: 'Other Download Co' });
    const file = (await as('post', `/api/v1/clients/${client.id}/files`).attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })).body.data.file;

    expect((await as('get', `/api/v1/clients/${client.id}/files/${file.id}/download-url`)).status).toBe(200);
    expect((await as('get', `/api/v1/clients/${other.id}/files/${file.id}/download-url`)).status).toBe(404);
    expect((await as('delete', `/api/v1/clients/${other.id}/files/${file.id}`)).status).toBe(404);
  });
});

describe('Notes', () => {
  test('client-level and project-level notes share one client feed; project notes are employee-only', async () => {
    const { as } = await newAgencyAdmin();
    const client = await createClient(as, { name: 'Notes Test Co' });
    const project = (await as('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Site' })).body.data.project;

    expect((await as('post', `/api/v1/clients/${client.id}/notes`).send({ body: 'Kickoff call went well' })).status).toBe(201);
    expect((await as('post', `/api/v1/projects/${project.id}/notes`).send({ body: 'Waiting on menu PDF' })).status).toBe(201);

    const feed = (await as('get', `/api/v1/clients/${client.id}/notes`)).body.data.notes;
    expect(feed.map((n) => n.body).sort()).toEqual(['Kickoff call went well', 'Waiting on menu PDF']);
    expect(feed.find((n) => n.body === 'Waiting on menu PDF').projectId).toBe(project.id);

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: client.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const { token } = await loginAs(app, user.email, password);
    const clientView = await request(app).get(`/api/v1/projects/${project.id}/notes`).set('Authorization', `Bearer ${token}`);
    expect(clientView.status).toBe(403);
  });
});
