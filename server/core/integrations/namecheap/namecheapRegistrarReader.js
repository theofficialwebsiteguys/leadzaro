'use strict';

const https = require('node:https');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { normalizeRegisteredDomain, splitForRegistrar } = require('../../domains/domainName');

/**
 * Read-only access to a Namecheap account (ADR 0009), behind the
 * RegistrarReader adapter interface the architecture requires for
 * Namecheap (§ 16). Separate from namecheapAdapter.js, which belongs to
 * the hidden website builder and models write operations.
 *
 * Verified against Namecheap's API documentation (2025): requests are
 * HTTP GET to /xml.response with ApiUser, ApiKey, UserName, ClientIp and
 * Command; responses are XML <ApiResponse Status="OK|ERROR">; the whitelist
 * accepts IPv4 only; getList pages hold 10–100 domains. The API has no
 * hosting, invoice or payment-history commands, so none are modeled.
 *
 * Only the commands in READ_ONLY_COMMANDS can ever be sent — nothing in
 * this module can purchase, renew, transfer, change DNS or auto-renew.
 * The API key travels in the query string (Namecheap's documented
 * method), so request URLs are never logged, stored or put in errors.
 */

const ENDPOINTS = {
  production: 'https://api.namecheap.com/xml.response',
  sandbox: 'https://api.sandbox.namecheap.com/xml.response',
};

const READ_ONLY_COMMANDS = new Set([
  'namecheap.domains.getList',
  'namecheap.domains.dns.getList',
  'namecheap.users.getPricing',
  'namecheap.users.getBalances',
  'namecheap.ssl.getList',
]);

const PAGE_SIZE = 100; // Namecheap's documented maximum for getList/ssl.getList.
const MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

class RegistrarError extends Error {
  constructor(kind, message, { providerCode = null, retryable = false, providerMessage = null } = {}) {
    super(message);
    this.name = 'RegistrarError';
    this.kind = kind;
    this.providerCode = providerCode;
    this.retryable = retryable;
    this.providerMessage = providerMessage;
  }

  toJSON() {
    return {
      kind: this.kind, message: this.message, providerCode: this.providerCode, providerMessage: this.providerMessage,
    };
  }
}

const WHITELIST_HELP = 'In Namecheap go to Profile → Tools → Namecheap API Access → Whitelisted IPs, add this server’s public IPv4 address, and make sure the Client IP saved in Leadzaro is that same address.';

// Namecheap's documented global error numbers (plus 500000, which the API
// returns when its rate limit is hit), mapped to what an admin can act on.
const PROVIDER_ERRORS = new Map([
  ['1011150', ['ip_not_allowed', `Namecheap rejected the IP address this request came from. ${WHITELIST_HELP}`]],
  ['1017150', ['ip_not_allowed', `Namecheap reports the request IP as disabled or locked. ${WHITELIST_HELP}`]],
  ['2017289', ['ip_not_allowed', `Namecheap blocked the request IP. ${WHITELIST_HELP}`]],
  ['1010105', ['client_ip_invalid', 'The Client IP is missing. Enter the public IPv4 address you whitelisted in Namecheap.']],
  ['1011105', ['client_ip_invalid', 'The Client IP is missing. Enter the public IPv4 address you whitelisted in Namecheap.']],
  ['1017105', ['client_ip_invalid', `Namecheap reports the Client IP as disabled or locked. ${WHITELIST_HELP}`]],
  ['1010101', ['invalid_credentials', 'The API user is missing. Enter your Namecheap username as the API user.']],
  ['1017101', ['invalid_credentials', 'Namecheap reports this API user as disabled or locked.']],
  ['1050900', ['invalid_credentials', 'Namecheap could not validate the API user.']],
  ['1010102', ['invalid_credentials', 'Namecheap rejected the API key. It may be mistyped, reset, or API access may be turned off (Profile → Tools → Namecheap API Access).']],
  ['1011102', ['invalid_credentials', 'Namecheap rejected the API key. It may be mistyped, reset, or API access may be turned off (Profile → Tools → Namecheap API Access).']],
  ['1030408', ['invalid_credentials', 'Namecheap rejected the authentication type.']],
  ['1019103', ['account_unavailable', 'Namecheap does not recognize this username.']],
  ['1016103', ['account_unavailable', 'This username is not authorized for API access.']],
  ['1017103', ['account_unavailable', 'Namecheap reports this username as disabled or locked.']],
  ['1017410', ['account_unavailable', 'Namecheap has restricted this account (too many declined payments).']],
  ['1017411', ['account_unavailable', 'Namecheap has temporarily locked this account (too many login attempts).']],
  ['500000', ['rate_limited', 'Namecheap is rate-limiting requests right now. Leadzaro will slow down and try again.']],
  ['2019166', ['not_in_account', 'Namecheap could not find this domain.']],
  ['2016166', ['not_in_account', 'This domain is not associated with the connected Namecheap account.']],
  ['2030166', ['invalid_domain', 'Namecheap reports this domain name as invalid.']],
]);

const RETRYABLE_KINDS = new Set(['rate_limited', 'timeout', 'network', 'unavailable', 'bad_response']);

// ─── Transport ─────────────────────────────────────────────────────────

/**
 * GET over IPv4 only: Namecheap's whitelist accepts IPv4 addresses, so a
 * dual-stack server must never reach it over IPv6. Errors carry a kind and
 * a system code at most — never the URL, which contains the API key.
 */
function httpsGet({ url, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      timeout: timeoutMs,
      headers: { Accept: 'application/xml, text/xml', 'User-Agent': 'Leadzaro/1.0 (read-only registrar sync)' },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy();
          reject(new RegistrarError('bad_response', 'Namecheap sent an unexpectedly large response.', { retryable: true }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', () => reject(new RegistrarError('network', 'The connection to Namecheap was interrupted.', { retryable: true })));
    });
    request.on('timeout', () => {
      request.destroy();
      reject(new RegistrarError('timeout', 'Namecheap took too long to respond.', { retryable: true }));
    });
    request.on('error', (err) => {
      if (err instanceof RegistrarError) return reject(err);
      return reject(new RegistrarError('network', `Could not reach Namecheap (${err.code || 'network error'}).`, { retryable: true }));
    });
  });
}

// ─── Call budget (rate limiting) ───────────────────────────────────────

/**
 * Namecheap allows 50 calls/minute, 700/hour and 8,000/day per API key
 * (API FAQ); some sources quote 20/minute, so calls are spaced 3s apart
 * and hourly/daily budgets stop short of the documented caps, leaving
 * headroom for anything else using the same key. Per process: with more
 * than one API instance each keeps its own count (ADR 0009).
 */
class CallBudget {
  constructor({
    minIntervalMs = 3000, hourlyLimit = 600, dailyLimit = 7000, clock = Date.now, sleep = defaultSleep,
  } = {}) {
    Object.assign(this, {
      minIntervalMs, hourlyLimit, dailyLimit, clock, sleep,
    });
    this.lastCallAt = 0;
    this.recent = [];
    this.dayKey = null;
    this.dayCount = 0;
    this.tail = Promise.resolve();
  }

  acquire() {
    const turn = this.tail.then(async () => {
      let now = this.clock();
      this.recent = this.recent.filter((at) => now - at < 3600 * 1000);
      const dayKey = new Date(now).toISOString().slice(0, 10);
      if (dayKey !== this.dayKey) {
        this.dayKey = dayKey;
        this.dayCount = 0;
      }
      if (this.recent.length >= this.hourlyLimit || this.dayCount >= this.dailyLimit) {
        throw new RegistrarError('budget_exhausted', 'Leadzaro paused Namecheap requests to stay within the API’s hourly/daily limits. It will continue on the next sync.');
      }
      const wait = this.lastCallAt + this.minIntervalMs - now;
      if (wait > 0) await this.sleep(wait);
      now = this.clock();
      this.lastCallAt = now;
      this.recent.push(now);
      this.dayCount += 1;
    });
    this.tail = turn.catch(() => {});
    return turn;
  }
}

const budgets = new Map();

function budgetFor(key) {
  if (!budgets.has(key)) budgets.set(key, new CallBudget());
  return budgets.get(key);
}

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ─── XML ───────────────────────────────────────────────────────────────

const ARRAY_TAGS = new Set(['Error', 'Warning', 'Domain', 'Nameserver', 'SSL', 'ProductType', 'ProductCategory', 'Product', 'Price']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

/** Attributes of a parsed element, keyed in lower case (Namecheap is not consistent about casing). */
function attrs(node) {
  const out = {};
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) out[key.slice(1).toLowerCase()] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node.trim();
  return String(node['#text'] ?? '').trim();
}

function parseBool(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'y') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'n') return false;
  return null;
}

/** Namecheap dates are MM/DD/YYYY. Anything else is treated as unknown, never guessed. */
function parseUsDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** "8.55" → 855. Unknown or malformed prices stay null — never 0. */
function parseMoneyCents(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function scrub(text, secrets) {
  let out = String(text || '');
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out.slice(0, 500);
}

function providerError(errors, secrets) {
  const first = errors[0] || {};
  const code = String(attrs(first).number || '').trim() || null;
  const providerMessage = scrub(textOf(first), secrets) || null;
  const known = code ? PROVIDER_ERRORS.get(code) : null;
  if (known) {
    const [kind, message] = known;
    return new RegistrarError(kind, message, { providerCode: code, retryable: RETRYABLE_KINDS.has(kind), providerMessage });
  }
  // 5xxxxxx numbers are Namecheap's "unknown/unhandled exception" family.
  const retryable = Boolean(code && code.startsWith('5'));
  return new RegistrarError('api_error', `Namecheap returned an error${providerMessage ? `: ${providerMessage}` : ''}.`, { providerCode: code, retryable, providerMessage });
}

function parseApiResponse({ statusCode, body }, secrets) {
  if (statusCode !== 200) {
    const retryable = statusCode === 429 || statusCode >= 500;
    return { error: new RegistrarError(retryable ? 'unavailable' : 'api_error', `Namecheap responded with HTTP ${statusCode}${retryable ? '' : ' — the request was refused before reaching the API'}.`, { retryable }) };
  }
  if (typeof body !== 'string' || !body.includes('<ApiResponse') || XMLValidator.validate(body) !== true) {
    return { error: new RegistrarError('bad_response', 'Namecheap sent a response Leadzaro could not read (not the expected XML).', { retryable: true }) };
  }
  const root = parser.parse(body).ApiResponse;
  if (!root) return { error: new RegistrarError('bad_response', 'Namecheap sent a response without an ApiResponse element.', { retryable: true }) };
  const status = String(attrs(root).status || '').toUpperCase();
  const errors = root.Errors?.Error || [];
  if (status !== 'OK') {
    if (errors.length) return { error: providerError(errors, secrets) };
    return { error: new RegistrarError('api_error', `Namecheap returned status ${status || 'unknown'}.`) };
  }
  return { commandResponse: root.CommandResponse || {} };
}

// ─── Adapter ───────────────────────────────────────────────────────────

/** The adapter interface (architecture § 16): read-only registrar access. */
class RegistrarReader {
  /* eslint-disable class-methods-use-this, no-unused-vars */
  async testConnection() { throw new Error('not implemented'); }

  async listDomainsPage(page) { throw new Error('not implemented'); }

  async findDomain(domainName) { throw new Error('not implemented'); }

  async getNameservers(domainName) { throw new Error('not implemented'); }

  async getRenewalPrices(tld) { throw new Error('not implemented'); }

  async getBalances() { throw new Error('not implemented'); }

  async listSslCertificatesPage(page) { throw new Error('not implemented'); }
  /* eslint-enable class-methods-use-this, no-unused-vars */
}

function parseListedDomain(node) {
  const a = attrs(node);
  return {
    providerDomainId: a.id || null,
    domainName: normalizeRegisteredDomain(a.name),
    reportedName: a.name || null,
    accountUser: a.user || null,
    createdOn: parseUsDate(a.created),
    expiresOn: parseUsDate(a.expires),
    isExpired: parseBool(a.isexpired),
    isLocked: parseBool(a.islocked),
    autoRenew: parseBool(a.autorenew),
    privacy: a.whoisguard || null,
    isPremium: parseBool(a.ispremium),
    usesNamecheapDns: parseBool(a.isourdns),
  };
}

function parsePaging(commandResponse) {
  const paging = commandResponse.Paging || {};
  const number = (value) => {
    const parsed = Number.parseInt(textOf(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return { totalItems: number(paging.TotalItems), currentPage: number(paging.CurrentPage), pageSize: number(paging.PageSize) };
}

class NamecheapRegistrarReader extends RegistrarReader {
  /**
   * @param credentials {apiUser, apiKey, userName, clientIp}
   * @param options.environment 'production' | 'sandbox'
   * @param options.transport injectable for tests; defaults to real HTTPS
   * @param options.budget a CallBudget shared by everything using this connection
   */
  constructor(credentials, {
    environment = 'production', transport = httpsGet, budget = null, budgetKey = null, sleep = defaultSleep, timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    super();
    if (!ENDPOINTS[environment]) throw new Error(`Unknown Namecheap environment ${environment}`);
    this.endpoint = ENDPOINTS[environment];
    this.credentials = credentials;
    this.transport = transport;
    this.budget = budget || budgetFor(budgetKey || `${environment}:${credentials.userName}`);
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.secrets = [credentials.apiKey];
    this.callCount = 0;
  }

  async call(command, params = {}, { retries = 2, timeoutMs = this.timeoutMs } = {}) {
    if (!READ_ONLY_COMMANDS.has(command)) throw new Error(`Refusing to send ${command}: this connection is read-only.`);
    const query = new URLSearchParams({
      ApiUser: this.credentials.apiUser,
      ApiKey: this.credentials.apiKey,
      UserName: this.credentials.userName,
      ClientIp: this.credentials.clientIp,
      Command: command,
      ...params,
    });
    const url = `${this.endpoint}?${query.toString()}`;

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.budget.acquire();
      this.callCount += 1;
      let outcome;
      try {
        // eslint-disable-next-line no-await-in-loop
        outcome = parseApiResponse(await this.transport({ url, timeoutMs }), this.secrets);
      } catch (err) {
        outcome = { error: err instanceof RegistrarError ? err : new RegistrarError('network', 'Could not reach Namecheap.', { retryable: true }) };
      }
      if (!outcome.error) return outcome.commandResponse;
      lastError = outcome.error;
      if (!lastError.retryable || attempt === retries) break;
      const backoffMs = lastError.kind === 'rate_limited' ? 30000 * (attempt + 1) : 2000 * 4 ** attempt;
      // eslint-disable-next-line no-await-in-loop
      await this.sleep(backoffMs);
    }
    throw lastError;
  }

  /** One small, real call that proves the credentials, whitelist and domain access all work. */
  async testConnection() {
    const page = await this.listDomainsPage(1, { pageSize: 10, retries: 0 });
    return { totalDomains: page.totalItems ?? page.domains.length };
  }

  async listDomainsPage(page, { pageSize = PAGE_SIZE, retries } = {}) {
    const response = await this.call('namecheap.domains.getList', {
      ListType: 'ALL', Page: String(page), PageSize: String(pageSize), SortBy: 'NAME',
    }, { retries });
    const nodes = response.DomainGetListResult?.Domain || [];
    const paging = parsePaging(response);
    return { domains: nodes.map(parseListedDomain), ...paging };
  }

  /** Exact lookup via getList's SearchTerm (a keyword filter), so one call returns the same fields a full sync does. */
  async findDomain(domainName, { retries = 1, timeoutMs = 12000 } = {}) {
    if (domainName.length > 70) return { searchable: false, domain: null };
    const response = await this.call('namecheap.domains.getList', {
      ListType: 'ALL', SearchTerm: domainName, Page: '1', PageSize: String(PAGE_SIZE),
    }, { retries, timeoutMs });
    const matches = (response.DomainGetListResult?.Domain || []).map(parseListedDomain).filter((d) => d.domainName === domainName);
    return { searchable: true, domain: matches[0] || null };
  }

  async getNameservers(domainName) {
    const split = splitForRegistrar(domainName);
    if (!split) throw new RegistrarError('invalid_domain', `${domainName} is not a registrable domain.`);
    const response = await this.call('namecheap.domains.dns.getList', { SLD: split.sld, TLD: split.tld }, { retries: 1 });
    const result = response.DomainDNSGetListResult || {};
    return {
      usesNamecheapDns: parseBool(attrs(result).isusingourdns),
      nameservers: (result.Nameserver || []).map(textOf).filter(Boolean).map((ns) => ns.toLowerCase()),
    };
  }

  /** Renewal price list for one TLD (e.g. "com", "co.uk") — the account's own prices, before taxes. */
  async getRenewalPrices(tld) {
    const response = await this.call('namecheap.users.getPricing', {
      ProductType: 'DOMAIN', ProductCategory: 'DOMAINS', ActionName: 'RENEW', ProductName: tld.toUpperCase(),
    }, { retries: 1 });
    const prices = [];
    for (const productType of response.UserGetPricingResult?.ProductType || []) {
      for (const category of productType.ProductCategory || []) {
        if (String(attrs(category).name || '').toLowerCase() !== 'renew') continue;
        for (const product of category.Product || []) {
          if (String(attrs(product).name || '').toLowerCase() !== tld.toLowerCase()) continue;
          for (const price of product.Price || []) {
            const a = attrs(price);
            const years = Number.parseInt(a.duration, 10);
            if (String(a.durationtype || '').toUpperCase() !== 'YEAR' || !Number.isFinite(years)) continue;
            prices.push({
              years,
              yourPriceCents: parseMoneyCents(a.yourprice),
              priceCents: parseMoneyCents(a.price),
              regularPriceCents: parseMoneyCents(a.regularprice),
              // Not in the documented example, but returned by the live API for ICANN fees; kept only when present.
              additionalCents: parseMoneyCents(a.youradditonalcost ?? a.youradditionalcost ?? a.additionalcost),
              currency: a.currency || null,
            });
          }
        }
      }
    }
    return prices;
  }

  async getBalances() {
    const response = await this.call('namecheap.users.getBalances', {}, { retries: 1 });
    const a = attrs(response.UserGetBalancesResult);
    return {
      currency: a.currency || null,
      availableBalanceCents: parseMoneyCents(a.availablebalance),
      fundsRequiredForAutoRenewCents: parseMoneyCents(a.fundsrequiredforautorenew),
    };
  }

  async listSslCertificatesPage(page) {
    const response = await this.call('namecheap.ssl.getList', {
      ListType: 'ALL', Page: String(page), PageSize: String(PAGE_SIZE),
    }, { retries: 1 });
    const certificates = (response.SSLListResult?.SSL || []).map((node) => {
      const a = attrs(node);
      return {
        certificateId: a.certificateid || null,
        hostName: a.hostname ? a.hostname.toLowerCase() : null,
        type: a.ssltype || null,
        status: a.status || null,
        purchasedOn: parseUsDate(a.purchasedate),
        expiresOn: parseUsDate(a.expiredate),
        isExpired: parseBool(a.isexpiredyn),
      };
    });
    return { certificates, ...parsePaging(response) };
  }

}

module.exports = {
  RegistrarReader,
  NamecheapRegistrarReader,
  RegistrarError,
  CallBudget,
  READ_ONLY_COMMANDS,
  ENDPOINTS,
  PAGE_SIZE,
  MAX_PAGES,
  // exported for tests
  parseApiResponse,
  parseUsDate,
  parseMoneyCents,
};
