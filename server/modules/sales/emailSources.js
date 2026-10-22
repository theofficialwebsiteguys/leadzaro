'use strict';

const { registrableDomain } = require('./salesCommon');

/**
 * Where each email address was found (ADR 0017). Stored per address on
 * the business (Organization.emailSources, keyed by the lower-cased email)
 * as a choice from a short list, an optional note for "Other", and an
 * optional link. Older records kept a free-text "source" that was treated
 * as a link; that text is mapped to the nearest choice and also kept
 * verbatim (legacyText) so nothing anyone typed is lost.
 */

const EMAIL_SOURCE_TYPES = {
  website: 'Website / contact page',
  facebook: 'Facebook',
  privacy_policy: 'Privacy policy',
  social: 'Instagram / other social profile',
  google_business: 'Google Business Profile',
  directory: 'Business directory',
  referral: 'Referral / direct conversation',
  other: 'Other',
};

const DIRECTORY_HOSTS = new Set(['yelp.com', 'yellowpages.com', 'bbb.org', 'angi.com', 'homeadvisor.com', 'thumbtack.com', 'mapquest.com', 'manta.com', 'chamberofcommerce.com', 'nextdoor.com', 'houzz.com', 'porch.com']);
const SOCIAL_HOSTS = new Set(['instagram.com', 'linkedin.com', 'tiktok.com', 'x.com', 'twitter.com', 'youtube.com', 'pinterest.com', 'threads.net', 'linktr.ee']);
const LOOKS_LIKE_URL = /^(https?:\/\/)?[^\s/$.?#]+\.[^\s]{2,}$/i;

/** The nearest choice for a typed source ("Facebook", "their contact page", "yelp.com/biz/…"). */
function inferType(text, { websiteUrl = null } = {}) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;
  if (LOOKS_LIKE_URL.test(value)) {
    const domain = registrableDomain(value);
    if (/privacy/.test(value)) return 'privacy_policy';
    if (domain === 'facebook.com' || domain === 'fb.com' || domain === 'fb.me') return 'facebook';
    if (SOCIAL_HOSTS.has(domain)) return 'social';
    if (DIRECTORY_HOSTS.has(domain)) return 'directory';
    if (/google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|g\.page|business\.google/.test(value)) return 'google_business';
    if (websiteUrl && domain && domain === registrableDomain(websiteUrl)) return 'website';
    return 'website';
  }
  if (/facebook|\bfb\b/.test(value)) return 'facebook';
  if (/privacy/.test(value)) return 'privacy_policy';
  if (/instagram|insta\b|linkedin|tiktok|twitter|\bx\.com|youtube|social/.test(value)) return 'social';
  if (/google|gbp|business profile|maps/.test(value)) return 'google_business';
  if (/yelp|directory|yellow ?pages|bbb|angi|thumbtack|chamber|nextdoor/.test(value)) return 'directory';
  if (/referr|called|phone call|spoke|talked|in person|conversation|told us|direct/.test(value)) return 'referral';
  if (/website|site|contact (page|us)|about|footer|home ?page/.test(value)) return 'website';
  return 'other';
}

function cleanLink(value) {
  let url = String(value || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.slice(0, 500);
}

/**
 * One email's source from what the form (or an older record) sent. Returns
 * { source } or { problem, field } — never throws, so the caller can put
 * the problem next to the right field.
 *   - sourceType: one of EMAIL_SOURCE_TYPES (new form)
 *   - sourceNote: short text, needed only for "Other"
 *   - sourceUrl:  optional link; older forms sent free text here
 */
function normalizeEmailSource(entry = {}, { websiteUrl = null } = {}) {
  const rawUrl = String(entry.sourceUrl || '').trim();
  const note = String(entry.sourceNote || '').trim().slice(0, 200) || null;
  let type = entry.sourceType ? String(entry.sourceType) : null;
  if (type && !EMAIL_SOURCE_TYPES[type]) return { problem: 'Choose where you found this email from the list.', field: 'sourceType' };

  let url = null;
  let legacyText = null;
  if (rawUrl) {
    if (LOOKS_LIKE_URL.test(rawUrl) && !/\s/.test(rawUrl)) url = cleanLink(rawUrl);
    else if (type) return { problem: 'That isn’t a web address. Paste the link, or leave it empty.', field: 'sourceUrl' };
    else legacyText = rawUrl.slice(0, 200); // an older form's free text, e.g. "Facebook"
  }
  if (!type) type = inferType(legacyText || url, { websiteUrl });
  if (type === 'other' && !note && !legacyText) return { problem: 'Say briefly where you found it.', field: 'sourceNote' };
  if (!type) return { source: null };
  return {
    source: {
      type, note: note || (type === 'other' ? legacyText : null), url, legacyText,
    },
  };
}

/** How a stored source reads to sales: "Facebook", "Other — flyer in the window", with its link if any. */
function describe(source) {
  if (!source || !source.type) return null;
  const label = EMAIL_SOURCE_TYPES[source.type] || 'Other';
  return {
    type: source.type,
    label: source.note ? `${label} — ${source.note}` : label,
    url: source.url || null,
    by: source.by || null,
    at: source.at || null,
    legacyText: source.legacyText || null,
  };
}

/** Merges one email's source into the business's map without dropping the others. */
function withSource(map, email, source, { userId = null, keepExisting = false } = {}) {
  const key = String(email || '').trim().toLowerCase();
  const next = { ...(map || {}) };
  if (!key || !source) return next;
  if (keepExisting && next[key]) return next;
  next[key] = { ...source, by: userId, at: new Date().toISOString() };
  return next;
}

/** The source for one address, falling back to what older discovery records say. */
function sourceFor(organization, email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  const stored = organization.emailSources?.[key];
  if (stored) return describe(stored);
  const d = organization.emailDiscovery || {};
  if (d.email && String(d.email).toLowerCase() === key && d.emailSource && d.emailSource !== 'manual' && d.emailSourceUrl) {
    return describe({ type: inferType(d.emailSourceUrl, { websiteUrl: organization.website }), url: d.emailSourceUrl });
  }
  const legacy = d.manualSourceUrl || (d.email && String(d.email).toLowerCase() === key ? d.emailSourceUrl : null);
  if (legacy) {
    const { source } = normalizeEmailSource({ sourceUrl: legacy }, { websiteUrl: organization.website });
    return describe(source);
  }
  return null;
}

module.exports = {
  EMAIL_SOURCE_TYPES, inferType, normalizeEmailSource, describe, withSource, sourceFor,
};
