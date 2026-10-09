'use strict';

const { Opportunity, Organization } = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { runInBackground } = require('../../core/jobs/background');
const { fetchPublicPage } = require('../../core/security/safeFetch');
const {
  invalid, isEmail, registrableDomain, nameKey, FREE_EMAIL_DOMAINS,
} = require('./salesCommon');

/**
 * Finding a business's public contact email (ADR 0014).
 *
 * Google Places never returns an email, so this is the only automated
 * source: a bounded check of the business's own website (homepage, then
 * up to four contact/about-style pages), reading mailto links, plain-text
 * and Cloudflare-obfuscated addresses. Every address keeps the exact page
 * it was found on and when. Addresses that clearly belong to someone else
 * (the web designer's credit, privacy/registrar services, placeholders)
 * are dropped; an address on an unrelated domain is kept only for review.
 *
 * Facebook: a page linked from the business's own website (or listed as
 * their "website" on Google) is recorded as their Facebook page. Facebook
 * pages are NOT read automatically — they need a signed-in session for
 * contact details and Facebook's terms forbid automated collection — so
 * finding an email there is a quick manual step (Open Facebook → Add email).
 *
 * Discovery status is separate from the lead's stage and from message
 * delivery. "Found" means publicly listed, not verified as deliverable.
 * Nothing here ever guesses an address.
 */

const STATUSES = ['not_checked', 'checking', 'found', 'none_found', 'failed', 'needs_review'];
const STATUS_LABELS = {
  not_checked: 'Not checked',
  checking: 'Checking…',
  found: 'Email found',
  none_found: 'No public email found',
  failed: 'Couldn’t check',
  needs_review: 'Needs manual review',
};

const MAX_EXTRA_PAGES = 4;
const RECHECK_AFTER_MS = 24 * 3600 * 1000;
const STALE_CHECKING_MS = 3 * 60 * 1000;

// Hosts that are a profile on someone else's platform, not a website we can check.
const SOCIAL_HOSTS = new Set(['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'yelp.com', 'linktr.ee', 'nextdoor.com', 'youtube.com']);

const IGNORED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'email.com', 'yourdomain.com', 'yoursite.com', 'mysite.com', 'website.com', 'company.com', 'test.com', 'sample.com',
  'sentry.io', 'wixpress.com', 'wix.com', 'squarespace.com', 'godaddy.com', 'secureserver.net', 'weebly.com', 'wordpress.com', 'wordpress.org', 'w3.org', 'schema.org',
  'domainsbyproxy.com', 'whoisprivacyservice.org', 'contactprivacy.com', 'withheldforprivacy.com', 'privacyguardian.org', 'whoisguard.com', 'namecheap.com', 'proxy.dreamhost.com',
  'cloudflare.com', 'gravatar.com', 'jquery.com', 'google.com', 'facebook.com', 'sentry-next.wixpress.com',
]);
const IGNORED_LOCAL_PARTS = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|privacy|dmca|hostmaster|root|your-?email|your-?name|name|email|user|username|firstname|lastname|john\.?doe|jane\.?doe)$/i;
const ASSET_SUFFIX = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mp4|pdf)$/i;
const DEVELOPER_CREDIT = /(website|site|web\s*design|designed|developed|built|created|powered|hosted|managed|maintained|seo|marketing)\s+(by|with)\b/i;
const PREFERRED_LOCAL = /^(info|contact|office|hello|hi|sales|service|services|appointments|booking|bookings|orders|team|admin|owner|mail|inquiries|enquiries)$/i;
const CONTACT_LINK = /contact|about|reach|connect|get-?in-?touch|location|our-?story|team|info/i;

function label(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.not_checked;
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&');
}

function decodeCfEmail(hex) {
  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key); // eslint-disable-line no-bitwise
    return out;
  } catch {
    return null;
  }
}

/** Every address on a page, with how it appeared and the text around it. */
function extractEmails(html) {
  const found = [];
  const text = decodeEntities(String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  for (const m of text.matchAll(/href\s*=\s*["']\s*mailto:([^"'?#\s]+)/gi)) {
    let email = m[1];
    try { email = decodeURIComponent(email); } catch { /* keep raw */ }
    found.push({ email, via: 'mailto', index: m.index });
  }
  for (const m of text.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
    const email = decodeCfEmail(m[1]);
    if (email) found.push({ email, via: 'obfuscated', index: m.index });
  }
  // Bounded character runs (no nested quantifiers) keep this linear on large pages; judgeEmail validates the shape.
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{3,253}/g)) {
    found.push({ email: m[0].replace(/^[._%+-]+/, ''), via: 'text', index: m.index });
  }
  return found.map((f) => {
    const around = text.slice(Math.max(0, f.index - 160), f.index + 80).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return { email: f.email.trim().replace(/^mailto:/i, '').replace(/[.,;:]+$/, '').toLowerCase(), via: f.via, context: around };
  });
}

/** Keeps addresses that plausibly belong to this business; says why others were dropped. */
function judgeEmail(candidate, siteDomain) {
  const { email, context } = candidate;
  if (!isEmail(email) || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(email) || ASSET_SUFFIX.test(email)) return { keep: false, why: 'not an email' };
  const [local, domainPart] = email.split('@');
  const domain = registrableDomain(domainPart) || domainPart;
  if (IGNORED_EMAIL_DOMAINS.has(domain) || IGNORED_EMAIL_DOMAINS.has(domainPart)) return { keep: false, why: 'placeholder or service address' };
  if (IGNORED_LOCAL_PARTS.test(local)) return { keep: false, why: 'automated or placeholder address' };
  const sameDomain = Boolean(siteDomain) && domain === siteDomain;
  if (!sameDomain && DEVELOPER_CREDIT.test(context)) return { keep: false, why: 'looks like the website developer’s credit' };
  return {
    keep: true, sameDomain, freeProvider: FREE_EMAIL_DOMAINS.has(domain), preferred: PREFERRED_LOCAL.test(local),
  };
}

function rank(c) {
  return (c.sameDomain ? 8 : 0) + (c.freeProvider ? 4 : 0) + (c.preferred ? 2 : 0) + (c.via === 'mailto' ? 1 : 0);
}

const FACEBOOK_SKIP = /^(sharer|share|plugins|dialog|tr|login|help|policies|policy|privacy|legal|terms|watch|groups|events|hashtag|photo|photos|story\.php|permalink\.php|l\.php|wix|squarespace|godaddy|weebly|wordpress|business|ads|pages\/create)(\/|\.php|$)/i;

/** Facebook page links on a page, normalized to https://www.facebook.com/<page>. */
function extractFacebookLinks(html) {
  const out = new Set();
  for (const m of String(html || '').matchAll(/https?:\/\/(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com\/([^"'\s<>#]+)/gi)) {
    let path = m[1].replace(/&amp;/g, '&');
    if (FACEBOOK_SKIP.test(path)) continue; // eslint-disable-line no-continue
    if (/^profile\.php\?id=\d+/i.test(path)) path = path.match(/^profile\.php\?id=\d+/i)[0];
    else path = path.split(/[?]/)[0].replace(/\/+$/, '');
    if (!path || path.length > 200) continue; // eslint-disable-line no-continue
    if (/^pages\//i.test(path)) path = path.replace(/^pages\/(?:category\/[^/]+\/)?/i, '');
    if (!path) continue; // eslint-disable-line no-continue
    out.add(`https://www.facebook.com/${path}`);
  }
  return [...out];
}

function normalizeFacebookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|web|business)\./, '');
  if (!['facebook.com', 'fb.com', 'fb.me'].includes(host)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return null;
  const id = url.pathname.startsWith('/profile.php') ? url.searchParams.get('id') : null;
  return id ? `https://www.facebook.com/profile.php?id=${id}` : `https://www.facebook.com${path}`.slice(0, 500);
}

/** How well a linked Facebook page's address resembles the business name. */
function facebookLooksLike(url, businessName) {
  const slug = nameKey(decodeURIComponent(url.split('facebook.com/')[1] || '').replace(/[-_.]/g, ' ').replace(/\d{6,}/g, ''));
  const name = nameKey(businessName);
  if (!slug || !name) return false;
  const squash = (s) => s.replace(/\s+/g, '');
  if (squash(slug).includes(squash(name).slice(0, 8)) || squash(name).includes(squash(slug).slice(0, 8))) return true;
  const words = name.split(' ').filter((w) => w.length >= 4);
  return words.some((w) => squash(slug).includes(w));
}

function isSocialUrl(website) {
  const domain = registrableDomain(website);
  return Boolean(domain && SOCIAL_HOSTS.has(domain));
}

function pageLinks(html, baseUrl, siteDomain) {
  const links = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let href;
    try { href = new URL(decodeEntities(m[1]), baseUrl); } catch { continue; } // eslint-disable-line no-continue
    if (!['http:', 'https:'].includes(href.protocol)) continue; // eslint-disable-line no-continue
    if (registrableDomain(href.hostname) !== siteDomain) continue; // eslint-disable-line no-continue
    const text = m[2].replace(/<[^>]+>/g, ' ');
    if (!CONTACT_LINK.test(href.pathname) && !CONTACT_LINK.test(text)) continue; // eslint-disable-line no-continue
    href.hash = '';
    links.push({ url: href.href, contact: /contact|reach|get-?in-?touch/i.test(href.pathname + text) });
  }
  const unique = [...new Map(links.map((l) => [l.url, l])).values()];
  return unique.sort((a, b) => Number(b.contact) - Number(a.contact));
}

/**
 * Checks one business. Inputs are plain facts (no database access), so the
 * same function serves saved leads and search results.
 */
async function discover({ website, facebookUrl, name }) {
  const now = new Date().toISOString();
  const result = {
    status: 'not_checked', checkedAt: now, email: null, emailSourceUrl: null, emailSource: null, candidates: [], rejected: [], pages: [], website: null, facebook: null, summary: '',
  };
  const listedFacebook = normalizeFacebookUrl(facebookUrl);
  if (listedFacebook) result.facebook = { url: listedFacebook, match: 'on_record' };

  if (!website || isSocialUrl(website)) {
    if (website && normalizeFacebookUrl(website) && !result.facebook) result.facebook = { url: normalizeFacebookUrl(website), match: 'google_listing' };
    result.website = website ? { url: website, standalone: false, checkedAt: now } : null;
    result.status = 'needs_review';
    result.summary = result.facebook
      ? 'No standalone website to check. Look for an email on their Facebook page (About → Contact info) and add it.'
      : 'No website listed, so there was nothing to check automatically. Search for their Facebook page, then add the email if one is shown.';
    return result;
  }

  const startUrl = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const home = await fetchPublicPage(startUrl);
  result.pages.push({ url: home.url, ok: home.ok, status: home.status || null, error: home.ok ? null : home.error });
  result.website = {
    url: startUrl, finalUrl: home.ok ? home.url : null, reachable: home.ok, secure: home.ok ? home.url.startsWith('https://') : null, error: home.ok ? null : home.error, errorKind: home.ok ? null : home.kind, checkedAt: now, standalone: true,
  };
  if (!home.ok) {
    result.status = 'failed';
    result.summary = `Couldn’t load ${startUrl} (${home.error}). One failed check doesn’t mean the site is down for good — retry later or check it yourself.`;
    return result;
  }

  const siteDomain = registrableDomain(home.url);
  const kept = new Map();
  const consider = (html, pageUrl) => {
    for (const c of extractEmails(html)) {
      const verdict = judgeEmail(c, siteDomain);
      if (!verdict.keep) {
        if (result.rejected.length < 10 && !result.rejected.some((r) => r.email === c.email)) result.rejected.push({ email: c.email, why: verdict.why, sourceUrl: pageUrl });
        continue; // eslint-disable-line no-continue
      }
      const existing = kept.get(c.email);
      const entry = {
        email: c.email, sourceUrl: pageUrl, via: c.via, sameDomain: verdict.sameDomain, freeProvider: verdict.freeProvider, preferred: verdict.preferred,
      };
      if (!existing || rank(entry) > rank(existing)) kept.set(c.email, entry);
    }
  };
  const facebookLinks = new Set(extractFacebookLinks(home.body));
  consider(home.body, home.url);

  const queue = pageLinks(home.body, home.url, siteDomain).filter((l) => l.url !== home.url);
  for (const fallback of ['/contact', '/contact-us', '/about']) {
    const url = new URL(fallback, home.url).href;
    if (!queue.some((q) => q.url.replace(/\/$/, '') === url)) queue.push({ url, contact: fallback.startsWith('/contact'), guessed: true });
  }
  const strongFound = () => [...kept.values()].some((c) => c.sameDomain && (c.via === 'mailto' || c.preferred));
  let extra = 0;
  for (const link of queue) {
    if (extra >= MAX_EXTRA_PAGES || strongFound()) break;
    // A guessed path is only tried if the site linked nothing better.
    if (link.guessed && result.pages.some((p) => p.ok && p.url !== home.url)) continue; // eslint-disable-line no-continue
    extra += 1;
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPublicPage(link.url, { timeoutMs: 6000 });
    if (link.guessed && !page.ok && page.status === 404) continue; // eslint-disable-line no-continue
    result.pages.push({ url: page.url, ok: page.ok, status: page.status || null, error: page.ok ? null : page.error });
    if (page.ok) {
      consider(page.body, page.url);
      for (const fb of extractFacebookLinks(page.body)) facebookLinks.add(fb);
    }
  }

  // Facebook page linked from their own site.
  if (!result.facebook && facebookLinks.size) {
    const links = [...facebookLinks];
    const lookalike = links.find((l) => facebookLooksLike(l, name));
    if (links.length === 1) result.facebook = { url: links[0], match: lookalike || facebookLooksLike(links[0], name) ? 'linked_from_website' : 'uncertain', sourceUrl: home.url };
    else result.facebook = { url: lookalike || links[0], match: lookalike ? 'linked_from_website' : 'uncertain', sourceUrl: home.url, others: links.filter((l) => l !== (lookalike || links[0])).slice(0, 3) };
  }

  const candidates = [...kept.values()].sort((a, b) => rank(b) - rank(a));
  result.candidates = candidates.slice(0, 5);
  const best = candidates[0];
  if (best && (best.sameDomain || best.freeProvider)) {
    result.status = 'found';
    result.email = best.email;
    result.emailSourceUrl = best.sourceUrl;
    result.emailSource = 'website';
    result.summary = `Found ${best.email} on ${best.sourceUrl}. Publicly listed — not verified as deliverable.`;
  } else if (best) {
    result.status = 'needs_review';
    result.summary = `Found ${best.email} on ${best.sourceUrl}, but it isn’t on the business’s own domain — check it belongs to them before using it.`;
  } else {
    const okPages = result.pages.filter((p) => p.ok).length;
    result.status = 'none_found';
    result.summary = `Checked ${okPages} page${okPages === 1 ? '' : 's'} on their website — no public email listed.${result.facebook ? ' Try their Facebook page.' : ''}`;
  }
  return result;
}

// ------------------------------------------------------------ bounded queue

const MAX_CONCURRENT = 3;
let running = 0;
const waiting = [];

function enqueue(work) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running += 1;
      Promise.resolve().then(work).then(resolve, reject).finally(() => {
        running -= 1;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (running < MAX_CONCURRENT) start();
    else waiting.push(start);
  });
}

// ---------------------------------------------- search results (not saved)

const RESULT_TTL = 24 * 3600 * 1000;
const resultCache = new Map(); // googlePlaceId → { result, expiresAt }

function cachedForPlace(placeId) {
  const hit = placeId ? resultCache.get(placeId) : null;
  return hit && hit.expiresAt > Date.now() ? hit.result : null;
}

/** Discovery for an employee-selected search result; cached per listing so saving it reuses the work. */
async function discoverForSearchResult({
  placeId, website, name, force = false,
}) {
  if (!placeId || String(placeId).length > 255) throw invalid('Missing listing id');
  if (!force) {
    const hit = cachedForPlace(placeId);
    if (hit) return hit;
  }
  const result = await enqueue(() => discover({ website, name }));
  if (resultCache.size > 1000) resultCache.delete(resultCache.keys().next().value);
  resultCache.set(placeId, { result, expiresAt: Date.now() + RESULT_TTL });
  return result;
}

// ------------------------------------------------------ saved businesses

/** The discovery record as the UI should see it (a check interrupted by a restart reads as failed). */
function present(organization) {
  const d = organization.emailDiscovery || null;
  const manualEmail = ['manual', 'verified'].includes(organization.detailsSource?.email);
  let status = d?.status || (organization.email ? 'found' : 'not_checked');
  let summary = d?.summary || null;
  if (status === 'checking' && d?.startedAt && Date.now() - new Date(d.startedAt).getTime() > STALE_CHECKING_MS) {
    status = 'failed';
    summary = 'The check didn’t finish. Retry it.';
  }
  if (organization.email && status !== 'checking') status = 'found';
  return {
    status,
    statusLabel: label(status),
    summary,
    email: organization.email || null,
    emailSource: organization.email ? (manualEmail ? 'manual' : (organization.detailsSource?.email || d?.emailSource || null)) : null,
    emailSourceUrl: organization.email ? (d?.email === organization.email ? d.emailSourceUrl : (d?.manualSourceUrl || null)) : null,
    checkedAt: d?.checkedAt || null,
    checkedBy: d?.checkedBy || null,
    candidates: d?.candidates || [],
    pages: d?.pages || [],
    website: d?.website || null,
    facebookUrl: organization.facebookUrl || null,
    facebookMatch: organization.facebookUrl ? (organization.detailsSource?.facebook === 'manual' ? 'manual' : (d?.facebook?.url === organization.facebookUrl ? d.facebook.match : 'on_record')) : null,
    facebookSuggestion: !organization.facebookUrl && d?.facebook?.url ? d.facebook : null,
    markedNoEmail: d?.markedNoEmail || null,
  };
}

/**
 * Saves a discovery result onto the business. A found address fills the
 * email only when nobody has entered or verified one by hand; a Facebook
 * page only fills an empty field, and only when it's a confident match.
 */
async function applyResult(organization, result, { userId = null, trigger = 'auto' } = {}) {
  const fresh = await Organization.findByPk(organization.id);
  const detailsSource = { ...(fresh.detailsSource || {}) };
  const updates = {
    emailDiscovery: {
      ...result, checkedBy: userId, trigger, startedAt: fresh.emailDiscovery?.startedAt || null, markedNoEmail: fresh.emailDiscovery?.markedNoEmail || null, manualSourceUrl: fresh.emailDiscovery?.manualSourceUrl || null,
    },
  };
  const manualEmail = ['manual', 'verified'].includes(detailsSource.email);
  if (result.status === 'found' && result.email && !manualEmail && (!fresh.email || detailsSource.email === 'discovered')) {
    updates.email = result.email;
    detailsSource.email = 'discovered';
  }
  if (result.facebook?.url && !fresh.facebookUrl && ['linked_from_website', 'google_listing'].includes(result.facebook.match)) {
    updates.facebookUrl = result.facebook.url;
    detailsSource.facebook = result.facebook.match;
  }
  updates.detailsSource = detailsSource;
  await fresh.update(updates);
  return fresh;
}

async function runForOrganization(organizationId, { userId, trigger }) {
  const organization = await Organization.findByPk(organizationId);
  if (!organization) return null;
  let result;
  try {
    result = await enqueue(() => discover({ website: organization.website, facebookUrl: organization.facebookUrl, name: organization.name }));
  } catch (err) {
    result = {
      status: 'failed', checkedAt: new Date().toISOString(), summary: 'The check stopped unexpectedly. Retry it.', candidates: [], pages: [], rejected: [],
    };
  }
  return applyResult(organization, result, { userId, trigger });
}

/** Marks the business as being checked and runs the check in the background. */
async function startForOrganization(organization, { userId = null, trigger = 'auto' } = {}) {
  await organization.update({
    emailDiscovery: {
      ...(organization.emailDiscovery || {}), status: 'checking', startedAt: new Date().toISOString(), summary: 'Checking their website for a public email…',
    },
  });
  runInBackground('contact discovery', () => runForOrganization(organization.id, { userId, trigger }));
}

/** After a lead is saved: reuse a search-time check if there was one, otherwise start one. */
async function afterLeadSaved(organization, { googlePlaceId, userId }) {
  const cached = cachedForPlace(googlePlaceId);
  if (cached) return applyResult(organization, cached, { userId, trigger: 'search' });
  if (!organization.website || isSocialUrl(organization.website)) {
    const result = await discover({ website: organization.website, name: organization.name });
    return applyResult(organization, result, { userId, trigger: 'auto' });
  }
  return startForOrganization(organization, { userId, trigger: 'auto' });
}

async function loadForLead(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  const organization = await Organization.findOne({ where: { id: opportunity.organizationId, managingAgencyOrganizationId: ctx.agencyId } });
  if (!organization) throw invalid('Lead not found', 404);
  return { opportunity, organization };
}

/** "Find email" / "Retry" on a lead. Skips a recent completed check unless forced. */
async function requestForLead(ctx, opportunityId, { force = false } = {}) {
  const { organization } = await loadForLead(ctx, opportunityId);
  const current = present(organization);
  if (current.status === 'checking') return current;
  const recent = organization.emailDiscovery?.checkedAt && Date.now() - new Date(organization.emailDiscovery.checkedAt).getTime() < RECHECK_AFTER_MS;
  if (recent && !force && current.status !== 'failed') return current;
  await startForOrganization(organization, { userId: ctx.userId, trigger: 'manual' });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.email_discovery_started', targetType: 'Organization', targetId: organization.id, req: ctx.req,
  });
  return present(await organization.reload());
}

/** Discovery state for several leads at once (for progress while checks run). */
async function statusForLeads(ctx, ids) {
  const list = String(ids || '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 50);
  if (!list.length) return {};
  const opportunities = await Opportunity.findAll({
    where: { id: list, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    attributes: ['id', 'organizationId'],
    include: [{ model: Organization, as: 'organization', attributes: ['id', 'email', 'website', 'facebookUrl', 'emailDiscovery', 'detailsSource'] }],
  });
  return Object.fromEntries(opportunities.filter((o) => o.organization).map((o) => [o.id, present(o.organization)]));
}

/**
 * Manual contact research: an email typed in (with where it came from),
 * the Facebook page saved or corrected, or "checked — no email found".
 * Manual entries win over any later automated result.
 */
async function updateResearch(ctx, opportunityId, input) {
  const { organization } = await loadForLead(ctx, opportunityId);
  const detailsSource = { ...(organization.detailsSource || {}) };
  const discovery = { ...(organization.emailDiscovery || {}) };
  const updates = {};
  const changed = [];

  if (input.facebookUrl !== undefined) {
    const raw = String(input.facebookUrl || '').trim();
    if (raw) {
      const url = normalizeFacebookUrl(raw);
      if (!url) throw invalid('That doesn’t look like a Facebook page address (facebook.com/…).');
      updates.facebookUrl = url;
      detailsSource.facebook = 'manual';
    } else {
      updates.facebookUrl = null;
      delete detailsSource.facebook;
    }
    changed.push('facebookUrl');
  }

  if (input.email !== undefined) {
    const email = String(input.email || '').trim().toLowerCase();
    if (email) {
      if (!isEmail(email) || email.length > 255) throw invalid('That email address does not look valid.');
      updates.email = email;
      detailsSource.email = 'manual';
      const source = String(input.sourceUrl || input.source || '').trim().slice(0, 500) || null;
      Object.assign(discovery, {
        status: 'found', email, emailSource: 'manual', manualSourceUrl: source, emailSourceUrl: source, checkedAt: discovery.checkedAt || null, enteredAt: new Date().toISOString(), enteredBy: ctx.userId, summary: `Added by hand${source ? ` from ${source}` : ''}.`, markedNoEmail: null,
      });
    } else {
      updates.email = null;
      delete detailsSource.email;
      Object.assign(discovery, { status: discovery.status === 'found' ? 'not_checked' : discovery.status, email: null, summary: null });
    }
    changed.push('email');
  }

  if (input.markNoEmail) {
    if (organization.email && updates.email !== null) throw invalid('This business already has an email. Remove it first if it’s wrong.');
    Object.assign(discovery, {
      status: 'none_found', markedNoEmail: { by: ctx.userId, at: new Date().toISOString(), note: String(input.note || '').trim().slice(0, 300) || null }, summary: 'Checked by hand — no public email found.',
    });
    changed.push('markNoEmail');
  }

  if (!changed.length) throw invalid('Nothing to save');
  updates.detailsSource = detailsSource;
  updates.emailDiscovery = discovery;
  await organization.update(updates);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.contact_research_updated', targetType: 'Organization', targetId: organization.id, metadata: { fields: changed }, req: ctx.req,
  });
  return present(organization);
}

/** Keeps the discovery record in step when the email is edited in the business form. */
function discoveryAfterManualEmail(organization, email, userId) {
  const discovery = { ...(organization.emailDiscovery || {}) };
  if (email) {
    return {
      ...discovery, status: 'found', email, emailSource: 'manual', emailSourceUrl: null, manualSourceUrl: null, enteredAt: new Date().toISOString(), enteredBy: userId, summary: 'Added by hand.',
    };
  }
  return { ...discovery, status: discovery.status === 'found' ? 'not_checked' : (discovery.status || 'not_checked'), email: null, summary: null };
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  discover,
  discoverForSearchResult,
  cachedForPlace,
  afterLeadSaved,
  applyResult,
  requestForLead,
  statusForLeads,
  updateResearch,
  present,
  discoveryAfterManualEmail,
  normalizeFacebookUrl,
  isSocialUrl,
  extractEmails,
  judgeEmail,
};
