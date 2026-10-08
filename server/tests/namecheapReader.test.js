'use strict';

const https = require('node:https');
const { EventEmitter } = require('node:events');
const {
  NamecheapRegistrarReader, CallBudget, RegistrarError, parseUsDate, parseMoneyCents, READ_ONLY_COMMANDS,
} = require('../core/integrations/namecheap/namecheapRegistrarReader');
const { FakeNamecheapApi, apiError } = require('./helpers/fakeNamecheapApi');

const CREDENTIALS = {
  apiUser: 'twgapi', apiKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', userName: 'twgapi', clientIp: '203.0.113.10',
};

function reader(transport, { sleep = async () => {} } = {}) {
  return new NamecheapRegistrarReader(CREDENTIALS, { transport, budget: new CallBudget({ minIntervalMs: 0 }), sleep });
}

// namecheap.domains.getList example response, verbatim from Namecheap's API documentation.
const DOCUMENTED_GET_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>namecheap.domains.getList</RequestedCommand>
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="domain1.com" User="owner" Created="02/15/2016" Expires="02/15/2022" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="true" IsOurDNS="true"/>
      <Domain ID="381" Name="domain2.com" User="owner" Created="04/28/2016" Expires="04/28/2023" IsExpired="false" IsLocked="false" AutoRenew="true" WhoisGuard="NOTPRESENT" IsPremium="false" IsOurDNS="true"/>
      <Domain ID="385" Name="domain3.com" User="owner" Created="05/22/2016" Expires="05/22/2023" IsExpired="false" IsLocked="false" AutoRenew="true" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="false"/>
    </DomainGetListResult>
    <Paging>
      <TotalItems>2</TotalItems>
      <CurrentPage>1</CurrentPage>
      <PageSize>10</PageSize>
    </Paging>
  </CommandResponse>
  <Server>SERVER-NAME</Server>
  <GMTTimeDifference>+5</GMTTimeDifference>
  <ExecutionTime>0.078</ExecutionTime>
</ApiResponse>`;

describe('Namecheap reader — parsing documented responses', () => {
  test('the documented getList example parses into domains with typed fields', async () => {
    const page = await reader(async () => ({ statusCode: 200, body: DOCUMENTED_GET_LIST })).listDomainsPage(1);
    expect(page.domains).toHaveLength(3);
    expect(page.domains[0]).toEqual({
      providerDomainId: '127',
      domainName: 'domain1.com',
      reportedName: 'domain1.com',
      accountUser: 'owner',
      createdOn: '2016-02-15',
      expiresOn: '2022-02-15',
      isExpired: false,
      isLocked: false,
      autoRenew: false,
      privacy: 'ENABLED',
      isPremium: true,
      usesNamecheapDns: true,
    });
    expect(page.totalItems).toBe(2);
  });

  test('dates are MM/DD/YYYY; anything else is unknown rather than guessed', () => {
    expect(parseUsDate('02/15/2016')).toBe('2016-02-15');
    expect(parseUsDate('02/30/2025')).toBeNull();
    expect(parseUsDate('2025-02-01')).toBeNull();
    expect(parseUsDate('')).toBeNull();
    expect(parseMoneyCents('8.55')).toBe(855);
    expect(parseMoneyCents('')).toBeNull();
    expect(parseMoneyCents('abc')).toBeNull();
  });

  test('renewal prices, nameservers, balances and SSL certificates parse', async () => {
    const api = new FakeNamecheapApi({
      domains: [{ name: 'example.co.uk', expires: '2027-01-01' }],
      prices: { com: { price: '15.98', yours: '14.58', fee: '0.20' } },
      nameservers: { 'example.co.uk': ['ns1.cloudflare.com', 'ns2.cloudflare.com'] },
      ssl: [{ host: 'www.example.co.uk', expires: '2027-02-01' }],
    });
    const r = reader(api.transport);
    expect(await r.getRenewalPrices('com')).toEqual([
      expect.objectContaining({
        years: 1, yourPriceCents: 1458, priceCents: 1598, additionalCents: 20, currency: 'USD',
      }),
      expect.objectContaining({ years: 2 }),
    ]);
    expect(await r.getNameservers('example.co.uk')).toEqual({ usesNamecheapDns: false, nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'] });
    expect(api.calls.at(-1)).toMatchObject({ SLD: 'example', TLD: 'co.uk' });
    expect(await r.getBalances()).toEqual({ currency: 'USD', availableBalanceCents: 12050, fundsRequiredForAutoRenewCents: 3196 });
    const ssl = await r.listSslCertificatesPage(1);
    expect(ssl.certificates[0]).toMatchObject({ hostName: 'www.example.co.uk', expiresOn: '2027-02-01', status: 'active' });
  });
});

describe('Namecheap reader — errors, retries and safety', () => {
  test('a non-whitelisted IP is a clear, non-retried error', async () => {
    const api = new FakeNamecheapApi();
    const r = new NamecheapRegistrarReader({ ...CREDENTIALS, clientIp: '198.51.100.7' }, { transport: api.transport, budget: new CallBudget({ minIntervalMs: 0 }), sleep: async () => {} });
    await expect(r.testConnection()).rejects.toMatchObject({ kind: 'ip_not_allowed', providerCode: '1011150', retryable: false });
    expect(api.calls).toHaveLength(1);
  });

  test('a wrong API key is reported as invalid credentials', async () => {
    const api = new FakeNamecheapApi({ apiKey: 'somethingelse0123456789' });
    await expect(reader(api.transport).testConnection()).rejects.toMatchObject({ kind: 'invalid_credentials', providerCode: '1011102' });
  });

  test('rate limiting (500000) is retried after a backoff', async () => {
    const api = new FakeNamecheapApi({ domains: [{ name: 'example.com', expires: '2027-01-01' }] });
    api.once('namecheap.domains.getList', () => ({ statusCode: 200, body: apiError('500000', 'Too many requests') }));
    const sleeps = [];
    const page = await reader(api.transport, { sleep: async (ms) => { sleeps.push(ms); } }).listDomainsPage(1);
    expect(page.domains).toHaveLength(1);
    expect(sleeps).toEqual([30000]);
  });

  test('an HTML page or HTTP 5xx instead of XML is retried, then reported without guessing', async () => {
    const htmlOnly = async () => ({ statusCode: 200, body: '<html><body>Just a moment...</body></html>' });
    await expect(reader(htmlOnly).listDomainsPage(1)).rejects.toMatchObject({ kind: 'bad_response' });
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      return calls === 1 ? { statusCode: 503, body: 'unavailable' } : { statusCode: 200, body: DOCUMENTED_GET_LIST };
    };
    expect((await reader(flaky).listDomainsPage(1)).domains).toHaveLength(3);
  });

  test('the API key never appears in an error, even if Namecheap echoes it', async () => {
    const echo = async () => ({ statusCode: 200, body: apiError('2011170', `Bad parameter ApiKey=${CREDENTIALS.apiKey}`) });
    const err = await reader(echo).getRenewalPrices('com').catch((e) => e);
    expect(err).toBeInstanceOf(RegistrarError);
    expect(JSON.stringify(err.toJSON())).not.toContain(CREDENTIALS.apiKey);
    expect(err.message).not.toContain(CREDENTIALS.apiKey);
  });

  test('only read commands can be sent — nothing can renew, buy, transfer or change DNS', async () => {
    const transport = jest.fn();
    const r = reader(transport);
    for (const command of ['namecheap.domains.renew', 'namecheap.domains.create', 'namecheap.domains.dns.setHosts', 'namecheap.domains.dns.setCustom', 'namecheap.domains.setRegistrarLock']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(r.call(command)).rejects.toThrow(/read-only/);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  test('requests go out over IPv4 only (Namecheap whitelists IPv4 addresses)', async () => {
    const spy = jest.spyOn(https, 'get').mockImplementation((url, options, callback) => {
      const request = new EventEmitter();
      request.destroy = () => {};
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        response.emit('data', Buffer.from(DOCUMENTED_GET_LIST));
        response.emit('end');
      });
      return request;
    });
    try {
      const r = new NamecheapRegistrarReader(CREDENTIALS, { budget: new CallBudget({ minIntervalMs: 0 }) });
      await r.listDomainsPage(1);
      expect(spy.mock.calls[0][1]).toMatchObject({ family: 4 });
      expect(String(spy.mock.calls[0][0])).toMatch(/^https:\/\/api\.namecheap\.com\/xml\.response\?/);
    } finally {
      spy.mockRestore();
    }
  });

  test('the call budget stops before the hourly limit instead of hammering the API', async () => {
    const budget = new CallBudget({ minIntervalMs: 0, hourlyLimit: 2 });
    await budget.acquire();
    await budget.acquire();
    await expect(budget.acquire()).rejects.toMatchObject({ kind: 'budget_exhausted' });
  });
});
