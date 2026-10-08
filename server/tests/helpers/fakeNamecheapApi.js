'use strict';

/**
 * TEST-ONLY stand-in for Namecheap's HTTP API. It answers the real
 * NamecheapRegistrarReader through its injectable transport, producing XML
 * in the documented response format (namecheap.com/support/api — getList,
 * dns.getList, getPricing, getBalances, ssl.getList) and the documented
 * global errors, so the parser, pagination, retries and error mapping are
 * all exercised end to end. Never used by the application.
 */

const { NamecheapRegistrarReader, CallBudget } = require('../../core/integrations/namecheap/namecheapRegistrarReader');

const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function ok(command, inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>${command}</RequestedCommand>
  <CommandResponse Type="${command}">${inner}</CommandResponse>
  <Server>TEST</Server><GMTTimeDifference>+5</GMTTimeDifference><ExecutionTime>0.01</ExecutionTime>
</ApiResponse>`;
}

function apiError(number, message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="ERROR">
  <Errors><Error Number="${number}">${escape(message)}</Error></Errors>
  <Warnings />
  <RequestedCommand />
  <Server>TEST</Server><GMTTimeDifference>--5:00</GMTTimeDifference><ExecutionTime>0</ExecutionTime>
</ApiResponse>`;
}

function usDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

class FakeNamecheapApi {
  constructor({
    apiKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', whitelistedIp = '203.0.113.10', domains = [], prices = {}, ssl = [], nameservers = {}, balance = { available: '120.50', autoRenewFunds: '31.96' },
  } = {}) {
    Object.assign(this, {
      apiKey, whitelistedIp, domains, prices, ssl, nameservers, balance,
    });
    this.calls = [];
    this.scripted = []; // [{ command, page?, respond: () => ({ statusCode, body }) | throws }]
    this.transport = this.transport.bind(this);
  }

  /** Makes the next matching call fail (or answer) the given way, once. */
  once(command, respond, { page } = {}) {
    this.scripted.push({ command, page, respond });
  }

  async transport({ url }) {
    const params = Object.fromEntries(new URL(url).searchParams);
    this.calls.push(params);
    const command = params.Command;
    const scriptedIndex = this.scripted.findIndex((entry) => entry.command === command && (!entry.page || String(entry.page) === params.Page));
    if (scriptedIndex >= 0) {
      const [entry] = this.scripted.splice(scriptedIndex, 1);
      return entry.respond(params);
    }
    if (params.ApiKey !== this.apiKey) return { statusCode: 200, body: apiError('1011102', 'API Key is invalid or API access has not been enabled') };
    if (params.ClientIp !== this.whitelistedIp) return { statusCode: 200, body: apiError('1011150', `Invalid request IP: ${params.ClientIp}`) };
    return { statusCode: 200, body: this.answer(command, params) };
  }

  answer(command, params) {
    if (command === 'namecheap.domains.getList') {
      const pageSize = Number(params.PageSize || 20);
      const page = Number(params.Page || 1);
      const matching = params.SearchTerm ? this.domains.filter((d) => d.name.includes(params.SearchTerm.toLowerCase())) : this.domains;
      const slice = matching.slice((page - 1) * pageSize, page * pageSize);
      const rows = slice.map((d, i) => `<Domain ID="${d.id || 1000 + i}" Name="${d.name}" User="owner" Created="${usDate(d.created || '2020-01-15')}" Expires="${usDate(d.expires)}" IsExpired="${Boolean(d.isExpired)}" IsLocked="false" AutoRenew="${d.autoRenew === undefined ? true : d.autoRenew}" WhoisGuard="ENABLED" IsPremium="${Boolean(d.isPremium)}" IsOurDNS="${d.isOurDns === undefined ? true : d.isOurDns}"/>`).join('');
      return ok(command, `<DomainGetListResult>${rows}</DomainGetListResult><Paging><TotalItems>${matching.length}</TotalItems><CurrentPage>${page}</CurrentPage><PageSize>${pageSize}</PageSize></Paging>`);
    }
    if (command === 'namecheap.domains.dns.getList') {
      const domain = `${params.SLD}.${params.TLD}`;
      if (!this.domains.some((d) => d.name === domain)) return apiError('2019166', 'Domain not found');
      const servers = this.nameservers[domain] || ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'];
      const ours = servers.every((ns) => ns.endsWith('registrar-servers.com'));
      return ok(command, `<DomainDNSGetListResult Domain="${domain}" IsUsingOurDNS="${ours}">${servers.map((ns) => `<Nameserver>${ns}</Nameserver>`).join('')}</DomainDNSGetListResult>`);
    }
    if (command === 'namecheap.users.getPricing') {
      const tld = params.ProductName.toLowerCase();
      const price = this.prices[tld];
      const product = price
        ? `<Product Name="${tld}"><Price Duration="1" DurationType="YEAR" Price="${price.price}" RegularPrice="${price.regular || price.price}" YourPrice="${price.yours || price.price}" CouponPrice="" Currency="USD" ${price.fee ? `YourAdditonalCost="${price.fee}"` : ''}/><Price Duration="2" DurationType="YEAR" Price="99.00" RegularPrice="99.00" YourPrice="99.00" CouponPrice="" Currency="USD" /></Product>`
        : '';
      return ok(command, `<UserGetPricingResult><ProductType Name="domain"><ProductCategory Name="renew">${product}</ProductCategory></ProductType></UserGetPricingResult>`);
    }
    if (command === 'namecheap.users.getBalances') {
      return ok(command, `<UserGetBalancesResult Currency="USD" AvailableBalance="${this.balance.available}" AccountBalance="${this.balance.available}" EarnedAmount="0.00" WithdrawableAmount="0.00" FundsRequiredForAutoRenew="${this.balance.autoRenewFunds}" />`);
    }
    if (command === 'namecheap.ssl.getList') {
      const rows = this.ssl.map((c, i) => `<SSL CertificateID="${c.id || 500 + i}" HostName="${c.host}" SSLType="PositiveSSL" PurchaseDate="${usDate(c.purchased || '2025-01-01')}" ExpireDate="${usDate(c.expires)}" ActivationExpireDate="${usDate(c.expires)}" IsExpiredYN="false" Status="active" />`).join('');
      return ok(command, `<SSLListResult>${rows}</SSLListResult><Paging><TotalItems>${this.ssl.length}</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>`);
    }
    return apiError('1010104', 'Unknown command');
  }

  /** Reader factory for namecheapConnectionService.setReaderFactoryForTests: real reader, fake wire, no pacing. */
  readerFactory() {
    return (connection, credentials) => new NamecheapRegistrarReader(credentials, {
      environment: connection.environment, transport: this.transport, budget: new CallBudget({ minIntervalMs: 0 }), sleep: async () => {},
    });
  }

  commandsCalled() {
    return this.calls.map((call) => call.Command);
  }
}

module.exports = { FakeNamecheapApi, ok, apiError };
