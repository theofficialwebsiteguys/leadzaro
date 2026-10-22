'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Lead, Contact, User, WorkCredit, ResearchClaim,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const {
  QUALIFICATION_LABELS, IN_QUALIFICATION, STAGE_LABELS, LIFECYCLE_LABELS, lifecycleOf,
} = require('../../core/crm/pipelineCatalog');
const contactDiscovery = require('./contactDiscoveryService');
const emailSources = require('./emailSources');
const { membersWith, memberHas } = require('./teamMembers');
const {
  invalid, isEmail, assertNoSecrets, phoneKey, nameKey, isUniqueViolation,
} = require('./salesCommon');

/**
 * Guided lead qualification (ADR 0016, revised by ADR 0017): choose a
 * business, check its links, collect contact details, record one specific
 * reason to reach out, then assign it to a salesperson.
 *
 * A qualification is checked in full before anything is written, and then
 * written in one transaction — a lead, its research, its assignment and the
 * qualifier's credit appear together or not at all. A business that is
 * already in Leadzaro gets the research added to it (keeping its owner,
 * stage, notes and history), or, when it's only a possible match, can be
 * saved as a separate record flagged for a manager to check.
 */

const SOURCE_KEYS = ['google', 'website', 'facebook'];
const SOURCE_LABELS = {
  google: 'Google listing', website: 'Website', facebook: 'Facebook page', social: 'Social profile',
};
const SOURCE_STATUSES = ['not_checked', 'found', 'not_found', 'unable'];
const CONTACT_STATUSES = ['not_checked', 'found', 'not_found'];

/** Quick picks for the reason to reach out. Each is phrased as what was observed, never as a claim beyond it. */
const REASON_OPTIONS = [
  { key: 'no_website', label: 'No website found', text: 'No website found on the sources checked' },
  { key: 'broken_links', label: 'Broken links', text: 'Their website has broken links' },
  { key: 'outdated_info', label: 'Outdated information', text: 'Important business information on their website appears outdated' },
  { key: 'mobile_navigation', label: 'Hard to use on mobile', text: 'Their website is difficult to navigate on a phone' },
  { key: 'no_contact_action', label: 'No clear contact or booking', text: 'Their website has no clear way to contact or book' },
  { key: 'relies_on_facebook', label: 'Relies mainly on Facebook', text: 'The business relies mainly on its Facebook page' },
  { key: 'other', label: 'Something else', text: '' },
];
const REASON_KEYS = new Set(REASON_OPTIONS.map((r) => r.key));

// Temporary search pages are not the business's own links.
const SEARCH_URL = /(google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/|facebook\.com\/search|yahoo\.com\/search)/i;
const GOOGLE_LISTING_URL = /(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page\/|business\.google\.com|g\.co\/kgs)/i;

const USER_ATTRS = ['id', 'name'];

const SOCIAL_PLATFORMS = {
  instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', x: 'X / Twitter', youtube: 'YouTube', yelp: 'Yelp', nextdoor: 'Nextdoor', pinterest: 'Pinterest', other: 'Other',
};

const PARK_STATUSES = { needs_research: 'Needs more information', unsuitable: 'Not suitable', draft: 'Back to research' };

const text = (value, max) => String(value ?? '').trim().slice(0, max);

/** A problem with one form field, reported against that field so the form can show it there. */
function fieldInvalid(field, message, statusCode = 422) {
  return invalid(message, statusCode, { field, fields: { [field]: message } });
}

function isManager(ctx) {
  return ctx.can('leads.assign') || ctx.can('team.review_work');
}

function cleanUrl(value, key, field = `sources.${key}.url`) {
  const label = SOURCE_LABELS[key] || 'Link';
  // Harmless copy-and-paste extras: spaces, quotes or angle brackets around the link.
  let url = String(value || '').trim().replace(/^[<"'(]+|[>"')]+$/g, '').trim();
  if (!url) return null;
  if (url.length > 500) throw fieldInvalid(field, `${label}: that link is too long.`);
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (/\s/.test(url) || !/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}/i.test(url)) {
    throw fieldInvalid(field, `${label}: that doesn’t look like a web address. Paste the link from your browser’s address bar.`);
  }
  if (SEARCH_URL.test(url)) throw fieldInvalid(field, `${label}: that’s a search results page. Open the business’s own page and copy its address instead.`);
  if (key === 'google' && !GOOGLE_LISTING_URL.test(url)) throw fieldInvalid(field, 'Google listing: paste the link to their Google Maps / Business Profile page.');
  if (key === 'facebook') {
    const normalized = contactDiscovery.normalizeFacebookUrl(url);
    if (!normalized) throw fieldInvalid(field, 'Facebook page: paste the link to the business’s own Facebook page (facebook.com/…).');
    return normalized;
  }
  return url;
}

/** A link filled in automatically (e.g. the Google listing a phone came from): kept when valid, dropped otherwise. */
function quietLink(value) {
  try { return cleanUrl(value, 'link'); } catch { return null; }
}

const STEP_OF = {
  business: 1, leadData: 1, sources: 2, socials: 2, contacts: 3, reason: 4, assigneeUserId: 5,
};

/**
 * Checks a qualification and returns it in the shape it's stored in.
 * Every problem is reported against its own field — all at once — so the
 * form can show each one where it was typed and keep everything else.
 *   partial:   only the sections sent are checked (saving one step at a time)
 *   parking:   saving as "needs more info" or "not relevant" — gaps are fine,
 *              and an answer of "found" with nothing filled in counts as not checked
 *   forgiving: "not relevant" — a mistyped optional value is dropped rather
 *              than blocking the decision (the business name is still required)
 */
function normalizeSubmission(input = {}, { partial = false, parking = false, forgiving = false } = {}) {
  const fields = {};
  const problem = (field, message) => {
    if (forgiving && !field.startsWith('business.')) return;
    if (!fields[field]) fields[field] = message;
  };
  const has = (prefix) => Object.keys(fields).some((f) => f.startsWith(prefix));
  const missing = [];
  const out = {};

  if (input.leadData) {
    // eslint-disable-next-line global-require
    const { cleanLeadData } = require('./leadIntakeService');
    try { out.leadData = cleanLeadData(input.leadData); } catch { problem('business.name', 'Business name is required.'); }
  }
  const b = input.business || (input.leadData ? {
    name: input.leadData.name, addressLine1: input.leadData.address, city: input.leadData.city, state: input.leadData.state, postalCode: input.leadData.zip, category: input.leadData.category,
  } : null);
  if (b) {
    out.business = {};
    for (const [field, max] of [['name', 255], ['addressLine1', 255], ['city', 100], ['state', 100], ['postalCode', 20], ['category', 150]]) {
      if (b[field] !== undefined) out.business[field] = text(b[field], max) || null;
    }
    if ('name' in out.business && !out.business.name) problem('business.name', 'Business name is required.');
    if (!partial && !out.business.city && !out.business.addressLine1) missing.push({ step: 1, key: 'location', label: 'Town or address' });
  } else if (!partial) problem('business.name', 'Business name is required.');

  if (!partial || input.sources) {
    out.sources = {};
    for (const key of SOURCE_KEYS) {
      const s = input.sources?.[key] || (partial ? null : { status: 'not_checked' });
      if (!s) continue; // eslint-disable-line no-continue
      if (!SOURCE_STATUSES.includes(s.status)) { problem(`sources.${key}`, `${SOURCE_LABELS[key]}: choose what you found.`); continue; } // eslint-disable-line no-continue
      let url = null;
      let { status } = s;
      if (status === 'found') {
        try { url = cleanUrl(s.url, key); } catch (err) { problem(err.field, err.message); }
        if (!url && (parking || forgiving) && !has(`sources.${key}`)) status = 'not_checked';
        else if (!url) problem(`sources.${key}.url`, `${SOURCE_LABELS[key]}: paste the link you found, or choose another answer.`);
      }
      if (status === 'not_checked') missing.push({ step: 2, key: `source_${key}`, label: `Check their ${SOURCE_LABELS[key]}` });
      out.sources[key] = { status, url, note: s.note ? text(s.note, 300) : null };
    }
  }

  if (input.socials !== undefined) {
    out.socials = [];
    (Array.isArray(input.socials) ? input.socials : []).slice(0, 12).forEach((item, i) => {
      const raw = text(item?.url, 600);
      if (!raw) return;
      const platform = SOCIAL_PLATFORMS[item.platform] ? item.platform : 'other';
      try {
        const url = cleanUrl(raw, 'social', `socials.${i}.url`);
        if (!out.socials.some((x) => x.url === url)) out.socials.push({ platform, url });
      } catch (err) { problem(err.field, err.message); }
    });
  }

  const contacts = input.contacts || {};
  const listOf = (c, key, single) => (Array.isArray(c[key]) ? c[key] : (c[single.from] ? [single.map(c)] : []));
  if (!partial || contacts.email) {
    const c = contacts.email || { status: 'not_checked' };
    if (!CONTACT_STATUSES.includes(c.status)) problem('contacts.email', 'Email: choose what you found.');
    else {
      const values = [];
      if (c.status === 'found') {
        const list = listOf(c, 'values', {
          from: 'value', map: (x) => ({ value: x.value, sourceUrl: x.sourceUrl, sourceType: x.sourceType, sourceNote: x.sourceNote }),
        });
        list.forEach((e, i) => {
          // "mailto:" and trailing punctuation are copy-and-paste extras, not part of the address.
          const value = text(e?.value, 255).replace(/^mailto:/i, '').replace(/^[<(]+|[>),.;]+$/g, '').trim();
          if (!value) return;
          if (!isEmail(value)) { problem(`contacts.email.values.${i}.value`, `“${value}” doesn’t look like an email address. Copy it exactly as it appears.`); return; }
          const result = emailSources.normalizeEmailSource(e || {});
          if (result.problem) problem(`contacts.email.values.${i}.${result.field}`, result.problem);
          if (!values.some((v) => v.value.toLowerCase() === value.toLowerCase())) values.push({ value, source: result.source || null });
        });
      }
      let { status } = c;
      if (status === 'found' && !values.length && !has('contacts.email')) {
        if (parking || forgiving) status = 'not_checked';
        else problem('contacts.email.values.0.value', 'Enter the email you found, or choose “Not found”.');
      }
      if (status === 'not_checked') missing.push({ step: 3, key: 'email', label: 'Check for an email' });
      out.email = { status, values, note: c.note ? text(c.note, 300) : null };
    }
  }
  if (!partial || contacts.phone) {
    const c = contacts.phone || { status: 'not_checked' };
    if (!CONTACT_STATUSES.includes(c.status)) problem('contacts.phone', 'Phone: choose what you found.');
    else {
      const values = [];
      if (c.status === 'found') {
        listOf(c, 'values', { from: 'value', map: (x) => ({ value: x.value, sourceUrl: x.sourceUrl }) }).forEach((p, i) => {
          const value = text(p?.value, 50);
          if (!value) return;
          if (!phoneKey(value)) { problem(`contacts.phone.values.${i}.value`, `“${value}” isn’t a full phone number.`); return; }
          if (!values.some((v) => phoneKey(v.value) === phoneKey(value))) values.push({ value, label: p.label ? text(p.label, 60) : null, sourceUrl: quietLink(p.sourceUrl) });
        });
      }
      let { status } = c;
      if (status === 'found' && !values.length && !has('contacts.phone')) {
        if (parking || forgiving) status = 'not_checked';
        else problem('contacts.phone.values.0.value', 'Enter the number you found, or choose “Not found”.');
      }
      if (status === 'not_checked') missing.push({ step: 3, key: 'phone', label: 'Check for a phone number' });
      out.phone = { status, values };
    }
  }
  if (contacts.owner) {
    const c = contacts.owner;
    if (!CONTACT_STATUSES.includes(c.status)) problem('contacts.owner', 'Contact name: choose what you found.');
    else {
      const people = [];
      if (c.status === 'found') {
        listOf(c, 'people', { from: 'name', map: (x) => ({ name: x.name, title: x.title }) }).forEach((p, i) => {
          const name = text(p?.name, 255);
          if (!name) return;
          try { assertNoSecrets(name, 'Name'); } catch (err) { problem(`contacts.owner.people.${i}.name`, err.message); return; }
          if (!people.some((x) => x.name.toLowerCase() === name.toLowerCase())) people.push({ name, title: p.title ? text(p.title, 150) : null });
        });
      }
      let { status } = c;
      if (status === 'found' && !people.length && !has('contacts.owner')) {
        if (parking || forgiving) status = 'not_checked';
        else problem('contacts.owner.people.0.name', 'Enter the name you found, or choose “Not found”.');
      }
      out.owner = { status, people };
    }
  }

  if (!partial || input.reason) {
    const r = input.reason || {};
    const tags = (Array.isArray(r.tags) ? r.tags : []).filter((t) => REASON_KEYS.has(t)).slice(0, 7);
    const reasonText = String(r.text ?? '').trim();
    const context = text(r.context, 500);
    if (reasonText.length > 1000) problem('reason.text', 'Keep the reason short — under 1,000 characters.');
    else {
      try { assertNoSecrets(reasonText, 'Reason to reach out'); } catch (err) { problem('reason.text', err.message); }
      try { assertNoSecrets(context, 'Supporting link or note'); } catch (err) { problem('reason.context', err.message); }
    }
    if (!reasonText && !parking) missing.push({ step: 4, key: 'reason', label: 'Reason to reach out' });
    out.reason = { tags, text: reasonText.slice(0, 1000), context: context || null };
  }
  if (Number.isInteger(input.step) && input.step >= 1 && input.step <= 5) out.step = input.step;
  // The lead row keeps only checked values: the website and listing as verified above, the main phone.
  if (out.leadData && out.sources) {
    out.leadData.website = out.sources.website?.url || null;
    out.leadData.hasWebsite = Boolean(out.leadData.website);
    if (out.sources.google?.url) out.leadData.googleMapsUrl = out.sources.google.url;
    out.leadData.phone = out.phone?.values?.[0]?.value || null;
  }

  const list = Object.keys(fields);
  if (list.length) {
    const first = list[0];
    const more = list.length > 1 ? ` (and ${list.length - 1} more thing${list.length === 2 ? '' : 's'} to fix)` : '';
    throw invalid(`${fields[first]}${more}`, 422, { field: first, fields, step: STEP_OF[first.split('.')[0]] || null });
  }
  if (!partial && !parking) {
    if (missing.length) throw invalid(`Still needed: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 422, { missing, step: missing[0].step });
    if (out.email?.status !== 'found' && out.phone?.status !== 'found') {
      throw invalid('Sales needs at least one usable email or phone. Save it as “Needs more information” or “Not suitable” instead.', 422, { code: 'no_contact', step: 3 });
    }
  }
  return out;
}

/** Adds extra emails, phones and people as contacts, without duplicating ones already there. */
async function addExtraContacts(ctx, organization, { emails, phones, people }, transaction) {
  const existing = await Contact.findAll({ where: { organizationId: organization.id, deletedAt: null }, transaction });
  const has = (field, value) => existing.some((c) => c[field] && String(c[field]).toLowerCase() === String(value).toLowerCase());
  const add = async (fields) => {
    const created = await Contact.create({
      organizationId: organization.id, agencyOrganizationId: ctx.agencyId, source: 'manual', isPrimary: false, ...fields,
    }, { transaction });
    existing.push(created);
  };
  for (const e of emails) if (e.value.toLowerCase() !== String(organization.email || '').toLowerCase() && !has('email', e.value)) await add({ name: e.value, email: e.value });
  for (const p of phones) if (phoneKey(p.value) !== phoneKey(organization.phone) && !existing.some((c) => phoneKey(c.phone) && phoneKey(c.phone) === phoneKey(p.value))) await add({ name: p.label || p.value, phone: p.value });
  for (const person of people) if (!has('name', person.name)) await add({ name: person.name, title: person.title });
}

async function setOwnerContact(ctx, organization, research, owner, transaction) {
  const existingId = research.contacts?.owner?.contactId;
  let contact = existingId ? await Contact.findOne({ where: { id: existingId, organizationId: organization.id, deletedAt: null }, transaction }) : null;
  if (contact) {
    await contact.update({ name: owner.name, title: owner.title }, { transaction });
  } else {
    const count = await Contact.count({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, transaction });
    contact = await Contact.create({
      organizationId: organization.id, agencyOrganizationId: ctx.agencyId, name: owner.name, title: owner.title, source: 'manual', isPrimary: count === 0,
    }, { transaction });
  }
  return contact.id;
}

/**
 * Writes checked research onto a lead and its business.
 *   additive: the lead belongs to someone else's work (an existing lead).
 *   Empty fields are filled, nothing is cleared or overwritten, extra
 *   contacts are added beside the existing ones, and a different reason
 *   is kept as an attributed addition — the original stays as it was.
 */
async function applyResearch(ctx, {
  opportunity, organization, data, additive = false, transaction,
}) {
  const now = new Date().toISOString();
  const research = JSON.parse(JSON.stringify(opportunity.research || {}));
  research.sources = research.sources || {};
  research.contacts = research.contacts || {};
  const org = {};
  const detailsSource = { ...(organization.detailsSource || {}) };
  const fillable = (column) => !additive || !organization[column];
  const extras = { emails: [], phones: [], people: [] };
  const by = { checkedAt: now, checkedBy: ctx.userId };

  for (const [field, value] of Object.entries(data.business || {})) {
    if (field === 'name') { if (!additive && value) org.name = value; } else if (!additive || (value && !organization[field])) org[field] = value;
  }

  for (const key of SOURCE_KEYS) {
    const s = data.sources?.[key];
    if (!s) continue; // eslint-disable-line no-continue
    const previous = research.sources[key];
    // Adding to an existing lead never downgrades what someone else found.
    if (additive && (s.status === 'not_checked' || (previous?.status === 'found' && s.status !== 'found'))) continue; // eslint-disable-line no-continue
    research.sources[key] = {
      status: s.status, url: s.url, note: s.note, ...by,
    };
    const column = { website: 'website', facebook: 'facebookUrl' }[key];
    if (!column) continue; // eslint-disable-line no-continue
    if (s.url) {
      if (fillable(column)) { org[column] = s.url; detailsSource[key] = 'manual'; }
    } else if (s.status === 'not_found' && !additive) { org[column] = null; delete detailsSource[key]; }
  }

  if (data.socials) {
    const current = Array.isArray(organization.socialLinks) ? organization.socialLinks : [];
    org.socialLinks = additive ? [...current, ...data.socials.filter((s) => !current.some((c) => c.url === s.url))].slice(0, 20) : data.socials;
  }

  let sources = { ...(organization.emailSources || {}) };
  if (data.email) {
    const e = data.email;
    if (e.status === 'found' && e.values.length) {
      const [main] = e.values;
      if (!organization.email || (!additive && main.value.toLowerCase() !== organization.email.toLowerCase())) {
        org.email = main.value;
        org.emailDiscovery = contactDiscovery.discoveryAfterManualEmail(organization, main.value, ctx.userId);
        // Format-checked only — never labelled verified.
        detailsSource.email = 'manual';
      }
      const primary = String(org.email || organization.email || '').toLowerCase();
      extras.emails = e.values.filter((v) => v.value.toLowerCase() !== primary);
      for (const v of e.values) if (v.source) sources = emailSources.withSource(sources, v.value, v.source, { userId: ctx.userId, keepExisting: additive });
      research.contacts.email = { status: 'found', ...by };
    } else if (!(additive && (organization.email || research.contacts.email?.status === 'found'))) {
      if (e.status === 'not_found') {
        if (organization.email) { org.email = null; delete detailsSource.email; }
        // "Checked — no email found" is recorded as such, so nobody has to invent a placeholder.
        org.emailDiscovery = {
          ...contactDiscovery.discoveryAfterManualEmail(organization, null, ctx.userId),
          status: 'none_found',
          summary: 'Checked by hand — no public email found.',
          markedNoEmail: { by: ctx.userId, at: now, note: e.note || null },
        };
      }
      research.contacts.email = { status: e.status, ...by };
    }
  }
  if (Object.keys(sources).length) org.emailSources = sources;

  if (data.phone) {
    const p = data.phone;
    if (p.status === 'found' && p.values.length) {
      const [main] = p.values;
      if (!organization.phone || (!additive && phoneKey(main.value) !== phoneKey(organization.phone))) { org.phone = main.value; detailsSource.phone = 'manual'; }
      const primaryKey = phoneKey(org.phone || organization.phone);
      extras.phones = p.values.filter((v) => phoneKey(v.value) !== primaryKey);
      research.contacts.phone = { status: 'found', sourceUrl: main.sourceUrl || null, ...by };
    } else if (!(additive && (organization.phone || research.contacts.phone?.status === 'found'))) {
      if (p.status === 'not_found' && organization.phone && !additive) { org.phone = null; delete detailsSource.phone; }
      research.contacts.phone = { status: p.status, sourceUrl: null, ...by };
    }
  }

  if (data.owner) {
    const o = data.owner;
    if (o.status === 'found' && o.people.length) {
      if (additive) {
        extras.people = o.people;
        if (research.contacts.owner?.status !== 'found') research.contacts.owner = { status: 'found', contactId: null, ...by };
      } else {
        const [first, ...rest] = o.people;
        const contactId = await setOwnerContact(ctx, organization, research, first, transaction);
        extras.people = rest;
        research.contacts.owner = { status: 'found', contactId, ...by };
      }
    } else if (!(additive && research.contacts.owner?.status === 'found')) {
      research.contacts.owner = { status: o.status, contactId: null, ...by };
    }
  }

  const opp = {};
  if (data.reason) {
    const r = data.reason;
    const current = String(opportunity.outreachReason || '').trim();
    if (!additive || !current) {
      opp.outreachReason = r.text || null;
      research.reasonTags = r.tags;
      research.reasonContext = r.context;
      if (r.text) research.reasonBy = { userId: ctx.userId, at: now };
    } else if (r.text && r.text !== current) {
      research.reasonAdditions = [...(research.reasonAdditions || []), {
        text: r.text, tags: r.tags, context: r.context, by: ctx.userId, at: now,
      }].slice(-20);
    }
  }
  if (data.step) research.step = data.step;
  research.updatedAt = now;
  research.updatedBy = ctx.userId;

  if (Object.keys(org).length) await organization.update({ ...org, detailsSource }, { transaction });
  await opportunity.update({ ...opp, research }, { transaction });
  if (extras.emails.length || extras.phones.length || extras.people.length) await addExtraContacts(ctx, organization, extras, transaction);
}

function initialResearch(leadData = {}) {
  const status = (value) => (value ? 'found' : 'not_checked');
  return {
    step: 2,
    sources: {
      google: { status: status(leadData.googleMapsUrl), url: leadData.googleMapsUrl || null, from: leadData.googleMapsUrl ? 'search' : null },
      website: { status: status(leadData.website), url: leadData.website || null, from: leadData.website ? 'search' : null },
      facebook: { status: 'not_checked', url: null },
    },
    contacts: {
      email: { status: 'not_checked' },
      phone: { status: status(leadData.phone), sourceUrl: leadData.phone && leadData.googleMapsUrl ? leadData.googleMapsUrl : null, from: leadData.phone ? 'search' : null },
      owner: { status: 'not_checked', contactId: null },
    },
    reasonTags: [],
  };
}

/** Starts qualification on a freshly created lead (called from lead intake). */
async function startDraft(ctx, opportunity, leadData) {
  await opportunity.update({
    qualificationStatus: 'draft', researcherUserId: ctx.userId, assignedToUserId: null, research: initialResearch(leadData),
  });
}

function canEdit(ctx, opportunity) {
  if (!ctx.can('qualification.work') && !isManager(ctx)) return false;
  if (isManager(ctx)) return true;
  return opportunity.researcherUserId === ctx.userId;
}

async function load(ctx, opportunityId, { transaction, lock } = {}) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    ...(transaction ? { transaction } : {}),
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!opportunity) throw invalid('Lead not found', 404);
  // A qualifier sees only their own research; sales and managers can read any.
  const readable = canEdit(ctx, opportunity) || ctx.can('leads.read');
  if (!readable) throw invalid('Lead not found', 404);
  return opportunity;
}

function sourcesFor(research, organization, lead) {
  const saved = research.sources || {};
  const out = {};
  for (const key of SOURCE_KEYS) {
    const entry = { status: 'not_checked', url: null, ...(saved[key] || {}) };
    if (key === 'website') entry.url = organization.website || (entry.status === 'found' ? entry.url : null);
    if (key === 'facebook') entry.url = organization.facebookUrl || (entry.status === 'found' ? entry.url : null);
    if (key === 'google') entry.url = entry.url || lead?.googleMapsUrl || null;
    out[key] = { ...entry, label: SOURCE_LABELS[key] };
  }
  return out;
}

function missingFor(q) {
  const missing = [];
  if (!q.business.name) missing.push({ step: 1, key: 'name', label: 'Business name' });
  if (!q.business.city && !q.business.addressLine1) missing.push({ step: 1, key: 'location', label: 'Town or address' });
  for (const key of SOURCE_KEYS) {
    if (q.sources[key].status === 'not_checked') missing.push({ step: 2, key: `source_${key}`, label: `Check their ${SOURCE_LABELS[key]}` });
  }
  if (q.contacts.email.status === 'not_checked') missing.push({ step: 3, key: 'email', label: 'Check for an email' });
  if (q.contacts.phone.status === 'not_checked') missing.push({ step: 3, key: 'phone', label: 'Check for a phone number' });
  if (!q.reason.text) missing.push({ step: 4, key: 'reason', label: 'Reason to reach out' });
  return missing;
}

async function present(ctx, opportunity) {
  const [organization, lead, researcher, qualifiedBy, assignedTo, credit] = await Promise.all([
    Organization.findByPk(opportunity.organizationId),
    opportunity.sourceLeadId ? Lead.findByPk(opportunity.sourceLeadId) : null,
    opportunity.researcherUserId ? User.findByPk(opportunity.researcherUserId, { attributes: USER_ATTRS }) : null,
    opportunity.qualifiedByUserId ? User.findByPk(opportunity.qualifiedByUserId, { attributes: USER_ATTRS }) : null,
    opportunity.assignedToUserId ? User.findByPk(opportunity.assignedToUserId, { attributes: USER_ATTRS }) : null,
    WorkCredit.findOne({ where: { opportunityId: opportunity.id, kind: 'qualification' } }),
  ]);
  const research = opportunity.research || {};
  const savedContacts = research.contacts || {};
  const ownerContact = savedContacts.owner?.contactId
    ? await Contact.findOne({ where: { id: savedContacts.owner.contactId, organizationId: organization.id, deletedAt: null } })
    : await Contact.findOne({ where: { organizationId: organization.id, isPrimary: true, archivedAt: null, deletedAt: null } });
  const discovery = contactDiscovery.present(organization);
  const others = await Contact.findAll({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] });
  const emailValues = [organization.email, ...others.map((c) => c.email)]
    .filter((v, i, all) => v && all.findIndex((x) => x && x.toLowerCase() === v.toLowerCase()) === i)
    .map((value) => ({ value, source: emailSources.sourceFor(organization, value) }));
  const mainSource = organization.email ? emailSources.sourceFor(organization, organization.email) : null;

  const q = {
    opportunityId: opportunity.id,
    status: opportunity.qualificationStatus,
    statusLabel: opportunity.qualificationStatus ? QUALIFICATION_LABELS[opportunity.qualificationStatus] : 'Not qualified in Leadzaro',
    inProgress: IN_QUALIFICATION.includes(opportunity.qualificationStatus),
    note: opportunity.qualificationNote,
    step: research.step || 1,
    stage: opportunity.stage,
    stageLabel: STAGE_LABELS[opportunity.stage],
    lifecycle: lifecycleOf(opportunity, { isClient: organization.type === 'client' }),
    business: {
      organizationId: organization.id,
      name: organization.name,
      category: organization.category,
      addressLine1: organization.addressLine1,
      city: organization.city,
      state: organization.state,
      postalCode: organization.postalCode,
      isClient: organization.type === 'client',
      rating: lead?.rating ? Number(lead.rating) : null,
      reviewCount: lead?.reviewCount ?? null,
      fromSearch: Boolean(lead && lead.source !== 'manual'),
    },
    sources: sourcesFor(research, organization, lead),
    contacts: {
      email: {
        status: organization.email ? 'found' : (savedContacts.email?.status || 'not_checked'),
        value: organization.email || null,
        source: mainSource,
        sourceUrl: mainSource?.url || null,
        from: organization.email ? (discovery.emailSource || 'manual') : null,
        values: emailValues,
      },
      phone: {
        status: organization.phone ? 'found' : (savedContacts.phone?.status || 'not_checked'),
        value: organization.phone || null,
        sourceUrl: savedContacts.phone?.sourceUrl || null,
        from: savedContacts.phone?.from || null,
        values: [organization.phone ? { value: organization.phone, label: null } : null, ...others.filter((c) => c.phone).map((c) => ({ value: c.phone, label: c.name !== c.phone ? c.name : null }))].filter(Boolean),
      },
      owner: {
        status: ownerContact ? 'found' : (savedContacts.owner?.status || 'not_checked'),
        contactId: ownerContact?.id || null,
        name: ownerContact?.name || null,
        title: ownerContact?.title || null,
        sourceUrl: null,
        people: others.filter((c) => c.name && c.name !== c.email && c.name !== c.phone).map((c) => ({ name: c.name, title: c.title })),
      },
    },
    socials: organization.socialLinks || [],
    emailDiscovery: discovery,
    reason: {
      tags: Array.isArray(research.reasonTags) ? research.reasonTags : [],
      text: opportunity.outreachReason || '',
      context: research.reasonContext || '',
      evidence: opportunity.outreachEvidence || '',
    },
    review: opportunity.qualificationStatus === 'needs_review' ? await presentReview(ctx, research.review) : null,
    researcher,
    qualifiedBy,
    qualifiedAt: opportunity.qualifiedAt,
    assignedTo,
    credit: credit ? {
      status: credit.status, reviewNote: credit.reviewNote, correctionCount: credit.correctionCount, lastCorrectionReason: credit.lastCorrectionReason,
    } : null,
    canEdit: canEdit(ctx, opportunity),
    canResolveReview: isManager(ctx),
  };
  q.missing = missingFor(q);
  q.hasUsableContact = q.contacts.email.status === 'found' || q.contacts.phone.status === 'found';
  return q;
}

async function getQualification(ctx, opportunityId) {
  const opportunity = await load(ctx, opportunityId);
  return {
    qualification: await present(ctx, opportunity),
    assignees: await membersWith(ctx.agencyId, 'outreach.send'),
    reasonOptions: REASON_OPTIONS,
    emailSourceTypes: emailSources.EMAIL_SOURCE_TYPES,
  };
}

function assertEditable(ctx, opportunity) {
  if (!canEdit(ctx, opportunity)) throw invalid('Only the person researching this lead (or a manager) can change it.', 403);
}

/**
 * Saves whatever part of the research was sent (one step at a time, or
 * several) on research that's already a lead. Every value is checked;
 * nothing is inferred or invented.
 */
async function saveResearch(ctx, opportunityId, input) {
  const opportunity = await load(ctx, opportunityId);
  assertEditable(ctx, opportunity);
  if (opportunity.qualificationStatus === 'assigned' && !isManager(ctx)) {
    throw invalid('This lead is already with sales. Ask them to return it if something needs correcting.', 409);
  }
  const data = normalizeSubmission(input, { partial: true });
  await sequelize.transaction(async (transaction) => {
    const locked = await load(ctx, opportunityId, { transaction, lock: true });
    const organization = await Organization.findByPk(locked.organizationId, { transaction, lock: transaction.LOCK.UPDATE });
    await applyResearch(ctx, {
      opportunity: locked, organization, data, additive: Boolean(input.keepExisting), transaction,
    });
  });
  return getQualification(ctx, opportunityId);
}

/** What the qualifier checked, written out so a reason like “no website found” keeps its scope. */
function evidenceFor(sources) {
  const parts = SOURCE_KEYS.map((key) => {
    const s = sources[key] || { status: 'not_checked' };
    const state = {
      found: 'found', not_found: 'not found', unable: 'could not be opened', not_checked: 'not checked',
    }[s.status] || 'not checked';
    return `${SOURCE_LABELS[key]}: ${state}${s.status === 'found' && s.url ? ` (${s.url})` : ''}`;
  });
  return `Checked by the qualifier on ${new Date().toISOString().slice(0, 10)} — ${parts.join('; ')}.`;
}

/**
 * Marks research complete inside the caller's transaction: assigned to a
 * salesperson (or ready for assignment), the original reason kept, and
 * exactly one qualification credit (unique per lead) — so a repeated or
 * merged submission is never counted twice.
 */
async function finishQualification(ctx, opportunity, {
  assigneeUserId = null, qualifierUserId = null, creditNote = null, transaction,
}) {
  const now = new Date();
  const firstCompletion = !opportunity.qualifiedAt;
  const research = { ...(opportunity.research || {}), step: 5 };
  const qualifier = opportunity.qualifiedByUserId || qualifierUserId || opportunity.researcherUserId || ctx.userId;
  if (!research.reasonOriginal && opportunity.outreachReason) {
    research.reasonOriginal = {
      text: opportunity.outreachReason, tags: research.reasonTags || [], context: research.reasonContext || null, by: research.reasonBy?.userId || qualifier, at: now.toISOString(),
    };
  }
  const assignee = assigneeUserId || opportunity.assignedToUserId || null;
  const reassigned = assignee && assignee !== opportunity.assignedToUserId;
  await opportunity.update({
    qualificationStatus: assignee ? 'assigned' : 'ready',
    qualifiedAt: opportunity.qualifiedAt || now,
    qualifiedByUserId: qualifier,
    qualificationNote: null,
    outreachEvidence: evidenceFor(research.sources || {}),
    assignedToUserId: assignee,
    // A new owner accepts it themselves; one already working the lead has.
    ...(reassigned ? { salesAcceptedAt: null, salesAcceptedByUserId: null } : {}),
    ...(!reassigned && assignee && opportunity.lastInteractionAt && !opportunity.salesAcceptedAt ? { salesAcceptedAt: now, salesAcceptedByUserId: assignee } : {}),
    research,
  }, { transaction });
  const [credit, created] = await WorkCredit.findOrCreate({
    where: { opportunityId: opportunity.id, kind: 'qualification' },
    defaults: {
      agencyOrganizationId: ctx.agencyId, userId: qualifier, status: 'pending', earnedAt: now, note: creditNote,
    },
    transaction,
  });
  // Resubmitted after a correction: back into the review queue, same credit.
  if (!created && credit.status === 'needs_correction') await credit.update({ status: 'pending' }, { transaction });
  return { firstCompletion, assigneeUserId: assignee };
}

/**
 * Completes research already saved as a lead: assigns it to a salesperson
 * (or marks it ready for assignment). Safe to click twice — the second
 * click returns the same result, and the credit is created exactly once.
 */
async function complete(ctx, opportunityId, { assigneeUserId = null } = {}) {
  const pre = await load(ctx, opportunityId);
  assertEditable(ctx, pre);
  if (assigneeUserId && !(await memberHas(ctx.agencyId, assigneeUserId, 'outreach.send'))) {
    throw fieldInvalid('assigneeUserId', 'Choose someone on the sales team.');
  }
  const q = await present(ctx, pre);
  if (pre.qualificationStatus === 'assigned') {
    if (!assigneeUserId || pre.assignedToUserId === assigneeUserId) return { ...(await getQualification(ctx, opportunityId)), alreadyComplete: true };
    throw invalid('This lead is already assigned to sales. A manager can reassign it from the lead page.', 409);
  }
  if (pre.qualificationStatus === 'needs_review') throw invalid('A manager is checking whether this is a duplicate. It can be completed once they’ve decided.', 409);
  if (!['draft', 'needs_research', 'needs_correction', 'ready'].includes(pre.qualificationStatus)) {
    throw invalid('This lead isn’t in qualification.', 409);
  }
  if (q.missing.length) {
    throw invalid(`Still needed: ${q.missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 422, { missing: q.missing });
  }
  if (!q.hasUsableContact) {
    throw invalid('Sales needs at least one usable email or phone number. Save it as “Needs more information” or “Not suitable” instead.', 422, { code: 'no_contact' });
  }

  let outcome = null;
  await sequelize.transaction(async (transaction) => {
    const opportunity = await load(ctx, opportunityId, { transaction, lock: true });
    // A second click (or a concurrent one) finds the work already done.
    if (opportunity.qualificationStatus === 'assigned' || (!assigneeUserId && opportunity.qualificationStatus === 'ready')) return;
    outcome = await finishQualification(ctx, opportunity, { assigneeUserId, transaction });
  });

  if (!outcome) return { ...(await getQualification(ctx, opportunityId)), alreadyComplete: true };
  await afterCompletion(ctx, opportunityId, { assigneeUserId: outcome.assigneeUserId, name: q.business.name, reason: q.reason.text, firstCompletion: outcome.firstCompletion });
  return getQualification(ctx, opportunityId);
}

async function afterCompletion(ctx, opportunityId, {
  assigneeUserId, name, reason, firstCompletion, action = 'qualification.completed', metadata = {},
}) {
  if (assigneeUserId && assigneeUserId !== ctx.userId) {
    await notify({
      userId: assigneeUserId,
      organizationId: ctx.agencyId,
      type: 'lead_assignment',
      title: `${name} is ready for you`,
      body: `${ctx.user?.name || 'A qualifier'} researched this lead and assigned it to you.${reason ? ` Why reach out: ${reason}` : ' No reason to reach out was recorded.'}`,
      data: { opportunityId, link: `/app/work/${opportunityId}` },
    }).catch(() => null);
  }
  await recordAudit({
    organizationId: ctx.agencyId,
    actorUserId: ctx.userId,
    action,
    targetType: 'Opportunity',
    targetId: opportunityId,
    metadata: { assigneeUserId, firstCompletion, ...metadata },
    req: ctx.req,
  });
}

/** Parks research as needing more information or unsuitable (with a reason), or reopens it. */
async function setStatus(ctx, opportunityId, { status, note }) {
  const opportunity = await load(ctx, opportunityId);
  assertEditable(ctx, opportunity);
  if (!PARK_STATUSES[status]) throw invalid('Unknown status');
  if (opportunity.qualificationStatus === 'assigned' && !isManager(ctx)) throw invalid('This lead is already with sales.', 409);
  if (opportunity.qualificationStatus === 'needs_review' && !isManager(ctx)) throw invalid('A manager is checking whether this is a duplicate.', 409);
  const textNote = String(note || '').trim().slice(0, 500);
  if (status !== 'draft' && !textNote) throw fieldInvalid('note', 'Add a short note so the next person knows why.');
  assertNoSecrets(textNote, 'Note');
  await opportunity.update({ qualificationStatus: status, qualificationNote: textNote || null });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.status_changed', targetType: 'Opportunity', targetId: opportunityId, metadata: { status }, req: ctx.req,
  });
  return getQualification(ctx, opportunityId);
}

/**
 * Sales (or a manager) sends a lead back to its qualifier, e.g. for wrong
 * contact details. Everything the qualifier recorded stays; the lead leaves
 * the sales queues until it's completed again, and the qualifier's credit
 * records the correction.
 */
async function returnForCorrection(ctx, opportunityId, { reason }) {
  const textReason = String(reason || '').trim().slice(0, 500);
  if (!textReason) throw fieldInvalid('reason', 'Say what needs correcting.');
  assertNoSecrets(textReason, 'Reason');
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  if (!opportunity.researcherUserId) throw invalid('This lead wasn’t qualified in Leadzaro, so there’s no qualifier to return it to. Fix the details on the lead instead.', 409);
  if (opportunity.assignedToUserId && opportunity.assignedToUserId !== ctx.userId && !isManager(ctx)) {
    throw invalid('Only the lead’s salesperson or a manager can return it.', 403);
  }
  if (['won', 'lost'].includes(opportunity.stage)) throw invalid('This deal is closed.', 409);
  await sequelize.transaction(async (transaction) => {
    const research = { ...(opportunity.research || {}) };
    research.returns = [...(research.returns || []), { by: ctx.userId, at: new Date().toISOString(), reason: textReason }].slice(-20);
    await opportunity.update({
      qualificationStatus: 'needs_correction', qualificationNote: textReason, salesAcceptedAt: null, salesAcceptedByUserId: null, research,
    }, { transaction });
    const credit = await WorkCredit.findOne({ where: { opportunityId, kind: 'qualification' }, transaction, lock: transaction.LOCK.UPDATE });
    if (credit) {
      await credit.update({
        correctionCount: credit.correctionCount + 1,
        lastCorrectionReason: textReason,
        status: credit.status === 'paid' ? 'paid' : 'needs_correction',
      }, { transaction });
    }
  });
  const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
  await notify({
    userId: opportunity.researcherUserId,
    organizationId: ctx.agencyId,
    type: 'qualification_returned',
    title: `${organization?.name || 'A lead'} needs a correction`,
    body: `${ctx.user?.name || 'Sales'}: ${textReason}`,
    data: { opportunityId, link: `/app/qualify/${opportunityId}` },
  }).catch(() => null);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.returned', targetType: 'Opportunity', targetId: opportunityId, metadata: { reason: textReason }, req: ctx.req,
  });
  return { returned: true };
}

function card(o) {
  return {
    opportunityId: o.id,
    businessName: o.organization?.name,
    city: o.organization?.city,
    state: o.organization?.state,
    status: o.qualificationStatus,
    statusLabel: QUALIFICATION_LABELS[o.qualificationStatus],
    note: o.qualificationNote,
    step: o.research?.step || 1,
    researcher: o.researcher,
    assignedTo: o.assignedTo,
    updatedAt: o.updatedAt,
    qualifiedAt: o.qualifiedAt,
    reason: o.outreachReason || null,
  };
}

/**
 * A qualifier's own work for My Work: research to resume, leads parked or
 * returned, possible duplicates being checked, leads ready to assign, and
 * what happened to recent handoffs. Managers also see everyone's ready leads.
 */
async function myResearch(ctx) {
  const include = [
    { model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state', 'email', 'phone', 'type'] },
    { model: User, as: 'researcher', attributes: USER_ATTRS },
    { model: User, as: 'assignedTo', attributes: USER_ATTRS },
  ];
  const base = { agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null };
  const [mine, readyAll, handedOff, drafts] = await Promise.all([
    Opportunity.findAll({
      where: { ...base, researcherUserId: ctx.userId, qualificationStatus: IN_QUALIFICATION },
      include,
      order: [['updatedAt', 'DESC']],
      limit: 100,
    }),
    isManager(ctx) ? Opportunity.findAll({
      where: { ...base, qualificationStatus: 'ready', researcherUserId: { [Op.ne]: ctx.userId } },
      include,
      order: [['qualifiedAt', 'ASC']],
      limit: 50,
    }) : [],
    Opportunity.findAll({
      where: { ...base, qualifiedByUserId: ctx.userId, qualificationStatus: 'assigned', qualifiedAt: { [Op.gte]: new Date(Date.now() - 21 * 86400000) } },
      include,
      order: [['qualifiedAt', 'DESC']],
      limit: 15,
    }),
    myDrafts(ctx),
  ]);
  return {
    drafts,
    inProgress: mine.filter((o) => ['draft', 'needs_research'].includes(o.qualificationStatus)).map(card),
    corrections: mine.filter((o) => o.qualificationStatus === 'needs_correction').map(card),
    needsReview: mine.filter((o) => o.qualificationStatus === 'needs_review').map(card),
    ready: [...mine.filter((o) => o.qualificationStatus === 'ready'), ...readyAll].map(card),
    // What happened after the handoff: accepted by sales, contacted, how it's going.
    handoffs: handedOff.map((o) => ({
      ...card(o),
      acceptedAt: o.salesAcceptedAt,
      contactedAt: o.lastInteractionAt,
      lifecycle: lifecycleOf(o, { isClient: o.organization?.type === 'client' }),
      lifecycleLabel: LIFECYCLE_LABELS[lifecycleOf(o, { isClient: o.organization?.type === 'client' })],
      stageLabel: STAGE_LABELS[o.stage],
    })),
  };
}

// ---- Qualifying a search result without saving it first (ADR 0016 revision)

const CLAIM_TTL_MS = 12 * 3600 * 1000;
const DRAFT_TTL_MS = 30 * 86400000;

/** Assignees, reason picks and email-source choices for a qualification that isn't saved yet. */
async function setup(ctx) {
  return { assignees: await membersWith(ctx.agencyId, 'outreach.send'), reasonOptions: REASON_OPTIONS, emailSourceTypes: emailSources.EMAIL_SOURCE_TYPES };
}

/** The agency's active lead for this Google listing, if there is one. */
async function sameListing(ctx, googlePlaceId, transaction = null) {
  if (!googlePlaceId) return null;
  const lead = await Lead.findOne({ where: { googlePlaceId }, attributes: ['id'], ...(transaction ? { transaction } : {}) });
  if (!lead) return null;
  return Opportunity.findOne({
    where: {
      agencyOrganizationId: ctx.agencyId, sourceLeadId: lead.id, deletedAt: null, archivedAt: null,
    },
    attributes: ['id'],
    ...(transaction ? { transaction } : {}),
  });
}

/**
 * What a teammate needs to know about a business that already exists, and
 * what research can do with it:
 *   qualify — it hasn't been qualified (or was parked): this research
 *             qualifies it, keeping its owner, stage and history;
 *   update  — it's already qualified or with sales: the research is added
 *             for its owner; nothing about its status changes;
 *   null    — nothing to add (a client, do-not-contact, being checked or
 *             researched by someone else), with the reason.
 */
async function describeExisting(ctx, opportunityId, transaction = null) {
  const o = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    include: [
      { model: Organization, as: 'organization', attributes: ['id', 'name', 'type', 'city', 'state'] },
      { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      { model: User, as: 'researcher', attributes: USER_ATTRS },
      { model: User, as: 'qualifiedBy', attributes: USER_ATTRS },
    ],
    ...(transaction ? { transaction } : {}),
  });
  if (!o) throw invalid('Lead not found', 404);
  const isClient = o.organization?.type === 'client' || o.stage === 'won';
  const mine = o.researcherUserId === ctx.userId;
  let mode = null;
  let reason = null;
  if (isClient) reason = 'it’s already a client, so it won’t go into new outreach.';
  else if (o.doNotContact) reason = 'it’s marked do not contact, so it won’t go back into outreach.';
  else if (o.archivedAt) reason = 'it was archived. A manager can restore it from Leads.';
  else if (o.qualificationStatus === 'needs_review') reason = 'a manager is already checking whether it’s a duplicate.';
  else if (o.qualificationStatus === 'needs_research' || o.qualificationStatus === 'unsuitable') mode = 'qualify';
  else if (IN_QUALIFICATION.includes(o.qualificationStatus)) {
    if (mine || isManager(ctx)) mode = 'qualify';
    else reason = `${o.researcher?.name || 'someone'} is researching it.`;
  } else if (o.qualificationStatus === 'assigned' || ['lost', 'nurture'].includes(o.stage)) mode = 'update';
  else mode = 'qualify';
  const lifecycle = lifecycleOf(o, { isClient });
  return {
    opportunityId: o.id,
    organizationId: o.organization?.id || null,
    name: o.organization?.name,
    location: [o.organization?.city, o.organization?.state].filter(Boolean).join(', ') || null,
    isClient,
    doNotContact: o.doNotContact,
    qualificationStatus: o.qualificationStatus,
    label: o.qualificationStatus && o.qualificationStatus !== 'assigned' ? QUALIFICATION_LABELS[o.qualificationStatus] : LIFECYCLE_LABELS[lifecycle],
    stageLabel: STAGE_LABELS[o.stage],
    lifecycle,
    assignedTo: o.assignedTo,
    researcher: o.researcher,
    qualifiedBy: o.qualifiedBy,
    mine: mine && IN_QUALIFICATION.includes(o.qualificationStatus),
    mergeable: Boolean(mode),
    mode,
    reason,
    // Opening the full lead is for people who can read leads (not qualifiers).
    canOpen: ctx.can('leads.read'),
    archived: Boolean(o.archivedAt),
  };
}

function cityKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;
}

/**
 * Businesses this research may be about, within this agency only, with how
 * sure the match is:
 *   same_listing — the same Google listing (certain);
 *   strong       — the same phone or email, or the same name in the same town;
 *   possible     — only the same website or name: often another location.
 * Nothing is merged here; the person chooses what to do.
 */
async function findMatches(ctx, facts, { transaction = null } = {}) {
  // eslint-disable-next-line global-require
  const intake = require('./leadIntakeService');
  const out = [];
  const listing = await sameListing(ctx, facts.googlePlaceId, transaction);
  if (listing) out.push({ ...(await describeExisting(ctx, listing.id, transaction)), confidence: 'same_listing', reasons: ['the same Google listing'] });

  const businesses = await intake.agencyBusinesses(ctx.agencyId);
  const phones = (facts.phones || []).map(phoneKey).filter(Boolean);
  const emails = (facts.emails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
  const domain = intake.siteDomain(facts.website);
  const nk = nameKey(facts.name);
  const city = cityKey(facts.city);
  const found = [];
  for (const b of businesses) {
    if (out.some((m) => m.organizationId === b.id)) continue; // eslint-disable-line no-continue
    const strong = [];
    const possible = [];
    if (phones.length && b.phones.some((p) => phones.includes(phoneKey(p)))) strong.push('the same phone number');
    if (emails.length && b.emails.some((e) => emails.includes(e))) strong.push('the same email address');
    if (nk && nameKey(b.name) === nk) {
      const theirs = cityKey(b.city);
      if (city && theirs === city) strong.push('the same name in the same town');
      else if (!city || !theirs) possible.push('the same name');
    }
    if (domain && b.websites.some((w) => intake.siteDomain(w) === domain)) possible.push('the same website — it could be another location');
    if (strong.length || possible.length) found.push({ business: b, reasons: [...strong, ...possible], confidence: strong.length ? 'strong' : 'possible' });
  }
  found.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'strong' ? -1 : 1));
  for (const f of found.slice(0, 5)) {
    const opp = await Opportunity.findOne({
      where: { agencyOrganizationId: ctx.agencyId, organizationId: f.business.id, deletedAt: null },
      order: [['archivedAt', 'DESC NULLS FIRST'], ['createdAt', 'DESC']],
      attributes: ['id'],
      ...(transaction ? { transaction } : {}),
    });
    if (opp) out.push({ ...(await describeExisting(ctx, opp.id, transaction)), confidence: f.confidence, reasons: f.reasons });
    else {
      out.push({
        opportunityId: null,
        organizationId: f.business.id,
        name: f.business.name,
        location: [f.business.city, f.business.state].filter(Boolean).join(', ') || null,
        isClient: f.business.type === 'client',
        doNotContact: false,
        label: f.business.type === 'client' ? LIFECYCLE_LABELS.client : 'In Leadzaro without an open lead',
        mergeable: false,
        mode: null,
        reason: f.business.type === 'client' ? 'it’s already a client, so it won’t go into new outreach.' : 'it has no open lead to add research to.',
        canOpen: false,
        confidence: f.confidence,
        reasons: f.reasons,
      });
    }
  }
  return out;
}

/** The early check while qualifying: is this business already in Leadzaro? */
async function checkExisting(ctx, input = {}) {
  const ld = input.leadData || {};
  const matches = await findMatches(ctx, {
    googlePlaceId: text(ld.googlePlaceId, 255) || null,
    name: text(ld.name, 255),
    city: text(ld.city, 100),
    website: text(ld.website, 500) || null,
    phones: [ld.phone, ...(Array.isArray(input.phones) ? input.phones : [])].map((p) => text(p, 50)).filter(Boolean).slice(0, 10),
    emails: (Array.isArray(input.emails) ? input.emails : []).map((e) => text(e, 255)).filter(Boolean).slice(0, 10),
  });
  return { matches };
}

async function presentReview(ctx, review) {
  if (!review) return null;
  const users = await User.findAll({ where: { id: [review.requestedBy, review.assigneeUserId].filter(Boolean) }, attributes: USER_ATTRS });
  const byId = (id) => users.find((u) => u.id === id) || null;
  const matches = [];
  for (const m of review.matches || []) {
    if (!m.opportunityId) { matches.push(m); continue; } // eslint-disable-line no-continue
    try { matches.push({ ...(await describeExisting(ctx, m.opportunityId)), confidence: m.confidence, reasons: m.reasons }); } catch { /* removed since */ }
  }
  return {
    requestedBy: byId(review.requestedBy), requestedAt: review.requestedAt, note: review.note || null, assignee: byId(review.assigneeUserId), intended: review.intended, matches,
  };
}

/** A retry of a submission that already went through finds the lead it made. */
async function findSubmission(ctx, key, transaction = null) {
  if (!key) return null;
  const [rows] = await sequelize.query(
    `SELECT id FROM "Opportunities" WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL
      AND "research" -> 'submissionKeys' @> jsonb_build_array(CAST(:key AS text)) LIMIT 1`,
    { replacements: { agencyId: ctx.agencyId, key }, ...(transaction ? { transaction } : {}) },
  );
  return rows[0]?.id || null;
}

function withSubmissionKey(research, key) {
  if (!key) return research;
  return { ...research, submissionKeys: [...(research.submissionKeys || []).filter((k) => k !== key).slice(-9), key] };
}

/**
 * Creates (or adds to) a lead only once its qualification is complete, or
 * when the qualifier deliberately parks it as needing more information or
 * not suitable. Everything is checked first and written in one
 * transaction; a retry with the same submissionKey returns the first
 * result. Possible duplicates are reported before anything is written.
 */
async function createQualified(ctx, input) {
  const park = input.park && PARK_STATUSES[input.park.status] && input.park.status !== 'draft' ? input.park : null;
  const parkNote = park ? text(park.note, 500) : '';
  if (park && !parkNote) throw fieldInvalid('park.note', 'Add a short note so the next person knows why.');
  if (park) assertNoSecrets(parkNote, 'Note');
  const data = normalizeSubmission(input, { parking: Boolean(park), forgiving: park?.status === 'unsuitable' });
  data.step = 5;
  const assigneeUserId = !park && input.assigneeUserId ? String(input.assigneeUserId) : null;
  if (assigneeUserId && !(await memberHas(ctx.agencyId, assigneeUserId, 'outreach.send'))) {
    throw fieldInvalid('assigneeUserId', 'Choose someone on the sales team.');
  }
  const submissionKey = /^[A-Za-z0-9-]{8,100}$/.test(String(input.submissionKey || '')) ? String(input.submissionKey) : null;
  const keepSeparate = Boolean(input.keepSeparate);
  const reviewNote = text(input.reviewNote, 500) || null;

  const repeat = await findSubmission(ctx, submissionKey);
  if (repeat) return { ...(await getQualification(ctx, repeat)), alreadyComplete: true };

  const facts = {
    googlePlaceId: data.leadData?.googlePlaceId || null,
    name: data.business?.name,
    city: data.business?.city,
    website: data.sources?.website?.url || data.leadData?.website || null,
    phones: (data.phone?.values || []).map((p) => p.value),
    emails: (data.email?.values || []).map((e) => e.value),
  };
  const lockKey = `qualify:${ctx.agencyId}:${facts.googlePlaceId || nameKey(facts.name) || submissionKey || 'manual'}`;
  let result = null;
  try {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: lockKey }, transaction });
      const again = await findSubmission(ctx, submissionKey, transaction);
      if (again) { result = { id: again, repeat: true }; return; }

      if (input.mergeIntoOpportunityId) {
        result = await mergeInto(ctx, String(input.mergeIntoOpportunityId), data, {
          park, parkNote, assigneeUserId, submissionKey, transaction,
        });
        return;
      }
      const listing = await sameListing(ctx, facts.googlePlaceId, transaction);
      if (listing) {
        const existing = await describeExisting(ctx, listing.id, transaction);
        throw invalid(existing.mergeable
          ? `${existing.name} is already in Leadzaro (${existing.label}${existing.assignedTo ? ` · ${existing.assignedTo.name}` : ''}). Add your research to it — nothing you entered is lost.`
          : `${existing.name} is already in Leadzaro — ${existing.reason}`, 409, { existing, matches: [{ ...existing, confidence: 'same_listing', reasons: ['the same Google listing'] }] });
      }
      const matches = await findMatches(ctx, facts, { transaction });
      const strong = matches.filter((m) => m.confidence !== 'possible');
      // "It's a different business" settles a weak match; a strong one needs a manager's check.
      if (!keepSeparate && matches.length && (!input.confirmNew || (strong.length && !isManager(ctx)))) {
        throw invalid(strong.length
          ? 'This looks like a business already in Leadzaro. Add your research to it, or save it separately for a manager to check.'
          : 'This may be a business already in Leadzaro. Check the matches before adding it.', 409, {
          possibleDuplicates: matches, matches, code: strong.length ? 'strong_match' : 'possible_match',
        });
      }
      result = await createNew(ctx, data, {
        park,
        parkNote,
        assigneeUserId,
        submissionKey,
        transaction,
        review: keepSeparate && matches.length ? {
          matches: matches.map((m) => ({
            opportunityId: m.opportunityId, organizationId: m.organizationId, name: m.name, confidence: m.confidence, reasons: m.reasons,
          })),
          requestedBy: ctx.userId,
          requestedAt: new Date().toISOString(),
          note: reviewNote,
          assigneeUserId,
          intended: park ? park.status : 'qualified',
          parkNote: parkNote || null,
        } : null,
        confirmedSeparate: input.confirmNew && !keepSeparate && matches.length ? matches.map((m) => ({ opportunityId: m.opportunityId, name: m.name, reasons: m.reasons })) : null,
      });
    });
  } catch (err) {
    // Two identical submissions racing past the lock check: the second finds the first.
    if (isUniqueViolation(err) && submissionKey) {
      const first = await findSubmission(ctx, submissionKey);
      if (first) return { ...(await getQualification(ctx, first)), alreadyComplete: true };
    }
    throw err;
  }
  if (result.repeat) return { ...(await getQualification(ctx, result.id)), alreadyComplete: true };

  const name = data.business?.name;
  if (result.kind === 'completed') {
    await afterCompletion(ctx, result.id, {
      assigneeUserId: result.assigneeUserId,
      name,
      reason: data.reason?.text,
      firstCompletion: result.firstCompletion,
      action: result.merged ? 'qualification.merged' : 'qualification.completed',
      metadata: result.merged ? { mode: 'qualify' } : {},
    });
  } else if (result.kind === 'updated') {
    if (result.ownerId && result.ownerId !== ctx.userId) {
      await notify({
        userId: result.ownerId,
        organizationId: ctx.agencyId,
        type: 'qualification_update',
        title: `New research on ${result.name || name}`,
        body: `${ctx.user?.name || 'A qualifier'} added research to your lead. Nothing about its stage changed.`,
        data: { opportunityId: result.id, link: `/app/work/${result.id}` },
      }).catch(() => null);
    }
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.research_added', targetType: 'Opportunity', targetId: result.id, req: ctx.req,
    });
  } else {
    await recordAudit({
      organizationId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: result.kind === 'review' ? 'qualification.review_requested' : 'qualification.status_changed',
      targetType: 'Opportunity',
      targetId: result.id,
      metadata: { status: result.status, merged: Boolean(result.merged) },
      req: ctx.req,
    });
  }
  await clearClaims(ctx, [facts.googlePlaceId, input.draftKey]);
  return { ...(await getQualification(ctx, result.id)), outcome: result.kind, mode: result.mode || null };
}

async function clearClaims(ctx, keys) {
  const list = keys.map((k) => text(k, 255)).filter(Boolean);
  if (list.length) await ResearchClaim.destroy({ where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: list } });
}

async function createNew(ctx, data, {
  park, parkNote, assigneeUserId, submissionKey, review, confirmedSeparate, transaction,
}) {
  // eslint-disable-next-line global-require
  const opportunityService = require('../crm/opportunityService');
  const leadData = data.leadData;
  const { opportunity, organization } = await opportunityService.createFromLead({
    agencyOrganizationId: ctx.agencyId, leadData, actorUserId: ctx.userId, transaction, leaveUnassigned: true,
  });
  const orgUpdates = {};
  if (leadData.source === 'manual') {
    orgUpdates.detailsSource = Object.fromEntries(Object.keys(organization.detailsSource || {}).map((k) => [k, 'manual']));
  }
  // An email check run from the search results is kept with the business (its candidates and pages), never applied silently.
  const cached = leadData.googlePlaceId ? contactDiscovery.cachedForPlace(leadData.googlePlaceId) : null;
  if (cached) orgUpdates.emailDiscovery = { ...cached, trigger: 'search', checkedBy: ctx.userId };
  if (Object.keys(orgUpdates).length) await organization.update(orgUpdates, { transaction });

  let research = withSubmissionKey(initialResearch(leadData), submissionKey);
  if (confirmedSeparate?.length) research.duplicateCheck = { matches: confirmedSeparate, confirmedSeparateBy: ctx.userId, at: new Date().toISOString() };
  await opportunity.update({
    qualificationStatus: 'draft', researcherUserId: ctx.userId, assignedToUserId: null, research,
  }, { transaction });
  await applyResearch(ctx, {
    opportunity, organization, data, additive: false, transaction,
  });
  research = opportunity.research;

  if (review) {
    // Saved and flagged, not lost: out of every sales queue, and no credit, until a manager decides.
    await opportunity.update({
      qualificationStatus: 'needs_review', qualificationNote: review.note || 'Possible duplicate — waiting for a manager to check', research: { ...research, review: { ...review, submission: data } },
    }, { transaction });
    return { id: opportunity.id, kind: 'review', status: 'needs_review' };
  }
  if (park) {
    await opportunity.update({ qualificationStatus: park.status, qualificationNote: parkNote }, { transaction });
    return { id: opportunity.id, kind: 'parked', status: park.status };
  }
  const done = await finishQualification(ctx, opportunity, { assigneeUserId, transaction });
  return {
    id: opportunity.id, kind: 'completed', assigneeUserId: done.assigneeUserId, firstCompletion: done.firstCompletion,
  };
}

/**
 * Adds research to a lead that already exists. The lead keeps its owner,
 * stage, notes, contacts and history; nothing is cleared or overwritten.
 * A lead that was never qualified is qualified by it (one credit, kept
 * with its owner); one already qualified or with sales just gets the
 * research, with no change of status and no new credit.
 */
async function mergeInto(ctx, opportunityId, data, {
  park, parkNote, assigneeUserId, submissionKey, transaction,
}) {
  const target = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null }, transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!target) throw invalid('That lead no longer exists. Go back and check again.', 404);
  const info = await describeExisting(ctx, target.id, transaction);
  if (!info.mergeable) throw invalid(`${info.name}: ${info.reason}`, 409, { existing: info });
  if (park && info.mode !== 'qualify') throw invalid('It’s already a lead with sales — your research can be added to it, but it can’t be parked from here.', 409, { existing: info });
  const organization = await Organization.findByPk(target.organizationId, { transaction, lock: transaction.LOCK.UPDATE });
  await applyResearch(ctx, {
    opportunity: target, organization, data, additive: true, transaction,
  });
  await target.update({ research: withSubmissionKey(target.research || {}, submissionKey) }, { transaction });

  if (info.mode === 'update') return {
    id: target.id, kind: 'updated', mode: 'update', merged: true, ownerId: target.assignedToUserId, name: info.name,
  };
  // Research that someone parked (or never qualified) is taken over by whoever completes it.
  if (target.researcherUserId !== ctx.userId && ['needs_research', 'unsuitable', null].includes(target.qualificationStatus)) {
    await target.update({
      researcherUserId: ctx.userId,
      research: { ...(target.research || {}), previousResearcherUserId: target.researcherUserId || null, previousStatus: target.qualificationStatus },
    }, { transaction });
  }
  if (park) {
    await target.update({ qualificationStatus: park.status, qualificationNote: parkNote }, { transaction });
    return {
      id: target.id, kind: 'parked', status: park.status, merged: true, mode: 'qualify',
    };
  }
  const owner = target.assignedToUserId && await memberHas(ctx.agencyId, target.assignedToUserId, 'outreach.send') ? target.assignedToUserId : null;
  const assignee = owner || assigneeUserId;
  // A lead sales already has (but nobody owns) needs someone named; parking it as "ready" would hide it.
  if (!assignee && target.qualificationStatus === null) throw fieldInvalid('assigneeUserId', 'Choose who should work this lead.');
  const done = await finishQualification(ctx, target, {
    assigneeUserId: assignee, qualifierUserId: ctx.userId, creditNote: 'Research added to a lead that was already in Leadzaro', transaction,
  });
  return {
    id: target.id, kind: 'completed', mode: 'qualify', merged: true, assigneeUserId: done.assigneeUserId, firstCompletion: done.firstCompletion,
  };
}

/**
 * A manager settles a possible duplicate saved for review:
 *   separate — it's a different business: the research goes ahead as the qualifier intended;
 *   merge    — it's the same business: the research is added to that lead and this record is retired;
 *   dismiss  — neither is needed: this record is retired.
 */
async function resolveReview(ctx, opportunityId, { action, targetOpportunityId, note } = {}) {
  if (!isManager(ctx)) throw invalid('Only a manager can settle a possible duplicate.', 403);
  if (!['separate', 'merge', 'dismiss'].includes(action)) throw invalid('Choose what to do with it.');
  const textNote = text(note, 500) || null;
  if (textNote) assertNoSecrets(textNote, 'Note');
  let result = null;
  let researcherUserId = null;
  let name = null;
  await sequelize.transaction(async (transaction) => {
    const record = await Opportunity.findOne({
      where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null }, transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!record) throw invalid('Lead not found', 404);
    if (record.qualificationStatus !== 'needs_review') throw invalid('This has already been settled.', 409);
    researcherUserId = record.researcherUserId;
    const review = record.research?.review || {};
    const organization = await Organization.findByPk(record.organizationId, { transaction });
    name = organization?.name;
    const resolution = {
      action, by: ctx.userId, at: new Date().toISOString(), note: textNote, targetOpportunityId: action === 'merge' ? targetOpportunityId : null,
    };
    const qualifierCtx = { ...ctx, userId: researcherUserId || ctx.userId };
    if (action === 'separate') {
      await record.update({ research: { ...record.research, review: { ...review, resolution } }, qualificationNote: null }, { transaction });
      if (review.intended && review.intended !== 'qualified') {
        await record.update({ qualificationStatus: review.intended, qualificationNote: review.parkNote || textNote || 'Checked — not a duplicate' }, { transaction });
        result = { id: record.id, kind: 'parked' };
      } else {
        const assignee = review.assigneeUserId && await memberHas(ctx.agencyId, review.assigneeUserId, 'outreach.send') ? review.assigneeUserId : null;
        const done = await finishQualification(qualifierCtx, record, { assigneeUserId: assignee, qualifierUserId: researcherUserId, transaction });
        result = { id: record.id, kind: 'completed', assigneeUserId: done.assigneeUserId };
      }
      return;
    }
    if (action === 'merge') {
      if (!targetOpportunityId || targetOpportunityId === record.id) throw fieldInvalid('targetOpportunityId', 'Choose the lead it duplicates.');
      const data = review.submission || {};
      const merged = await mergeInto(qualifierCtx, String(targetOpportunityId), data, {
        park: null, parkNote: null, assigneeUserId: review.assigneeUserId || null, submissionKey: null, transaction,
      });
      result = { id: merged.id, kind: merged.kind, assigneeUserId: merged.assigneeUserId };
    }
    // Merged or dismissed: this record is retired (kept, archived, never deleted).
    await record.update({
      archivedAt: new Date(),
      mergedIntoOpportunityId: action === 'merge' ? result.id : null,
      qualificationNote: action === 'merge' ? 'Merged into the existing lead after a duplicate check' : (textNote || 'Dismissed after a duplicate check'),
      research: { ...record.research, review: { ...review, resolution } },
    }, { transaction });
    if (organization && organization.type === 'prospect') {
      const others = await Opportunity.count({ where: { organizationId: organization.id, deletedAt: null, archivedAt: null }, transaction });
      if (!others) await organization.update({ deletedAt: new Date() }, { transaction });
    }
    if (!result) result = { id: record.id, kind: 'dismissed' };
  });
  if (researcherUserId && researcherUserId !== ctx.userId) {
    const words = { separate: 'is a separate business — your research went ahead', merge: 'was the same business — your research was added to the existing lead', dismiss: 'was a duplicate — the extra record was removed' };
    await notify({
      userId: researcherUserId,
      organizationId: ctx.agencyId,
      type: 'qualification_review',
      title: `${name || 'A business'} ${words[action]}`,
      body: textNote ? `${ctx.user?.name || 'A manager'}: ${textNote}` : `Checked by ${ctx.user?.name || 'a manager'}.`,
      data: { opportunityId: result.id, link: `/app/qualify/${result.id}` },
    }).catch(() => null);
  }
  if (result.kind === 'completed' && result.assigneeUserId) {
    await afterCompletion(ctx, result.id, {
      assigneeUserId: result.assigneeUserId, name, reason: null, firstCompletion: true, action: 'qualification.review_resolved', metadata: { resolution: action },
    });
  } else {
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.review_resolved', targetType: 'Opportunity', targetId: opportunityId, metadata: { resolution: action, targetOpportunityId: result.id }, req: ctx.req,
    });
  }
  return { resolved: action, opportunityId: result.id };
}

/** Possible duplicates waiting for a manager, for My Work. */
async function reviewQueue(ctx) {
  const rows = await Opportunity.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, qualificationStatus: 'needs_review',
    },
    include: [
      { model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state'] },
      { model: User, as: 'researcher', attributes: USER_ATTRS },
    ],
    order: [['updatedAt', 'ASC']],
    limit: 30,
  });
  return rows.map((o) => ({ ...card(o), matches: (o.research?.review?.matches || []).map((m) => m.name).filter(Boolean) }));
}

// ---- Claims and saved progress

/** Marks a listing as being researched by the caller; reports who else has it, if anyone. */
async function claim(ctx, { googlePlaceId, name, takeOver = false }) {
  const placeId = String(googlePlaceId || '').slice(0, 255);
  if (!placeId) throw invalid('Missing listing id');
  const existing = await sameListing(ctx, placeId);
  if (existing) return { existing: await describeExisting(ctx, existing.id) };
  const current = await ResearchClaim.findOne({
    where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: placeId },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
  });
  const fresh = current && Date.now() - new Date(current.updatedAt).getTime() < CLAIM_TTL_MS;
  // Someone else is on it (or saved progress on it): say so, and let the caller decide whether to take it over.
  if (current && current.userId !== ctx.userId && (fresh || current.draft) && !takeOver) return { claimedBy: current.user, since: current.updatedAt, savedProgress: Boolean(current.draft) };
  if (current) {
    // Taking over someone else's listing starts from your own progress, not theirs.
    await current.update({
      userId: ctx.userId, businessName: name || current.businessName, updatedAt: new Date(), ...(current.userId !== ctx.userId ? { draft: null } : {}),
    });
  } else {
    await ResearchClaim.create({
      agencyOrganizationId: ctx.agencyId, googlePlaceId: placeId, businessName: name ? String(name).slice(0, 255) : null, userId: ctx.userId,
    }).catch(() => null);
  }
  return { claimed: true, draft: current && current.userId === ctx.userId ? current.draft : null };
}

/** Drops the caller's claim and any progress saved with it (the business was skipped). */
async function release(ctx, googlePlaceId) {
  await ResearchClaim.destroy({ where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: String(googlePlaceId || ''), userId: ctx.userId } });
  return { released: true };
}

/** Live claims for these listings, for the search results. */
async function activeClaims(agencyId, placeIds) {
  if (!placeIds.length) return [];
  return ResearchClaim.findAll({
    where: { agencyOrganizationId: agencyId, googlePlaceId: placeIds, updatedAt: { [Op.gt]: new Date(Date.now() - CLAIM_TTL_MS) } },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
  });
}

function draftKey(value) {
  const key = String(value || '').trim();
  if (!/^[\w:.-]{3,255}$/.test(key)) throw invalid('Saved research not found', 404);
  return key;
}

/**
 * Saves qualification progress on the server (ADR 0017), so research can
 * be resumed from My Work, on another computer, or after a refresh. Saved
 * progress is not a lead and never appears in any sales view.
 */
async function saveDraft(ctx, key, { start, draft, takeOver = false } = {}) {
  const id = draftKey(key);
  const body = JSON.stringify(draft || null);
  if (body.length > 60000 || JSON.stringify(start || null).length > 10000) throw invalid('That’s too much to save at once.', 413);
  const current = await ResearchClaim.findOne({
    where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: id },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
  });
  const fresh = current && Date.now() - new Date(current.updatedAt).getTime() < CLAIM_TTL_MS;
  if (current && current.userId !== ctx.userId && (fresh || current.draft) && !takeOver) return { saved: false, claimedBy: current.user, since: current.updatedAt };
  const values = {
    userId: ctx.userId,
    businessName: text(start?.name || draft?.business?.name, 255) || current?.businessName || null,
    start: start || current?.start || null,
    draft: draft || null,
  };
  if (current) {
    current.set(values);
    current.changed('draft', true);
    await current.save();
    return { saved: true, savedAt: current.updatedAt };
  }
  try {
    const created = await ResearchClaim.create({ agencyOrganizationId: ctx.agencyId, googlePlaceId: id, ...values });
    return { saved: true, savedAt: created.updatedAt };
  } catch (err) {
    if (isUniqueViolation(err)) return saveDraft(ctx, key, { start, draft, takeOver });
    throw err;
  }
}

async function getDraft(ctx, key) {
  const row = await ResearchClaim.findOne({ where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: draftKey(key), userId: ctx.userId } });
  if (!row || (!row.draft && !row.start)) throw invalid('Saved research not found', 404);
  return {
    key: row.googlePlaceId, start: row.start, draft: row.draft, savedAt: row.updatedAt,
  };
}

/** The caller's research in progress (saved, not yet decided), newest first. */
async function myDrafts(ctx) {
  const rows = await ResearchClaim.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, userId: ctx.userId, draft: { [Op.ne]: null }, updatedAt: { [Op.gt]: new Date(Date.now() - DRAFT_TTL_MS) },
    },
    order: [['updatedAt', 'DESC']],
    limit: 30,
  });
  return rows.map((r) => ({
    key: r.googlePlaceId,
    businessName: r.businessName || r.start?.name || 'Business',
    city: r.start?.city || r.draft?.business?.city || null,
    step: Number(r.draft?.step) || 1,
    updatedAt: r.updatedAt,
  }));
}

module.exports = {
  createQualified,
  checkExisting,
  resolveReview,
  reviewQueue,
  claim,
  release,
  setup,
  activeClaims,
  saveDraft,
  getDraft,
  myDrafts,
  startDraft,
  getQualification,
  saveResearch,
  complete,
  setStatus,
  returnForCorrection,
  myResearch,
  isManager,
  normalizeSubmission,
  REASON_OPTIONS,
};
