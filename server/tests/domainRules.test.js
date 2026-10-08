'use strict';

const {
  parseDomainInput, normalizeRegisteredDomain, splitForRegistrar, suggestClientName, nameResemblance,
} = require('../core/domains/domainName');
const {
  linkState, recordOwnership, domainFacts, hostingShares, tally, annualize,
} = require('../core/domains/domainFacts');

describe('Domain normalization (Public Suffix List aware)', () => {
  test.each([
    'example.com',
    'Example.COM',
    'https://example.com',
    'http://www.example.com/',
    'https://www.example.com/menu/today?x=1#top',
    'www.example.com',
    'example.com.',
    '  https://EXAMPLE.com:8443/  ',
  ])('%s → example.com', (input) => {
    const parsed = parseDomainInput(input);
    expect(parsed).toMatchObject({ ok: true, hostname: 'example.com', registrableDomain: 'example.com', isApex: true });
  });

  test('multi-part public suffixes resolve to the registrable domain', () => {
    expect(parseDomainInput('https://www.shop.example.co.uk/').registrableDomain).toBe('example.co.uk');
    expect(parseDomainInput('example.com.au').registrableDomain).toBe('example.com.au');
    expect(splitForRegistrar('example.co.uk')).toEqual({ sld: 'example', tld: 'co.uk' });
  });

  test('meaningful subdomains are kept on the host; only www is dropped', () => {
    expect(parseDomainInput('https://shop.example.com/cart')).toMatchObject({ hostname: 'shop.example.com', registrableDomain: 'example.com', subdomain: 'shop', isApex: false });
    expect(parseDomainInput('www.app.example.com')).toMatchObject({ hostname: 'app.example.com', subdomain: 'app' });
    expect(parseDomainInput('www.com')).toMatchObject({ hostname: 'www.com', registrableDomain: 'www.com' });
  });

  test('internationalized names are compared in their ASCII form', () => {
    expect(parseDomainInput('https://Bücher.de')).toMatchObject({ registrableDomain: 'xn--bcher-kva.de', displayHostname: 'bücher.de' });
    expect(normalizeRegisteredDomain('xn--bcher-kva.de')).toBe('xn--bcher-kva.de');
  });

  test('platform subdomains have no registration of their own', () => {
    expect(parseDomainInput('https://clientname.github.io').platformSuffix).toBe('github.io');
    expect(parseDomainInput('myshop.myshopify.com').platformSuffix).toBe('myshopify.com');
    expect(parseDomainInput('example.com').platformSuffix).toBeNull();
  });

  test.each([
    ['', 'empty'], ['localhost', 'no_domain'], ['192.168.1.20', 'ip'], ['http://[::1]/', 'ip'], ['mailto:owner@example.com', 'invalid'], ['ftp://example.com', 'invalid'], ['not a url', 'invalid'],
  ])('%j is refused (%s)', (input, code) => {
    expect(parseDomainInput(input)).toMatchObject({ ok: false, code });
  });

  test('a suggested client name comes from the domain and a name match is only ever a suggestion score', () => {
    expect(suggestClientName('best-diner-ny.com')).toBe('Best Diner Ny');
    expect(nameResemblance('Haven Fit Club', 'havenfitclub.com')).toBe(2);
    expect(nameResemblance('J&J Building Restoration LLC', 'jjbuildingrestoration.com')).toBe(2);
    expect(nameResemblance('Leadfarmer', 'leadfarmercannabis.com')).toBe(1);
    expect(nameResemblance('Acme', 'unrelated.com')).toBe(0);
  });
});

function record(overrides = {}) {
  return {
    domainName: 'example.com',
    providerKey: 'namecheap',
    providerLastSeenAt: new Date('2026-09-01T00:00:00Z'),
    providerMissingSince: null,
    providerCheckedAt: null,
    providerExpiresOn: '2027-03-01',
    providerAutoRenew: true,
    providerCreatedOn: '2020-03-01',
    providerSslCertificates: [],
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

const connected = { credentialsCiphertext: 'x', status: 'connected', lastSuccessfulSyncAt: new Date('2026-09-02T00:00:00Z') };
const link = (organizationId, hostname = 'example.com', extra = {}) => ({
  id: `${organizationId}-${hostname}`, organizationId, hostname, linkOverride: null, ...extra,
});

describe('Link states', () => {
  test('one client with an apex link → matched automatically', () => {
    const own = link('A');
    expect(linkState(own, record(), [own], connected)).toMatchObject({ state: 'linked', linkedBy: 'auto' });
  });

  test('two clients claiming one domain → both flagged; a confirmed link wins', () => {
    const a = link('A');
    const b = link('B', 'shop.example.com');
    expect(linkState(a, record(), [a, b], connected).state).toBe('conflict');
    expect(linkState(b, record(), [a, b], connected).state).toBe('conflict');
    const confirmedA = { ...a, linkOverride: 'confirmed' };
    expect(linkState(confirmedA, record(), [confirmedA, b], connected)).toMatchObject({ state: 'linked', linkedBy: 'manual' });
    expect(linkState(b, record(), [confirmedA, b], connected)).toMatchObject({ state: 'conflict', otherOrganizationIds: ['A'] });
  });

  test('only a subdomain link (e.g. a site on our own agency domain) needs review, not an automatic match', () => {
    const sub = link('A', 'clientname.ouragency.com');
    expect(linkState(sub, record({ domainName: 'ouragency.com' }), [sub], connected).state).toBe('review');
  });

  test('a domain missing from the connected account says so — never "expired"', () => {
    const own = link('A');
    expect(linkState(own, record({ providerMissingSince: new Date() }), [own], connected).state).toBe('missing');
    const manualOnly = record({ providerKey: null, providerLastSeenAt: null, providerCheckedAt: new Date() });
    expect(linkState(own, manualOnly, [own], connected).state).toBe('not_found');
    expect(linkState(own, { ...manualOnly, providerCheckedAt: null, createdAt: new Date('2026-09-10') }, [own], connected).state).toBe('pending');
    expect(linkState(own, manualOnly, [own], null).state).toBe('manual');
  });

  test('an unlinked (rejected) link stays unlinked and no longer counts toward ownership', () => {
    const rejected = link('A', 'example.com', { linkOverride: 'rejected' });
    expect(linkState(rejected, record(), [rejected], connected).state).toBe('unlinked');
    expect(recordOwnership(record(), [rejected]).status).toBe('unlinked');
  });
});

describe('Effective values keep their source', () => {
  test('a manual override wins and the provider value is kept alongside', () => {
    const facts = domainFacts(record({ manualExpiresOn: '2027-06-01', manualAutoRenew: false }), connected, new Date('2027-05-01T12:00:00Z'));
    expect(facts.expiresOn).toEqual({ value: '2027-06-01', source: 'manual', providerValue: '2027-03-01' });
    expect(facts.autoRenew).toEqual({ value: false, source: 'manual', providerValue: true });
    expect(facts.daysUntilExpiry).toBe(31);
  });

  test('registrar, DNS and SSL stay separate; nameservers alone never name a host', () => {
    const facts = domainFacts(record({ providerUsesNamecheapDns: false, providerNameservers: ['ns1.cloudflare.com'] }), connected);
    expect(facts.registrar).toMatchObject({ value: 'Namecheap', source: 'namecheap' });
    expect(facts.dns.provider).toEqual({ value: null, source: null });
    expect(facts.dns.nameservers).toEqual(['ns1.cloudflare.com']);
    expect(facts).not.toHaveProperty('hostingProvider');
  });

  test('a domain registered elsewhere shows only what was entered', () => {
    const facts = domainFacts(record({
      providerKey: null, providerLastSeenAt: null, registrarName: 'GoDaddy', manualExpiresOn: '2027-01-10',
    }), connected);
    expect(facts.registrar).toEqual({ value: 'GoDaddy', source: 'manual' });
    expect(facts.expiresOn).toMatchObject({ value: '2027-01-10', source: 'manual' });
    expect(facts.autoRenew).toEqual({ value: null, source: null });
  });

  test('renewal cost: manual beats estimate; no estimate and no entry is unknown, never $0', () => {
    expect(domainFacts(record({ estimatedRenewalCents: 1598, estimatedRenewalYears: 1, estimatedRenewalCurrency: 'USD' }), connected).renewal).toMatchObject({ cents: 1598, source: 'estimate', periodMonths: 12 });
    expect(domainFacts(record({ estimatedRenewalCents: 1598, renewalPriceCents: 2000 }), connected).renewal).toMatchObject({ cents: 2000, source: 'manual', estimate: { cents: 1598 } });
    expect(domainFacts(record({ providerIsPremium: true, estimatedRenewalCents: null }), connected).renewal).toMatchObject({ cents: null, source: null });
  });
});

describe('Shared hosting allocation', () => {
  const clients = [{ organizationId: 'a' }, { organizationId: 'b' }, { organizationId: 'c' }];

  test('equal split sums exactly to the plan cost (never the full bill per client)', () => {
    const shares = hostingShares({ costCents: 10000, allocationMethod: 'equal' }, clients);
    const values = [...shares.values()];
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  test('manual allocation uses entered amounts; unset stays unknown; none charges nobody', () => {
    const manual = hostingShares({ costCents: 10000, allocationMethod: 'manual' }, [{ organizationId: 'a', allocatedCents: 7000 }, { organizationId: 'b', allocatedCents: null }]);
    expect(manual.get('a')).toBe(7000);
    expect(manual.get('b')).toBeNull();
    expect([...hostingShares({ costCents: 10000, allocationMethod: 'none' }, clients).values()]).toEqual([null, null, null]);
    expect([...hostingShares({ costCents: null, allocationMethod: 'equal' }, clients).values()]).toEqual([null, null, null]);
  });

  test('totals report unknowns instead of treating them as zero', () => {
    expect(tally([1200, null, 800])).toEqual({
      knownCents: 2000, knownCount: 2, unknownCount: 1, complete: false,
    });
    expect(tally([null]).knownCents).toBeNull();
    expect(annualize(1000, 1)).toBe(12000);
    expect(annualize(null, 12)).toBeNull();
  });
});
