'use strict';

const { domainToUnicode } = require('node:url');
const tldts = require('tldts');

/**
 * Turns whatever someone typed or synced — "Example.com",
 * "https://www.example.co.uk/menu/", "shop.example.com:8080",
 * "bücher.de" — into the parts domain matching needs:
 *
 * - hostname: the site's host, lowercased ASCII (punycode), without a
 *   leading "www." and without a port, path or trailing dot. Meaningful
 *   subdomains ("shop.", "app.") are kept.
 * - registrableDomain: what a registrar actually sells, found with the
 *   Public Suffix List's ICANN section (example.co.uk, not co.uk).
 * - platformSuffix: set when the host lives under a platform's private
 *   suffix (foo.github.io, shop.myshopify.com) — there is no domain of
 *   the client's own to register or renew in that case.
 *
 * The original input is never modified here; callers keep it as typed.
 */

const MAX_INPUT_LENGTH = 500;

function failure(code, message) {
  return { ok: false, code, message };
}

function hostFromInput(raw) {
  let text = String(raw).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // "mailto:x@y.com" or "ftp:..." — a scheme we don't treat as a website.
    // "example.com:8080" is a host with a port, not a scheme.
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null;
    text = `http://${text}`;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // WHATWG URL already lowercases and converts internationalized names to
  // punycode; only a trailing root dot is left to remove.
  return parsed.hostname.replace(/\.+$/, '');
}

function parseDomainInput(input) {
  if (input === null || input === undefined || String(input).trim() === '') return failure('empty', 'Enter a domain or website address.');
  if (String(input).length > MAX_INPUT_LENGTH) return failure('invalid', 'That address is too long.');

  let host = hostFromInput(input);
  if (!host) return failure('invalid', 'That doesn’t look like a website address.');
  if (host.startsWith('[')) return failure('ip', 'An IP address has no domain registration to track.');

  const icann = tldts.parse(host, { allowPrivateDomains: false });
  if (icann.isIp) return failure('ip', 'An IP address has no domain registration to track.');
  if (!icann.domain || !icann.isIcann) return failure('no_domain', 'That address has no registrable domain (for example “localhost” or a bare suffix).');

  // "www." is never a meaningful subdomain for matching purposes.
  if (host.startsWith('www.') && host !== `www.${icann.publicSuffix}`) host = host.slice(4);

  const withPrivate = tldts.parse(host, { allowPrivateDomains: true });
  const platformSuffix = withPrivate.isPrivate && withPrivate.publicSuffix !== icann.publicSuffix ? withPrivate.publicSuffix : null;
  const subdomain = host === icann.domain ? '' : host.slice(0, -(icann.domain.length + 1));

  return {
    ok: true,
    hostname: host,
    registrableDomain: icann.domain,
    publicSuffix: icann.publicSuffix,
    sld: icann.domainWithoutSuffix,
    subdomain,
    isApex: host === icann.domain,
    platformSuffix,
    displayHostname: domainToUnicode(host) || host,
  };
}

/**
 * A domain name as a registrar reports it. Namecheap lists registrable
 * domains only; anything else (a subdomain, a bare suffix) is reported
 * back as null rather than guessed at.
 */
function normalizeRegisteredDomain(name) {
  const parsed = parseDomainInput(name);
  if (!parsed.ok || parsed.hostname !== parsed.registrableDomain) return null;
  return parsed.registrableDomain;
}

/** SLD/TLD split used by Namecheap's domains.dns.* commands. */
function splitForRegistrar(domain) {
  const parsed = tldts.parse(domain, { allowPrivateDomains: false });
  if (!parsed.domain || parsed.domain !== domain) return null;
  return { sld: parsed.domainWithoutSuffix, tld: parsed.publicSuffix };
}

function displayDomain(asciiDomain) {
  return domainToUnicode(asciiDomain) || asciiDomain;
}

/** "best-diner-ny" → "Best Diner Ny" — a starting point the user reviews, never a final answer. */
function suggestClientName(domain) {
  const parsed = tldts.parse(displayDomain(domain), { allowPrivateDomains: false });
  const base = parsed.domainWithoutSuffix || domain;
  return base.split(/[-_.]+/).filter(Boolean).map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(' ');
}

const NAME_NOISE = /\b(the|llc|inc|incorporated|co|corp|company|ltd|group|studio|studios)\b/g;

function compactName(value) {
  return String(value || '').toLowerCase().replace(NAME_NOISE, '').replace(/[^a-z0-9]/g, '');
}

/**
 * How strongly a client/project name resembles a domain's name — used
 * only to *suggest* a link in the review list; linking always takes a
 * click. 2 = same letters ("Haven Fit Club" ↔ havenfitclub.com),
 * 1 = one contains the other, 0 = no resemblance.
 */
function nameResemblance(name, domain) {
  const a = compactName(name);
  const b = compactName(tldts.parse(domain).domainWithoutSuffix || '');
  if (a.length < 4 || b.length < 4) return 0;
  if (a === b) return 2;
  if ((a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b))) return 1;
  return 0;
}

module.exports = {
  parseDomainInput, normalizeRegisteredDomain, splitForRegistrar, displayDomain, suggestClientName, nameResemblance,
};
