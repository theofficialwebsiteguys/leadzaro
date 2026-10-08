'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Organization, Notification, Contact,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { FakeNamecheapApi } = require('./helpers/fakeNamecheapApi');
const connectionService = require('../modules/integrations/namecheapConnectionService');
const syncService = require('../modules/integrations/namecheapSyncService');
const { flushBackgroundWork } = require('../core/jobs/background');
const { runDueJobs } = require('../core/jobs/scheduler');
const { getEmailAdapter } = require('../core/notifications/emailAdapter');

afterEach(async () => {
  await flushBackgroundWork();
  connectionService.setReaderFactoryForTests(null);
  syncService.clearRecentChecks();
});

afterAll(async () => {
  await flushBackgroundWork();
  await sequelize.close();
});

function isoInDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function memberOf(agency, roleKeys, membershipType = 'employee') {
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys, membershipType });
  const { token } = await loginAs(app, user.email, password);
  return (method, url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

async function workspace(api) {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const admin = await memberOf(agency, ['administrator']);
  if (api) connectionService.setReaderFactoryForTests(api.readerFactory());
  return { agency, admin };
}

async function connect(admin, api, overrides = {}) {
  const res = await admin('put', '/api/v1/integrations/namecheap').send({
    apiUser: 'twgapi', apiKey: api.apiKey, clientIp: api.whitelistedIp, ...overrides,
  });
  // A verified connection starts its first sync in the background (ADR 0010).
  await flushBackgroundWork();
  return res;
}

async function newClient(as, body) {
  const res = await as('post', '/api/v1/clients').send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

async function rawConnection(agencyId) {
  const [rows] = await sequelize.query('SELECT * FROM "IntegrationConnections" WHERE "agencyOrganizationId" = :agencyId', { replacements: { agencyId } });
  return rows[0];
}

async function rawRecords(agencyId) {
  const [rows] = await sequelize.query('SELECT * FROM "DomainRecords" WHERE "agencyOrganizationId" = :agencyId ORDER BY "domainName"', { replacements: { agencyId } });
  return rows;
}

function sync(agency) {
  return syncService.runSync({ agencyOrganizationId: agency.id, trigger: 'manual' });
}

describe('Namecheap connection — admin only, never a simulated success', () => {
  test('connected only after a real call succeeds; the API key is encrypted and never returned', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'example.com', expires: isoInDays(200) }] });
    const { agency, admin } = await workspace(api);

    const before = await admin('get', '/api/v1/integrations/namecheap');
    expect(before.body.data.connection).toMatchObject({ configured: false, status: 'not_configured' });

    const saved = await connect(admin, api);
    expect(saved.status).toBe(200);
    expect(saved.body.data.test).toEqual({ ok: true, totalDomains: 1 });
    expect(saved.body.data.connection).toMatchObject({
      status: 'connected', hasApiKey: true, accountUserName: 'twgapi', clientIp: api.whitelistedIp,
    });
    expect(JSON.stringify(saved.body)).not.toContain(api.apiKey);
    expect(JSON.stringify((await admin('get', '/api/v1/integrations/namecheap')).body)).not.toContain(api.apiKey);

    const row = await rawConnection(agency.id);
    expect(row.credentialsCiphertext).toMatch(/^v1\./);
    expect(row.credentialsCiphertext).not.toContain(api.apiKey);
    const [audits] = await sequelize.query('SELECT metadata::text AS metadata FROM "AuditLogs" WHERE "organizationId" = :id', { replacements: { id: agency.id } });
    expect(audits.map((a) => a.metadata).join(' ')).not.toContain(api.apiKey);
  });

  test('a failed test is stored as an error with the fix spelled out — not as connected', async () => {
    const api = new FakeNamecheapApi();
    const { admin } = await workspace(api);
    const saved = await connect(admin, api, { clientIp: '198.51.100.7' });
    expect(saved.body.data.test).toMatchObject({ ok: false, error: { kind: 'ip_not_allowed', providerCode: '1011150' } });
    expect(saved.body.data.connection.status).toBe('error');
    expect(saved.body.data.connection.lastError.message).toMatch(/Whitelisted IPs/);
  });

  test('invalid credentials input is refused before anything is sent', async () => {
    const api = new FakeNamecheapApi();
    const { admin } = await workspace(api);
    expect((await connect(admin, api, { clientIp: '192.168.1.5' })).status).toBe(422);
    expect((await connect(admin, api, { clientIp: '2001:db8::1' })).status).toBe(422);
    expect((await connect(admin, api, { apiKey: 'short' })).status).toBe(422);
    expect(api.calls).toHaveLength(0);
  });

  test('only administrators can see or change the connection', async () => {
    const api = new FakeNamecheapApi();
    const { agency } = await workspace(api);
    const designer = await memberOf(agency, ['designer']);
    const projectManager = await memberOf(agency, ['project_manager']);
    expect((await designer('get', '/api/v1/integrations/namecheap')).status).toBe(403);
    expect((await projectManager('put', '/api/v1/integrations/namecheap').send({})).status).toBe(403);
    const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
    const clientMember = await memberOf(clientOrg, ['client_owner'], 'client');
    expect((await clientMember('get', '/api/v1/integrations/namecheap')).status).toBe(403);
    expect((await clientMember('get', '/api/v1/domains/renewals')).status).toBe(403);
  });

  test('disconnecting removes the key but keeps synced domains (labelled stale)', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'keepme.com', expires: isoInDays(90) }] });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    await sync(agency);
    const res = await admin('delete', '/api/v1/integrations/namecheap');
    expect(res.body.data.connection).toMatchObject({ configured: false, status: 'not_configured', hasApiKey: false });
    expect((await rawConnection(agency.id)).credentialsCiphertext).toBeNull();
    expect((await rawRecords(agency.id)).map((r) => r.domainName)).toEqual(['keepme.com']);
  });
});

describe('Sync — repeatable, never destructive', () => {
  test('pages through the whole account; repeating a sync creates no duplicates', async () => {
    const domains = Array.from({ length: 105 }, (_, i) => ({ name: `site${String(i).padStart(3, '0')}.com`, expires: isoInDays(100 + i) }));
    const api = new FakeNamecheapApi({ domains, prices: { com: { price: '15.98' } } });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);

    // The automatic first sync (after the connection test) imported both pages.
    expect(await rawRecords(agency.id)).toHaveLength(105);
    expect(api.calls.filter((c) => c.Command === 'namecheap.domains.getList' && !c.SearchTerm).map((c) => c.Page)).toEqual(['1', '1', '2']);

    const second = await sync(agency);
    expect(second.summary).toMatchObject({ domainsSeen: 105, domainsAdded: 0 });
    expect(await rawRecords(agency.id)).toHaveLength(105);
    const connection = (await admin('get', '/api/v1/integrations/namecheap')).body.data.connection;
    expect(connection).toMatchObject({ status: 'connected', lastSyncStatus: 'success', syncing: false });
    expect(connection.account).toMatchObject({ availableBalanceCents: 12050, fundsRequiredForAutoRenewCents: 3196 });
  });

  test('a failed or partial listing marks nothing missing; a complete one does, keeping last known details', async () => {
    const domains = Array.from({ length: 105 }, (_, i) => ({ name: `keep${String(i).padStart(3, '0')}.com`, expires: isoInDays(60) }));
    const api = new FakeNamecheapApi({ domains });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    await sync(agency);

    // The account loses a domain, but page 2 can't be read: nothing may be marked missing.
    api.domains = domains.slice(1);
    for (let i = 0; i < 3; i += 1) api.once('namecheap.domains.getList', () => ({ statusCode: 503, body: 'down' }), { page: 2 });
    const partial = await sync(agency);
    expect(partial.status).toBe('partial');
    expect(partial.summary.markedMissing).toBe(0);
    expect((await rawRecords(agency.id)).filter((r) => r.providerMissingSince)).toHaveLength(0);

    // Page 1 fails outright: the sync fails and changes nothing.
    for (let i = 0; i < 3; i += 1) api.once('namecheap.domains.getList', () => ({ statusCode: 200, body: '<html>maintenance</html>' }), { page: 1 });
    expect((await sync(agency)).status).toBe('failed');
    const afterFailure = (await admin('get', '/api/v1/integrations/namecheap')).body.data.connection;
    expect(afterFailure).toMatchObject({ status: 'connected', lastSyncStatus: 'failed' });
    expect(afterFailure.lastError.kind).toBe('bad_response');

    // A complete listing: the vanished domain is "not found in connected account" — kept, never deleted or expired.
    const complete = await sync(agency);
    expect(complete.summary.markedMissing).toBe(1);
    const gone = (await rawRecords(agency.id)).find((r) => r.domainName === 'keep000.com');
    expect(gone.providerMissingSince).not.toBeNull();
    expect(gone.providerExpiresOn).toBe(isoInDays(60));
    expect(gone.providerIsExpired).toBe(false);
  });

  test('manual overrides survive every sync, with the provider value shown alongside', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'override.com', expires: '2027-01-01', autoRenew: true }], prices: { com: { price: '15.98' } } });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    const { client } = await newClient(admin, { name: 'Override Co', websiteUrl: 'override.com' });
    await flushBackgroundWork();
    await sync(agency);
    const [record] = await rawRecords(agency.id);

    expect((await admin('patch', `/api/v1/domains/${record.id}`).send({
      manualExpiresOn: '2027-02-01', manualAutoRenew: 'off', renewalPriceCents: 2500, notes: 'Client pays renewals directly',
    })).status).toBe(200);
    api.domains[0].expires = '2028-01-01';
    await sync(agency);

    const view = (await admin('get', `/api/v1/clients/${client.id}/domains`)).body.data;
    const [domain] = view.domains;
    expect(domain.expiresOn).toEqual({ value: '2027-02-01', source: 'manual', providerValue: '2028-01-01' });
    expect(domain.autoRenew).toEqual({ value: false, source: 'manual', providerValue: true });
    expect(domain.renewal).toMatchObject({ cents: 2500, source: 'manual', estimate: { cents: 1598 } });
    expect(domain.notes).toBe('Client pays renewals directly');
  });

  test('estimates come from the price list; premium domains stay unknown; nothing becomes a historical cost', async () => {
    const api = new FakeNamecheapApi({
      domains: [{ name: 'standard.com', expires: isoInDays(300) }, { name: 'premium.com', expires: isoInDays(300), isPremium: true }],
      prices: { com: { price: '15.98', yours: '14.58', fee: '0.20' } },
    });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    await sync(agency);
    const [premium, standard] = await rawRecords(agency.id);
    expect(standard).toMatchObject({ estimatedRenewalCents: 1478, estimatedRenewalYears: 1, estimatedRenewalCurrency: 'USD' });
    expect(standard.estimatedRenewalNote).toMatch(/Estimate.*Taxes/);
    expect(premium.estimatedRenewalCents).toBeNull();
    expect(premium.estimatedRenewalNote).toMatch(/Premium domain/);
    const [[{ count }]] = await sequelize.query('SELECT count(*)::int AS count FROM "ServiceExpenses" WHERE "agencyOrganizationId" = :id', { replacements: { id: agency.id } });
    expect(count).toBe(0);
  });

  test('nameservers are fetched for linked domains; Namecheap SSL certificates attach to their domain', async () => {
    const api = new FakeNamecheapApi({
      domains: [{ name: 'linked.com', expires: isoInDays(120), isOurDns: false }, { name: 'unlinked.com', expires: isoInDays(120) }],
      nameservers: { 'linked.com': ['ns1.cloudflare.com', 'ns2.cloudflare.com'] },
      ssl: [{ host: 'www.linked.com', expires: isoInDays(40) }],
    });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    const { client } = await newClient(admin, { name: 'Linked Co', websiteUrl: 'https://linked.com' });
    await flushBackgroundWork();
    await sync(agency);
    const dnsCalls = api.calls.filter((c) => c.Command === 'namecheap.domains.dns.getList').map((c) => `${c.SLD}.${c.TLD}`);
    expect(dnsCalls).toContain('linked.com');
    expect(dnsCalls).not.toContain('unlinked.com');
    const [domain] = (await admin('get', `/api/v1/clients/${client.id}/domains`)).body.data.domains;
    expect(domain.dns.nameservers).toEqual(['ns1.cloudflare.com', 'ns2.cloudflare.com']);
    expect(domain.dns.provider).toEqual({ value: null, source: null });
    expect(domain.sslCertificates).toEqual([expect.objectContaining({ hostName: 'www.linked.com', expiresOn: isoInDays(40) })]);
  });
});

describe('Leadzaro → Namecheap matching', () => {
  test('different URL formats on a client and its project match the same Namecheap domain', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'havenfit.com', expires: isoInDays(45), autoRenew: true }] });
    const { admin } = await workspace(api);
    await connect(admin, api);

    const created = await newClient(admin, { name: 'Haven Fit', websiteUrl: 'https://www.HavenFit.com/' });
    expect(created.domainMatch).toMatchObject({ state: 'linked', label: 'Matched in Namecheap', domainName: 'havenfit.com' });
    expect(created.domainMatch.preview).toMatchObject({ registrar: 'Namecheap', expiresOn: isoInDays(45), autoRenew: true });

    const project = await admin('post', `/api/v1/clients/${created.client.id}/projects`).send({ name: 'Site', liveUrl: 'havenfit.com/about' });
    expect(project.body.data.domainMatch).toMatchObject({ state: 'linked', hostname: 'havenfit.com' });

    const view = (await admin('get', `/api/v1/clients/${created.client.id}/domains`)).body.data;
    expect(view.domains).toHaveLength(1);
    expect(view.domains[0].links.map((l) => l.source).sort()).toEqual(['client_website', 'project_url']);
    expect(view.domains[0]).toMatchObject({ providerMatched: true, registrar: { value: 'Namecheap', source: 'namecheap' } });
  });

  test('two clients claiming one domain are flagged until someone confirms which client owns it', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'shared.com', expires: isoInDays(100) }] });
    const { admin } = await workspace(api);
    await connect(admin, api);
    const a = await newClient(admin, { name: 'Shared A', websiteUrl: 'shared.com' });
    const b = await newClient(admin, { name: 'Shared B', websiteUrl: 'https://shared.com/b' });
    expect(b.domainMatch).toMatchObject({ state: 'conflict', otherClientIds: [a.client.id] });

    const review = (await admin('get', '/api/v1/domains/review')).body.data;
    expect(review.conflicts.map((c) => c.domainName)).toContain('shared.com');

    const aView = (await admin('get', `/api/v1/clients/${a.client.id}/domains`)).body.data;
    expect(aView.domains[0].providerMatched).toBe(false);
    expect(aView.domains[0].providerPreview).toMatchObject({ registrar: 'Namecheap' });
    const aLink = aView.domains[0].links[0];
    const confirm = await admin('patch', `/api/v1/clients/${a.client.id}/domain-links/${aLink.id}`).send({ decision: 'confirm' });
    expect(confirm.body.data.match).toMatchObject({ state: 'linked' });

    const bView = (await admin('get', `/api/v1/clients/${b.client.id}/domains`)).body.data;
    expect(bView.domains[0].links[0]).toMatchObject({ state: 'conflict', otherClients: [{ id: a.client.id, name: 'Shared A' }] });
    const bConfirm = await admin('patch', `/api/v1/clients/${b.client.id}/domain-links/${bView.domains[0].links[0].id}`).send({ decision: 'confirm' });
    expect(bConfirm.status).toBe(409);
  });

  test('a match through a subdomain only (e.g. our own agency domain) waits for review', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'ouragency.com', expires: isoInDays(200) }] });
    const { admin } = await workspace(api);
    await connect(admin, api);
    const created = await newClient(admin, { name: 'Hosted Client', websiteUrl: 'https://client1.ouragency.com' });
    expect(created.domainMatch).toMatchObject({ state: 'review', hostname: 'client1.ouragency.com', domainName: 'ouragency.com' });
  });

  test('registered elsewhere, hosted on a Namecheap plan: "Not found in connected account" plus manual details', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'something-else.com', expires: isoInDays(200) }] });
    const { admin } = await workspace(api);
    await connect(admin, api);
    const created = await newClient(admin, { name: 'GoDaddy Client', websiteUrl: 'godaddyclient.com' });
    expect(created.domainMatch).toMatchObject({ state: 'not_found', label: 'Not found in connected account' });

    let view = (await admin('get', `/api/v1/clients/${created.client.id}/domains`)).body.data;
    await admin('patch', `/api/v1/domains/${view.domains[0].id}`).send({ registrarName: 'GoDaddy', manualExpiresOn: '2027-04-01', manualAutoRenew: 'on' });
    const plan = await admin('post', '/api/v1/domains/hosting-plans').send({
      name: 'Stellar Plus', providerName: 'Namecheap', planName: 'Stellar Plus', costCents: 4488, billingPeriodMonths: 12, clientId: created.client.id,
    });
    expect(plan.status).toBe(201);

    view = (await admin('get', `/api/v1/clients/${created.client.id}/domains`)).body.data;
    expect(view.domains[0]).toMatchObject({
      registrar: { value: 'GoDaddy', source: 'manual' },
      expiresOn: { value: '2027-04-01', source: 'manual' },
      autoRenew: { value: true, source: 'manual' },
      inConnectedAccount: false,
    });
    expect(view.domains[0].links[0].stateLabel).toBe('Not found in connected account');
    expect(view.hosting).toEqual([expect.objectContaining({ name: 'Stellar Plus', providerName: 'Namecheap' })]);
  });

  test('changing a project’s URL re-evaluates the match; nothing from the old domain carries over', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'old-site.com', expires: isoInDays(30) }, { name: 'new-site.com', expires: isoInDays(300) }] });
    const { admin } = await workspace(api);
    await connect(admin, api);
    const { client } = await newClient(admin, { name: 'Mover' });
    const created = await admin('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'Site', liveUrl: 'old-site.com' });
    const projectId = created.body.data.project.id;
    const oldLinkId = created.body.data.domainMatch.linkId;
    await admin('patch', `/api/v1/clients/${client.id}/domain-links/${oldLinkId}`).send({ decision: 'confirm' });

    const moved = await admin('patch', `/api/v1/clients/${client.id}/projects/${projectId}`).send({ liveUrl: 'https://new-site.com' });
    expect(moved.body.data.domainMatch).toMatchObject({ state: 'linked', domainName: 'new-site.com' });
    expect(moved.body.data.domainMatch.linkId).not.toBe(oldLinkId);

    const view = (await admin('get', `/api/v1/clients/${client.id}/domains`)).body.data;
    expect(view.domains.map((d) => d.domainName)).toEqual(['new-site.com']);
    expect(view.domains[0].links[0]).toMatchObject({ override: null, linkedBy: 'auto' });
    const review = (await admin('get', '/api/v1/domains/review')).body.data;
    expect(review.unlinked.map((d) => d.domainName)).toContain('old-site.com');
  });

  test('saving never needs a match; a stale inventory is refreshed with one lookup; "Check again" retries', async () => {
    const api = new FakeNamecheapApi({ domains: [] });
    const { admin } = await workspace(api);
    const offline = await newClient(admin, { name: 'Offline Client', websiteUrl: 'freshly-bought.com' });
    expect(offline.domainMatch).toMatchObject({ state: 'manual' });

    await connect(admin, api);
    // Bought after the last sync: not in the imported inventory yet.
    api.domains.push({ name: 'freshly-bought.com', expires: isoInDays(365) });
    api.calls.length = 0;
    const lookup = await admin('get', '/api/v1/domains/lookup?url=https://www.freshly-bought.com/shop');
    expect(lookup.body.data.match).toMatchObject({ state: 'matched', domainName: 'freshly-bought.com', hostname: 'freshly-bought.com' });
    expect(api.calls).toEqual([expect.objectContaining({ Command: 'namecheap.domains.getList', SearchTerm: 'freshly-bought.com' })]);
    expect(lookup.body.data.match.linkedElsewhere).toEqual([{ clientId: offline.client.id, clientName: 'Offline Client' }]);

    await admin('get', '/api/v1/domains/lookup?url=freshly-bought.com');
    expect(api.calls).toHaveLength(1);

    const missing = await admin('get', '/api/v1/domains/lookup?url=not-in-account.com');
    expect(missing.body.data.match).toMatchObject({ state: 'not_found', label: 'Not found in connected account' });

    const created = await newClient(admin, { name: 'Later Buy', websiteUrl: 'later-buy.com' });
    expect(created.domainMatch.state).toBe('not_found');
    api.domains.push({ name: 'later-buy.com', expires: isoInDays(365) });
    const view = (await admin('get', `/api/v1/clients/${created.client.id}/domains`)).body.data;
    const again = await admin('post', `/api/v1/domains/${view.domains[0].id}/check`);
    expect(again.body.data.check).toMatchObject({ checked: true, found: true });
    const after = (await admin('get', `/api/v1/clients/${created.client.id}/domains`)).body.data;
    expect(after.domains[0].links[0].state).toBe('linked');
  });
});

describe('Namecheap → Leadzaro: unlinked domains', () => {
  test('a sync never creates clients; unlinked domains are listed with name-based suggestions', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'havenfitclub.com', expires: isoInDays(80) }] });
    const { agency, admin } = await workspace(api);
    await newClient(admin, { name: 'Haven Fit Club' });
    await connect(admin, api);
    const clientsBefore = await Organization.count({ where: { managingAgencyOrganizationId: agency.id, type: 'client' } });
    await sync(agency);
    expect(await Organization.count({ where: { managingAgencyOrganizationId: agency.id, type: 'client' } })).toBe(clientsBefore);

    const review = (await admin('get', '/api/v1/domains/review')).body.data;
    expect(review.unlinked).toEqual([expect.objectContaining({
      domainName: 'havenfitclub.com', suggestedClientName: 'Havenfitclub', suggestions: [expect.objectContaining({ clientName: 'Haven Fit Club', strength: 2 })],
    })]);
  });

  test('"Create client/project" creates everything only on Save, all or nothing, leaving unknowns empty', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'freshbakery.com', expires: isoInDays(150) }] });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    await sync(agency);
    const [record] = await rawRecords(agency.id);
    const clientCount = () => Organization.count({ where: { managingAgencyOrganizationId: agency.id, type: 'client' } });

    const bad = await admin('post', `/api/v1/domains/${record.id}/create-client`).send({ client: { name: 'Fresh Bakery' }, contact: { email: 'owner@freshbakery.com' } });
    expect(bad.status).toBe(422);
    expect(await clientCount()).toBe(0);

    const created = await admin('post', `/api/v1/domains/${record.id}/create-client`).send({ client: { name: 'Fresh Bakery' } });
    expect(created.status).toBe(201);
    expect(created.body.data.domainMatch).toMatchObject({ state: 'linked', domainName: 'freshbakery.com' });
    expect(await clientCount()).toBe(1);

    const detail = (await admin('get', `/api/v1/clients/${created.body.data.client.id}`)).body.data;
    expect(detail.profile.websiteUrl).toBe('https://freshbakery.com');
    expect(detail.contacts).toEqual([]);
    expect(detail.profile.recurringPriceCents).toBeNull();
    expect(detail.projects).toEqual([expect.objectContaining({ name: 'Website', projectType: 'website', liveUrl: 'https://freshbakery.com' })]);
    expect(await Contact.count({ where: { organizationId: created.body.data.client.id } })).toBe(0);

    expect((await admin('post', `/api/v1/domains/${record.id}/create-client`).send({ client: { name: 'Another' } })).status).toBe(409);
  });

  test('"Link to existing" and "Ignore"', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'linkme.com', expires: isoInDays(150) }, { name: 'ours-internal.com', expires: isoInDays(150) }] });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    const { client } = await newClient(admin, { name: 'Link Me' });
    const project = (await admin('post', `/api/v1/clients/${client.id}/projects`).send({ name: 'App' })).body.data.project;
    await sync(agency);
    const [linkRecord, ignoreRecord] = await rawRecords(agency.id);

    const linked = await admin('post', `/api/v1/domains/${linkRecord.id}/link`).send({ clientId: client.id, projectId: project.id });
    expect(linked.body.data.match).toMatchObject({ state: 'linked', domainName: 'linkme.com' });
    expect((await admin('post', `/api/v1/domains/${ignoreRecord.id}/ignore`)).status).toBe(200);

    const review = (await admin('get', '/api/v1/domains/review')).body.data;
    expect(review.unlinked).toHaveLength(0);
    expect(review.ignored.map((d) => d.domainName)).toEqual(['ours-internal.com']);
    const projectView = (await admin('get', `/api/v1/projects/${project.id}/domains`)).body.data;
    expect(projectView.domains).toEqual([expect.objectContaining({ domainName: 'linkme.com', relevance: 'project' })]);
  });
});

describe('Hosting plans and costs', () => {
  test('one shared plan across three clients is split, never counted in full for each', async () => {
    const { admin } = await workspace();
    const clients = [];
    for (const name of ['Plan A', 'Plan B', 'Plan C']) clients.push((await newClient(admin, { name })).client);
    const plan = (await admin('post', '/api/v1/domains/hosting-plans').send({
      name: 'Shared cPanel', providerName: 'Namecheap', costCents: 3000, billingPeriodMonths: 1, allocationMethod: 'equal',
    })).body.data.plan;
    for (const client of clients) {
      // eslint-disable-next-line no-await-in-loop
      await admin('put', `/api/v1/domains/hosting-plans/${plan.id}/clients/${client.id}`).send({ projectIds: [] });
    }
    const plans = (await admin('get', '/api/v1/domains/hosting-plans')).body.data.plans;
    expect(plans[0]).toMatchObject({ costCents: 3000, shared: true, allocation: { allocatedCents: 3000, unallocatedCents: 0 } });

    const costs = (await admin('get', `/api/v1/clients/${clients[0].id}/domains`)).body.data.costs;
    expect(costs.allocatedHosting).toMatchObject({ knownCents: 12000, unknownCount: 0 });
    expect(costs.total.knownCents).toBe(12000);

    const tooMuch = await admin('patch', `/api/v1/domains/hosting-plans/${plan.id}`).send({ allocationMethod: 'manual' });
    expect(tooMuch.status).toBe(200);
    await admin('put', `/api/v1/domains/hosting-plans/${plan.id}/clients/${clients[0].id}`).send({ allocatedCents: 2500 });
    const over = await admin('put', `/api/v1/domains/hosting-plans/${plan.id}/clients/${clients[1].id}`).send({ allocatedCents: 1000 });
    expect(over.status).toBe(422);
    const unknownShare = (await admin('get', `/api/v1/clients/${clients[2].id}/domains`)).body.data.costs;
    expect(unknownShare.allocatedHosting).toMatchObject({ knownCents: null, unknownCount: 1 });

    await admin('patch', `/api/v1/domains/hosting-plans/${plan.id}`).send({ allocationMethod: 'none' });
    const overhead = (await admin('get', `/api/v1/clients/${clients[0].id}/domains`)).body.data.costs;
    expect(overhead.notCharged).toEqual(['Shared cPanel']);
    expect(overhead.total.knownCents).toBeNull();
  });

  test('costs are internal: a team member without projects.manage sees the facts but no amounts', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'factsonly.com', expires: isoInDays(70) }], prices: { com: { price: '15.98' } } });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    const { client } = await newClient(admin, { name: 'Facts Only', websiteUrl: 'factsonly.com' });
    await sync(agency);
    const designer = await memberOf(agency, ['designer']);
    const view = (await designer('get', `/api/v1/clients/${client.id}/domains`)).body.data;
    expect(view.canSeeInternals).toBe(false);
    expect(view.costs).toBeNull();
    expect(view.domains[0].expiresOn.value).toBe(isoInDays(70));
    expect(view.domains[0]).not.toHaveProperty('renewal');
    expect(view.domains[0]).not.toHaveProperty('expenses');
    const renewals = (await designer('get', '/api/v1/domains/renewals?window=all')).body.data;
    expect(renewals.items[0]).not.toHaveProperty('cost');
    expect((await designer('patch', `/api/v1/domains/${view.domains[0].id}`).send({ notes: 'x' })).status).toBe(403);
  });

  test('actual payments are recorded by hand and kept apart from estimates', async () => {
    const { admin } = await workspace();
    const { client } = await newClient(admin, { name: 'Paid Co', websiteUrl: 'paidco.com' });
    const view = (await admin('get', `/api/v1/clients/${client.id}/domains`)).body.data;
    const domainId = view.domains[0].id;
    expect((await admin('post', `/api/v1/domains/${domainId}/expenses`).send({ amountCents: '', paidOn: '2026-01-10' })).status).toBe(422);
    expect((await admin('post', `/api/v1/domains/${domainId}/expenses`).send({ amountCents: 1598, paidOn: isoInDays(-20), description: 'Renewal 2026' })).status).toBe(201);
    const after = (await admin('get', `/api/v1/clients/${client.id}/domains`)).body.data;
    expect(after.domains[0].expenses).toEqual([expect.objectContaining({ amountCents: 1598, source: 'manual' })]);
    expect(after.domains[0].renewal).toMatchObject({ cents: null, source: null });
    expect(after.costs.paidLast12MonthsCents).toBe(1598);
  });
});

describe('Renewals and reminders', () => {
  test('filters by expired / 7 / 30 / 60 days and never hides auto-renewing items', async () => {
    const api = new FakeNamecheapApi({
      domains: [
        { name: 'lapsed.com', expires: isoInDays(-3), isExpired: true },
        { name: 'week.com', expires: isoInDays(5), autoRenew: true },
        { name: 'month.com', expires: isoInDays(20) },
        { name: 'twomonths.com', expires: isoInDays(50) },
        { name: 'later.com', expires: isoInDays(200) },
      ],
    });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    await sync(agency);
    const all = (await admin('get', '/api/v1/domains/renewals?window=all')).body.data;
    expect(all.counts).toMatchObject({
      expired: 1, 7: 1, 30: 2, 60: 3, all: 5,
    });
    const week = (await admin('get', '/api/v1/domains/renewals?window=7')).body.data;
    expect(week.items).toEqual([expect.objectContaining({ name: 'week.com', autoRenew: { value: true, source: 'namecheap' }, daysUntilExpiry: 5 })]);
    expect((await admin('get', '/api/v1/domains/renewals?window=expired')).body.data.items[0]).toMatchObject({ name: 'lapsed.com', daysUntilExpiry: -3 });
    expect((await admin('get', '/api/v1/domains/renewals?window=bogus')).status).toBe(422);
  });

  test('the daily job syncs when due, then sends in-app reminders once per threshold — no email', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'remindme.com', expires: isoInDays(6), autoRenew: true }] });
    const { agency, admin } = await workspace(api);
    await connect(admin, api);
    const send = jest.spyOn(getEmailAdapter(), 'send');

    await runDueJobs();
    expect((await rawRecords(agency.id)).map((r) => r.domainName)).toEqual(['remindme.com']);
    const notes = await Notification.findAll({ where: { organizationId: agency.id, type: 'renewal_upcoming' } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].title).toMatch(/remindme\.com expires in 6 days/);
    expect(notes[0].body).toMatch(/auto-renew is on — confirm the renewal goes through/);

    const callsBefore = api.calls.length;
    await runDueJobs();
    expect(api.calls.length).toBe(callsBefore);
    expect(await Notification.count({ where: { organizationId: agency.id, type: 'renewal_upcoming' } })).toBe(notes.length);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
});

describe('Workspace isolation', () => {
  test('another workspace can neither see nor touch domains, links, plans or the connection', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'private-a.com', expires: isoInDays(100) }] });
    const a = await workspace(api);
    await connect(a.admin, api);
    const { client } = await newClient(a.admin, { name: 'A Client', websiteUrl: 'private-a.com' });
    const plan = (await a.admin('post', '/api/v1/domains/hosting-plans').send({ name: 'A plan', costCents: 1000, billingPeriodMonths: 1 })).body.data.plan;
    const [record] = await rawRecords(a.agency.id);

    const b = await workspace();
    const { client: bClient } = await newClient(b.admin, { name: 'B Client' });
    expect((await b.admin('get', '/api/v1/domains/review')).body.data.unlinked).toEqual([]);
    expect((await b.admin('get', '/api/v1/domains/renewals?window=all')).body.data.items).toEqual([]);
    expect((await b.admin('get', '/api/v1/domains/hosting-plans')).body.data.plans).toEqual([]);
    expect((await b.admin('get', '/api/v1/integrations/namecheap')).body.data.connection.configured).toBe(false);
    expect((await b.admin('patch', `/api/v1/domains/${record.id}`).send({ notes: 'hijack' })).status).toBe(404);
    expect((await b.admin('post', `/api/v1/domains/${record.id}/link`).send({ clientId: bClient.id })).status).toBe(404);
    expect((await b.admin('post', `/api/v1/domains/${record.id}/create-client`).send({ client: { name: 'Stolen' } })).status).toBe(404);
    expect((await b.admin('get', `/api/v1/clients/${client.id}/domains`)).status).toBe(404);
    expect((await b.admin('put', `/api/v1/domains/hosting-plans/${plan.id}/clients/${bClient.id}`).send({})).status).toBe(404);
    expect((await a.admin('put', `/api/v1/domains/hosting-plans/${plan.id}/clients/${bClient.id}`).send({})).status).toBe(404);
    expect((await b.admin('get', '/api/v1/domains/not-a-uuid/expenses')).status).toBe(404);

    // B looking up A's domain learns nothing about A's clients.
    const lookup = (await b.admin('get', '/api/v1/domains/lookup?url=private-a.com')).body.data.match;
    expect(lookup).toMatchObject({ state: 'not_connected', linkedElsewhere: [] });
  });
});
