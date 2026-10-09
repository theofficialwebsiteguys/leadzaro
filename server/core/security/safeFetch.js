'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const zlib = require('node:zlib');

/**
 * Fetching a public web page on behalf of a user (ADR 0014) without
 * becoming an SSRF hole: only http(s) on the standard ports, no
 * credentials in the URL, every hostname resolved and rejected if ANY of
 * its addresses is private/loopback/link-local/metadata, the connection
 * pinned to the checked address (no DNS-rebinding window), redirects
 * followed manually with the same checks at every hop, and hard limits on
 * time and size. Never throws — returns { ok, status, error, kind, ... }.
 */

const USER_AGENT = 'LeadzaroContactCheck/1.0 (business contact lookup; +https://theofficialwebsiteguys.com)';

function privateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return privateIPv4(ip);
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateIPv4(mapped[1]);
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8') || lower.startsWith('::')) return true;
  const first = Number.parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // unique local
    || (first & 0xffc0) === 0xfe80 // link local
    || (first & 0xff00) === 0xff00; // multicast
}

/** A dns.lookup replacement that refuses hosts resolving to any non-public address. */
function safeLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : (options || {});
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!addresses?.length || addresses.some((a) => isBlockedAddress(a.address))) {
      const blocked = new Error('Address not allowed');
      blocked.code = 'EBLOCKED';
      return cb(blocked);
    }
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'Not a valid web address', kind: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Only http and https addresses are checked', kind: 'invalid' };
  if (url.username || url.password) return { error: 'Addresses with credentials are not checked', kind: 'invalid' };
  if (url.port && !['80', '443'].includes(url.port)) return { error: 'Only standard web ports are checked', kind: 'invalid' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) return { error: 'Address not allowed', kind: 'blocked' };
  if (!host.includes('.') || /\.(local|internal|localhost|lan|home|corp)$/i.test(host)) return { error: 'Address not allowed', kind: 'blocked' };
  return { url };
}

function describeError(err) {
  if (err?.code === 'EBLOCKED') return { error: 'Address not allowed', kind: 'blocked' };
  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') return { error: 'The domain did not resolve', kind: 'dns' };
  if (err?.code === 'ECONNREFUSED') return { error: 'The server refused the connection', kind: 'unreachable' };
  if (err?.code === 'ETIMEDOUT' || err?.kind === 'timeout') return { error: 'Timed out', kind: 'timeout' };
  if (/certificate|SSL|TLS/i.test(err?.message || '') || String(err?.code || '').startsWith('ERR_TLS') || /CERT/.test(err?.code || '')) return { error: 'Secure connection failed (certificate problem)', kind: 'tls' };
  return { error: 'Could not connect', kind: 'unreachable' };
}

function requestOnce(url, { timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = lib.request(url, {
      method: 'GET',
      agent: false,
      lookup: safeLookup,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.8',
      },
    }, (res) => {
      const status = res.statusCode || 0;
      const headers = res.headers;
      if (status >= 300 && status < 400 && headers.location) {
        res.resume();
        return done({ redirect: headers.location, status });
      }
      const type = String(headers['content-type'] || '');
      if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
        res.resume();
        return done({ status, contentType: type, body: '' });
      }
      const encoding = String(headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
          req.destroy();
          done({ status, contentType: type, body: Buffer.concat(chunks).toString('utf8'), truncated: true });
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => done({ status, contentType: type, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', () => done({ status, contentType: type, body: Buffer.concat(chunks).toString('utf8'), truncated: true }));
      return undefined;
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error('timeout');
      err.kind = 'timeout';
      req.destroy(err);
    });
    req.on('error', (err) => done({ failure: describeError(err) }));
    req.end();
  });
}

/**
 * GETs a public page. Returns { ok, status, url (final), contentType, body }
 * or { ok: false, error, kind, status? } — kind is one of invalid, blocked,
 * dns, unreachable, timeout, tls, http, redirects.
 */
async function fetchPublicPage(rawUrl, { timeoutMs = 8000, maxBytes = 1500000, maxRedirects = 4 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = checkUrl(current);
    if (checked.error) return { ok: false, url: current, error: checked.error, kind: checked.kind };
    // eslint-disable-next-line no-await-in-loop
    const result = await requestOnce(checked.url, { timeoutMs, maxBytes });
    if (result.failure) return { ok: false, url: checked.url.href, ...result.failure };
    if (result.redirect) {
      try {
        current = new URL(result.redirect, checked.url).href;
      } catch {
        return { ok: false, url: checked.url.href, error: 'Bad redirect', kind: 'http', status: result.status };
      }
      continue; // eslint-disable-line no-continue
    }
    if (result.status >= 400) return { ok: false, url: checked.url.href, status: result.status, error: `The site answered with an error (${result.status})`, kind: 'http' };
    return {
      ok: true, url: checked.url.href, status: result.status, contentType: result.contentType, body: result.body || '', truncated: Boolean(result.truncated),
    };
  }
  return { ok: false, url: current, error: 'Too many redirects', kind: 'redirects' };
}

module.exports = { fetchPublicPage, isBlockedAddress, checkUrl };
