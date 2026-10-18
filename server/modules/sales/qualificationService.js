'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Lead, Contact, User, WorkCredit, ResearchClaim,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const { QUALIFICATION_LABELS, IN_QUALIFICATION, STAGE_LABELS } = require('../../core/crm/pipelineCatalog');
const contactDiscovery = require('./contactDiscoveryService');
const { membersWith, memberHas } = require('./teamMembers');
const {
  invalid, isEmail, assertNoSecrets, phoneKey,
} = require('./salesCommon');

/**
 * Guided lead qualification (ADR 0016): choose a business, check and save
 * its links, collect contact details, record one specific reason to reach
 * out, then assign it to a salesperson. Saving a business only creates a
 * research draft; completing it is what puts the lead in a sales queue and
 * earns the qualifier one (reviewable) credit.
 */

const SOURCE_KEYS = ['google', 'website', 'facebook'];
const SOURCE_LABELS = { google: 'Google listing', website: 'Website', facebook: 'Facebook page' };
const SOURCE_STATUSES = ['not_checked', 'found', 'not_found', 'unable'];
const CONTACT_KEYS = ['email', 'phone', 'owner'];
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

/**
 * Several emails, phones and people per business. Accepts the list form
 * ({ values: [...] } / { people: [...] }) or the older single-value form.
 */
function contactLists(contacts = {}) {
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const emails = (Array.isArray(contacts.email?.values) ? contacts.email.values : (contacts.email?.value ? [{ value: contacts.email.value, sourceUrl: contacts.email.sourceUrl }] : []))
    .map((e) => ({ value: text(e.value, 255), sourceUrl: e.sourceUrl || null })).filter((e) => e.value);
  const phones = (Array.isArray(contacts.phone?.values) ? contacts.phone.values : (contacts.phone?.value ? [{ value: contacts.phone.value, sourceUrl: contacts.phone.sourceUrl }] : []))
    .map((p) => ({ value: text(p.value, 50), label: p.label ? text(p.label, 60) : null, sourceUrl: p.sourceUrl || null })).filter((p) => p.value);
  const people = (Array.isArray(contacts.owner?.people) ? contacts.owner.people : (contacts.owner?.name ? [{ name: contacts.owner.name, title: contacts.owner.title, sourceUrl: contacts.owner.sourceUrl }] : []))
    .map((p) => ({ name: text(p.name, 255), title: p.title ? text(p.title, 150) : null, sourceUrl: p.sourceUrl || null })).filter((p) => p.name);
  return { emails, phones, people };
}

function cleanSocials(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const item of list.slice(0, 12)) {
    const raw = String(item?.url || '').trim();
    if (!raw) continue;
    const platform = SOCIAL_PLATFORMS[item.platform] ? item.platform : 'other';
    const url = cleanUrl(raw, 'social');
    if (!out.some((s) => s.url === url)) out.push({ platform, url });
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
  for (const person of people) {
    assertNoSecrets(person.name, 'Contact name');
    if (!has('name', person.name)) await add({ name: person.name, title: person.title });
  }
}

function isManager(ctx) {
  return ctx.can('leads.assign') || ctx.can('team.review_work');
}

function cleanUrl(value, key) {
  let url = String(value || '').trim();
  if (!url) return null;
  if (url.length > 500) throw invalid(`${SOURCE_LABELS[key] || 'Link'}: that link is too long.`);
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}/i.test(url)) throw invalid(`${SOURCE_LABELS[key] || 'Link'}: that doesn’t look like a web address.`);
  if (SEARCH_URL.test(url)) throw invalid(`${SOURCE_LABELS[key] || 'Link'}: that’s a search results page. Open the business’s own page and copy its address instead.`);
  if (key === 'google' && !GOOGLE_LISTING_URL.test(url)) throw invalid('Google listing: paste the link to their Google Maps / Business Profile page.');
  if (key === 'facebook') {
    const normalized = contactDiscovery.normalizeFacebookUrl(url);
    if (!normalized) throw invalid('Facebook page: paste the link to the business’s own Facebook page.');
    return normalized;
  }
  return url;
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
      email: { status: 'not_checked', sourceUrl: null },
      phone: { status: status(leadData.phone), sourceUrl: leadData.phone && leadData.googleMapsUrl ? leadData.googleMapsUrl : null, from: leadData.phone ? 'search' : null },
      owner: { status: 'not_checked', contactId: null, sourceUrl: null },
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

  const q = {
    opportunityId: opportunity.id,
    status: opportunity.qualificationStatus,
    statusLabel: opportunity.qualificationStatus ? QUALIFICATION_LABELS[opportunity.qualificationStatus] : 'Not qualified in Leadzaro',
    inProgress: IN_QUALIFICATION.includes(opportunity.qualificationStatus),
    note: opportunity.qualificationNote,
    step: research.step || 1,
    stage: opportunity.stage,
    stageLabel: STAGE_LABELS[opportunity.stage],
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
        sourceUrl: organization.email ? (savedContacts.email?.sourceUrl || discovery.emailSourceUrl || null) : null,
        from: organization.email ? (discovery.emailSource || 'manual') : null,
        values: [organization.email, ...others.map((c) => c.email)].filter((v, i, all) => v && all.indexOf(v) === i).map((value) => ({ value })),
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
        sourceUrl: savedContacts.owner?.sourceUrl || null,
        people: others.filter((c) => c.name && c.name !== c.email && c.name !== c.phone && !(c.phone && c.name === c.phone)).map((c) => ({ name: c.name, title: c.title })),
      },
    },
    socials: organization.socialLinks || [],
    emailDiscovery: discovery,
    reason: {
      tags: Array.isArray(research.reasonTags) ? research.reasonTags : [],
      text: opportunity.outreachReason || '',
      evidence: opportunity.outreachEvidence || '',
    },
    researcher,
    qualifiedBy,
    qualifiedAt: opportunity.qualifiedAt,
    assignedTo,
    credit: credit ? {
      status: credit.status, reviewNote: credit.reviewNote, correctionCount: credit.correctionCount, lastCorrectionReason: credit.lastCorrectionReason,
    } : null,
    canEdit: canEdit(ctx, opportunity),
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
  };
}

function assertEditable(ctx, opportunity) {
  if (!canEdit(ctx, opportunity)) throw invalid('Only the person researching this lead (or a manager) can change it.', 403);
}

async function setOwnerContact(ctx, organization, research, owner) {
  const name = String(owner.name || '').trim().slice(0, 255);
  const title = owner.title ? String(owner.title).trim().slice(0, 150) : null;
  if (!name) throw invalid('Contact name: enter the name you found, or mark it “Not found”.');
  assertNoSecrets(name, 'Contact name');
  const existingId = research.contacts?.owner?.contactId;
  let contact = existingId ? await Contact.findOne({ where: { id: existingId, organizationId: organization.id, deletedAt: null } }) : null;
  if (contact) {
    await contact.update({ name, title });
  } else {
    const count = await Contact.count({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null } });
    contact = await Contact.create({
      organizationId: organization.id, agencyOrganizationId: ctx.agencyId, name, title, source: 'manual', isPrimary: count === 0,
    });
  }
  return contact.id;
}

/**
 * Saves whatever part of the research was sent (one step at a time, or
 * several). Every value is checked; nothing is inferred or invented.
 */
async function saveResearch(ctx, opportunityId, input) {
  const opportunity = await load(ctx, opportunityId);
  assertEditable(ctx, opportunity);
  if (opportunity.qualificationStatus === 'assigned' && !isManager(ctx)) {
    throw invalid('This lead is already with sales. Ask them to return it if something needs correcting.', 409);
  }
  const organization = await Organization.findByPk(opportunity.organizationId);
  const research = JSON.parse(JSON.stringify(opportunity.research || {}));
  research.sources = research.sources || {};
  research.contacts = research.contacts || {};
  const org = {};
  const detailsSource = { ...(organization.detailsSource || {}) };

  if (input.business) {
    const b = input.business;
    const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;
    if (b.name !== undefined) {
      org.name = text(b.name, 255);
      if (!org.name) throw invalid('Business name is required.');
    }
    for (const [field, max] of [['addressLine1', 255], ['city', 100], ['state', 100], ['postalCode', 20], ['category', 150]]) {
      if (b[field] !== undefined) org[field] = text(b[field], max);
    }
  }

  const keep = Boolean(input.keepExisting);
  const socials = cleanSocials(input.socials);
  if (socials) org.socialLinks = socials;
  for (const key of SOURCE_KEYS) {
    const s = input.sources?.[key];
    if (!s) continue;
    if (!SOURCE_STATUSES.includes(s.status)) throw invalid(`${SOURCE_LABELS[key]}: choose what you found.`);
    const url = s.status === 'found' ? cleanUrl(s.url, key) : null;
    if (s.status === 'found' && !url) throw invalid(`${SOURCE_LABELS[key]}: paste the link you found, or choose another status.`);
    research.sources[key] = {
      status: s.status, url, note: s.note ? String(s.note).trim().slice(0, 300) : null, checkedAt: new Date().toISOString(), checkedBy: ctx.userId,
    };
    if (key === 'website') {
      if (url) { org.website = url; detailsSource.website = 'manual'; } else if (s.status === 'not_found' && !keep) { org.website = null; delete detailsSource.website; }
    }
    if (key === 'facebook') {
      if (url) { org.facebookUrl = url; detailsSource.facebook = 'manual'; } else if (s.status === 'not_found' && !keep) { org.facebookUrl = null; delete detailsSource.facebook; }
    }
  }

  const contacts = input.contacts || {};
  const lists = contactLists(contacts);
  const extras = { emails: [], phones: [], people: [] };
  if (contacts.email) {
    const c = contacts.email;
    if (!CONTACT_STATUSES.includes(c.status)) throw invalid('Email: choose what you found.');
    if (c.status === 'found') {
      for (const e of lists.emails) if (!isEmail(e.value)) throw invalid(`Email: “${e.value}” doesn’t look valid. Copy it exactly as it appears.`);
      extras.emails = lists.emails.slice(1);
      c.sourceUrl = lists.emails[0]?.sourceUrl ?? c.sourceUrl;
      const email = String(lists.emails[0]?.value || c.value || '').trim().slice(0, 255);
      if (!isEmail(email)) throw invalid('Email: that address doesn’t look valid. Copy it exactly as it appears.');
      const sourceUrl = c.sourceUrl ? cleanUrl(c.sourceUrl, 'email') : null;
      if (email !== organization.email) {
        org.email = email;
        org.emailDiscovery = { ...contactDiscovery.discoveryAfterManualEmail(organization, email, ctx.userId), manualSourceUrl: sourceUrl };
        // Format-checked only — never labelled verified.
        detailsSource.email = 'manual';
      } else if (sourceUrl) {
        org.emailDiscovery = { ...(organization.emailDiscovery || {}), manualSourceUrl: sourceUrl };
      }
      research.contacts.email = { status: 'found', sourceUrl };
    } else {
      if (c.status === 'not_found' && organization.email && !keep) {
        org.email = null;
        org.emailDiscovery = contactDiscovery.discoveryAfterManualEmail(organization, null, ctx.userId);
        delete detailsSource.email;
      }
      research.contacts.email = { status: c.status, sourceUrl: null };
    }
  }
  if (contacts.phone) {
    const c = contacts.phone;
    if (!CONTACT_STATUSES.includes(c.status)) throw invalid('Phone: choose what you found.');
    if (c.status === 'found') {
      for (const p of lists.phones) if (!phoneKey(p.value)) throw invalid(`Phone: “${p.value}” isn’t a full number.`);
      extras.phones = lists.phones.slice(1);
      const phone = String(lists.phones[0]?.value || c.value || '').trim().slice(0, 50);
      if (!phoneKey(phone)) throw invalid('Phone: enter the full number.');
      if (phone !== organization.phone) { org.phone = phone; detailsSource.phone = 'manual'; }
      research.contacts.phone = { status: 'found', sourceUrl: c.sourceUrl ? cleanUrl(c.sourceUrl, 'phone') : null };
    } else {
      if (c.status === 'not_found' && organization.phone && !keep) { org.phone = null; delete detailsSource.phone; }
      research.contacts.phone = { status: c.status, sourceUrl: null };
    }
  }
  if (contacts.owner) {
    const c = contacts.owner;
    if (!CONTACT_STATUSES.includes(c.status)) throw invalid('Contact name: choose what you found.');
    if (c.status === 'found') {
      const [first, ...rest] = lists.people.length ? lists.people : [c];
      extras.people = rest;
      const contactId = await setOwnerContact(ctx, organization, research, first);
      research.contacts.owner = { status: 'found', contactId, sourceUrl: c.sourceUrl ? cleanUrl(c.sourceUrl, 'owner') : null };
    } else {
      research.contacts.owner = { status: c.status, contactId: null, sourceUrl: null };
    }
  }

  const opp = {};
  if (input.reason) {
    const tags = (Array.isArray(input.reason.tags) ? input.reason.tags : []).filter((t) => REASON_KEYS.has(t)).slice(0, 7);
    const text = String(input.reason.text ?? '').trim();
    if (text.length > 1000) throw invalid('Keep the reason short — under 1,000 characters.');
    assertNoSecrets(text, 'Reason to reach out');
    research.reasonTags = tags;
    opp.outreachReason = text || null;
  }
  if (Number.isInteger(input.step) && input.step >= 1 && input.step <= 5) research.step = Math.max(input.step, 1);

  research.updatedAt = new Date().toISOString();
  research.updatedBy = ctx.userId;
  await sequelize.transaction(async (transaction) => {
    if (Object.keys(org).length) await organization.update({ ...org, detailsSource }, { transaction });
    await opportunity.update({ ...opp, research }, { transaction });
    if (extras.emails.length || extras.phones.length || extras.people.length) await addExtraContacts(ctx, await organization.reload({ transaction }), extras, transaction);
  });
  return getQualification(ctx, opportunityId);
}

/** What the qualifier checked, written out so a reason like “no website found” keeps its scope. */
function evidenceFor(q) {
  const parts = SOURCE_KEYS.map((key) => {
    const s = q.sources[key];
    const state = { found: 'found', not_found: 'not found', unable: 'could not be opened', not_checked: 'not checked' }[s.status];
    return `${SOURCE_LABELS[key]}: ${state}${s.status === 'found' && s.url ? ` (${s.url})` : ''}`;
  });
  return `Checked by the qualifier on ${new Date().toISOString().slice(0, 10)} — ${parts.join('; ')}.`;
}

/**
 * Completes the qualification: assigns it to a salesperson (or marks it
 * ready for assignment). Safe to click twice — the second click returns
 * the same result, and the qualifier's credit is created exactly once.
 */
async function complete(ctx, opportunityId, { assigneeUserId = null } = {}) {
  const pre = await load(ctx, opportunityId);
  assertEditable(ctx, pre);
  if (assigneeUserId && !(await memberHas(ctx.agencyId, assigneeUserId, 'outreach.send'))) {
    throw invalid('Choose someone on the sales team.', 422);
  }
  const q = await present(ctx, pre);
  if (pre.qualificationStatus === 'assigned') {
    if (!assigneeUserId || pre.assignedToUserId === assigneeUserId) return { ...(await getQualification(ctx, opportunityId)), alreadyComplete: true };
    throw invalid('This lead is already assigned to sales. A manager can reassign it from the lead page.', 409);
  }
  if (!['draft', 'needs_research', 'needs_correction', 'ready'].includes(pre.qualificationStatus)) {
    throw invalid('This lead isn’t in qualification.', 409);
  }
  if (q.missing.length) {
    throw invalid(`Still needed: ${q.missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 422, { missing: q.missing });
  }
  if (!q.hasUsableContact) {
    throw invalid('Sales needs at least one usable email or phone number. Save it as “Needs more information” or “Not suitable” instead.', 422, { code: 'no_contact' });
  }

  const now = new Date();
  let firstCompletion = false;
  let changed = false;
  await sequelize.transaction(async (transaction) => {
    const opportunity = await load(ctx, opportunityId, { transaction, lock: true });
    // A second click (or a concurrent one) finds the work already done.
    if (opportunity.qualificationStatus === 'assigned' || (!assigneeUserId && opportunity.qualificationStatus === 'ready')) return;
    changed = true;
    firstCompletion = !opportunity.qualifiedAt;
    const qualifier = opportunity.qualifiedByUserId || opportunity.researcherUserId || ctx.userId;
    await opportunity.update({
      qualificationStatus: assigneeUserId ? 'assigned' : 'ready',
      qualifiedAt: opportunity.qualifiedAt || now,
      qualifiedByUserId: qualifier,
      qualificationNote: null,
      outreachEvidence: evidenceFor(q),
      assignedToUserId: assigneeUserId || opportunity.assignedToUserId || null,
      research: { ...(opportunity.research || {}), step: 5 },
    }, { transaction });
    const [credit, created] = await WorkCredit.findOrCreate({
      where: { opportunityId: opportunity.id, kind: 'qualification' },
      defaults: {
        agencyOrganizationId: ctx.agencyId, userId: qualifier, status: 'pending', earnedAt: now,
      },
      transaction,
    });
    // Resubmitted after a correction: back into the review queue, same credit.
    if (!created && credit.status === 'needs_correction') await credit.update({ status: 'pending' }, { transaction });
  });

  if (!changed) return { ...(await getQualification(ctx, opportunityId)), alreadyComplete: true };
  if (assigneeUserId && assigneeUserId !== ctx.userId) {
    await notify({
      userId: assigneeUserId,
      organizationId: ctx.agencyId,
      type: 'lead_assignment',
      title: `${q.business.name} is ready for you`,
      body: `${ctx.user?.name || 'A qualifier'} researched this lead and assigned it to you. Reason: ${q.reason.text}`,
      data: { opportunityId, link: `/app/work/${opportunityId}` },
    }).catch(() => null);
  }
  await recordAudit({
    organizationId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: 'qualification.completed',
    targetType: 'Opportunity',
    targetId: opportunityId,
    metadata: { assigneeUserId, firstCompletion },
    req: ctx.req,
  });
  return getQualification(ctx, opportunityId);
}

const PARK_STATUSES = { needs_research: 'Needs more information', unsuitable: 'Not suitable', draft: 'Back to research' };

/** Parks research as needing more information or unsuitable (with a reason), or reopens it. */
async function setStatus(ctx, opportunityId, { status, note }) {
  const opportunity = await load(ctx, opportunityId);
  assertEditable(ctx, opportunity);
  if (!PARK_STATUSES[status]) throw invalid('Unknown status');
  if (opportunity.qualificationStatus === 'assigned' && !isManager(ctx)) throw invalid('This lead is already with sales.', 409);
  const text = String(note || '').trim().slice(0, 500);
  if (status !== 'draft' && !text) throw invalid('Add a short note so the next person knows why.');
  assertNoSecrets(text, 'Note');
  await opportunity.update({ qualificationStatus: status, qualificationNote: text || null });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.status_changed', targetType: 'Opportunity', targetId: opportunityId, metadata: { status }, req: ctx.req,
  });
  return getQualification(ctx, opportunityId);
}

/**
 * Sales (or a manager) sends a lead back to its qualifier, e.g. for wrong
 * contact details. It leaves the sales queues until it's completed again;
 * the qualifier's credit records the correction.
 */
async function returnForCorrection(ctx, opportunityId, { reason }) {
  const text = String(reason || '').trim().slice(0, 500);
  if (!text) throw invalid('Say what needs correcting.');
  assertNoSecrets(text, 'Reason');
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  if (!opportunity.researcherUserId) throw invalid('This lead wasn’t qualified in Leadzaro, so there’s no qualifier to return it to. Fix the details on the lead instead.', 409);
  if (opportunity.assignedToUserId && opportunity.assignedToUserId !== ctx.userId && !isManager(ctx)) {
    throw invalid('Only the lead’s salesperson or a manager can return it.', 403);
  }
  if (['won', 'lost'].includes(opportunity.stage)) throw invalid('This deal is closed.', 409);
  await sequelize.transaction(async (transaction) => {
    await opportunity.update({ qualificationStatus: 'needs_correction', qualificationNote: text }, { transaction });
    const credit = await WorkCredit.findOne({ where: { opportunityId, kind: 'qualification' }, transaction, lock: transaction.LOCK.UPDATE });
    if (credit) {
      await credit.update({
        correctionCount: credit.correctionCount + 1,
        lastCorrectionReason: text,
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
    body: `${ctx.user?.name || 'Sales'}: ${text}`,
    data: { opportunityId, link: `/app/qualify/${opportunityId}` },
  }).catch(() => null);
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.returned', targetType: 'Opportunity', targetId: opportunityId, metadata: { reason: text }, req: ctx.req,
  });
  return { returned: true };
}

/** A qualifier's own research, grouped for My Work. Managers see every qualifier's ready leads. */
async function myResearch(ctx) {
  const include = [
    { model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state', 'email', 'phone'] },
    { model: User, as: 'researcher', attributes: USER_ATTRS },
    { model: User, as: 'assignedTo', attributes: USER_ATTRS },
  ];
  const mine = await Opportunity.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, researcherUserId: ctx.userId, qualificationStatus: IN_QUALIFICATION,
    },
    include,
    order: [['updatedAt', 'DESC']],
    limit: 100,
  });
  const readyAll = isManager(ctx) ? await Opportunity.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, qualificationStatus: 'ready', researcherUserId: { [Op.ne]: ctx.userId },
    },
    include,
    order: [['qualifiedAt', 'ASC']],
    limit: 50,
  }) : [];
  const card = (o) => ({
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
  });
  return {
    inProgress: mine.filter((o) => ['draft', 'needs_research'].includes(o.qualificationStatus)).map(card),
    corrections: mine.filter((o) => o.qualificationStatus === 'needs_correction').map(card),
    ready: [...mine.filter((o) => o.qualificationStatus === 'ready'), ...readyAll].map(card),
  };
}

// ---- Qualifying a search result without saving it first (ADR 0016 revision)

const CLAIM_TTL_MS = 12 * 3600 * 1000;

/** Assignees and reason picks for a qualification that isn't saved yet. */
async function setup(ctx) {
  return { assignees: await membersWith(ctx.agencyId, 'outreach.send'), reasonOptions: REASON_OPTIONS };
}

/**
 * Checks a finished qualification before anything is written: every link
 * and contact checked, values in the right form, one reason, and — unless
 * it's being parked — at least one usable email or phone. Throws with the
 * list of what's missing.
 */
function checkResearch(input, { parking = false } = {}) {
  const missing = [];
  const leadData = input.leadData || {};
  if (!String(leadData.name || '').trim()) missing.push({ step: 1, key: 'name', label: 'Business name' });
  if (!String(leadData.city || '').trim() && !String(leadData.address || '').trim()) missing.push({ step: 1, key: 'location', label: 'Town or address' });
  const sources = input.sources || {};
  for (const key of SOURCE_KEYS) {
    const s = sources[key] || { status: 'not_checked' };
    if (!SOURCE_STATUSES.includes(s.status)) throw invalid(`${SOURCE_LABELS[key]}: choose what you found.`);
    if (s.status === 'not_checked') missing.push({ step: 2, key: `source_${key}`, label: `Check their ${SOURCE_LABELS[key]}` });
    if (s.status === 'found' && !cleanUrl(s.url, key)) throw invalid(`${SOURCE_LABELS[key]}: paste the link you found, or choose another status.`);
  }
  const contacts = input.contacts || {};
  for (const key of ['email', 'phone']) {
    const c = contacts[key] || { status: 'not_checked' };
    if (!CONTACT_STATUSES.includes(c.status)) throw invalid(`${key === 'email' ? 'Email' : 'Phone'}: choose what you found.`);
    if (c.status === 'not_checked') missing.push({ step: 3, key, label: key === 'email' ? 'Check for an email' : 'Check for a phone number' });
  }
  const lists = contactLists(contacts);
  if (contacts.email?.status === 'found') {
    if (!lists.emails.length) throw invalid('Email: enter the address you found, or mark it “Not found”.');
    for (const e of lists.emails) if (!isEmail(e.value)) throw invalid(`Email: “${e.value}” doesn’t look valid. Copy it exactly as it appears.`);
  }
  if (contacts.phone?.status === 'found') {
    if (!lists.phones.length) throw invalid('Phone: enter the number you found, or mark it “Not found”.');
    for (const p of lists.phones) if (!phoneKey(p.value)) throw invalid(`Phone: “${p.value}” isn’t a full number.`);
  }
  if (contacts.owner?.status === 'found' && !lists.people.length) throw invalid('Contact name: enter the name you found, or mark it “Not found”.');
  cleanSocials(input.socials);
  const reason = String(input.reason?.text || '').trim();
  if (reason.length > 1000) throw invalid('Keep the reason short — under 1,000 characters.');
  assertNoSecrets(reason, 'Reason to reach out');
  if (!reason && !parking) missing.push({ step: 4, key: 'reason', label: 'Reason to reach out' });
  if (!parking && missing.length) throw invalid(`Still needed: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.`, 422, { missing });
  const usable = contacts.email?.status === 'found' || contacts.phone?.status === 'found';
  if (!parking && !usable) {
    throw invalid('Sales needs at least one usable email or phone. Save it as “Needs more information” or “Not suitable” instead.', 422, { code: 'no_contact' });
  }
}

/**
 * Creates the lead only once its qualification is complete (or when the
 * qualifier deliberately parks it as needing more information or not
 * suitable). Duplicates are reported before anything is written.
 */
async function createQualified(ctx, input) {
  const park = input.park && PARK_STATUSES[input.park.status] && input.park.status !== 'draft' ? input.park : null;
  if (park && !String(park.note || '').trim()) throw invalid('Add a short note so the next person knows why.');
  checkResearch(input, { parking: Boolean(park) });
  if (!park && input.assigneeUserId && !(await memberHas(ctx.agencyId, input.assigneeUserId, 'outreach.send'))) {
    throw invalid('Choose someone on the sales team.', 422);
  }
  // eslint-disable-next-line global-require
  const intake = require('./leadIntakeService');
  const merging = Boolean(input.mergeIntoOpportunityId);
  let id;
  let assigneeUserId = input.assigneeUserId || null;
  if (merging) {
    if (park) throw invalid('It’s already a lead in Leadzaro — leave it with sales rather than marking it here.', 409);
    const target = await prepareMerge(ctx, input.mergeIntoOpportunityId);
    id = target.id;
    // The lead keeps its salesperson; the research is added for them.
    if (target.ownerId && await memberHas(ctx.agencyId, target.ownerId, 'outreach.send')) assigneeUserId = target.ownerId;
  } else {
    try {
      id = (await intake.createLead(ctx, { leadData: input.leadData, confirmNew: Boolean(input.confirmNew), qualify: true })).opportunityId;
    } catch (err) {
      if (err.existingOpportunityId) {
        const existing = await describeExisting(ctx, err.existingOpportunityId);
        err.existing = existing;
        err.message = existing.mergeable
          ? `${existing.name} is already in Leadzaro (${existing.label}${existing.assignedTo ? ` · ${existing.assignedTo.name}` : ''}). You can add your research to it.`
          : `${existing.name} is already in Leadzaro — ${existing.reason}`;
      }
      throw err;
    }
  }
  const contacts = Object.fromEntries(Object.entries(input.contacts || {}).filter(([, c]) => c && c.status && c.status !== 'not_checked'));
  await saveResearch(ctx, id, {
    sources: input.sources, contacts, socials: input.socials, reason: input.reason, step: 5, keepExisting: merging,
  });
  if (merging && !assigneeUserId) throw invalid('Choose who should work this lead.', 422);
  const result = park ? await setStatus(ctx, id, park) : await complete(ctx, id, { assigneeUserId });
  if (merging) {
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'qualification.merged', targetType: 'Opportunity', targetId: id, req: ctx.req,
    });
  }
  const placeId = input.leadData?.googlePlaceId;
  if (placeId) await ResearchClaim.destroy({ where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: placeId } });
  return result;
}

/** What a teammate needs to know about a lead that already exists, and whether research can be added to it. */
async function describeExisting(ctx, opportunityId) {
  const o = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null },
    include: [
      { model: Organization, as: 'organization', attributes: ['name', 'type'] },
      { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      { model: User, as: 'researcher', attributes: USER_ATTRS },
      { model: User, as: 'qualifiedBy', attributes: USER_ATTRS },
    ],
  });
  if (!o) throw invalid('Lead not found', 404);
  let reason = null;
  if (o.organization?.type === 'client' || o.stage === 'won') reason = 'it’s already a client, so there’s nothing to qualify.';
  else if (o.doNotContact) reason = 'it’s marked do not contact.';
  else if (o.stage === 'lost') reason = 'it was closed as lost. Reopen it from the lead first.';
  else if (o.qualificationStatus === 'assigned' && o.qualifiedByUserId) reason = `${o.qualifiedBy?.name || 'someone'} already qualified it.`;
  else if (IN_QUALIFICATION.includes(o.qualificationStatus) && o.researcherUserId && o.researcherUserId !== ctx.userId) reason = `${o.researcher?.name || 'someone'} is researching it.`;
  else if (o.qualificationStatus === 'unsuitable') reason = 'it was marked not relevant.';
  return {
    opportunityId: o.id,
    name: o.organization?.name,
    qualificationStatus: o.qualificationStatus,
    label: o.qualificationStatus ? QUALIFICATION_LABELS[o.qualificationStatus] : STAGE_LABELS[o.stage],
    assignedTo: o.assignedTo,
    researcher: o.researcher,
    mergeable: !reason,
    reason,
  };
}

/** Readies an existing lead to take a qualifier's research: same lead, same owner, nothing duplicated. */
async function prepareMerge(ctx, opportunityId) {
  const existing = await describeExisting(ctx, opportunityId);
  if (!existing.mergeable) throw invalid(`${existing.name}: ${existing.reason}`, 409, { existing });
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  await opportunity.update({ researcherUserId: opportunity.researcherUserId || ctx.userId, qualificationStatus: 'draft' });
  return { id: opportunity.id, ownerId: opportunity.assignedToUserId };
}

/** Marks a listing as being researched by the caller; reports who else has it, if anyone. */
async function claim(ctx, { googlePlaceId, name, takeOver = false }) {
  const placeId = String(googlePlaceId || '').slice(0, 255);
  if (!placeId) throw invalid('Missing listing id');
  const lead = await Lead.findOne({ where: { googlePlaceId: placeId }, attributes: ['id'] });
  if (lead) {
    const existing = await Opportunity.findOne({
      where: {
        agencyOrganizationId: ctx.agencyId, sourceLeadId: lead.id, deletedAt: null, archivedAt: null,
      },
      include: [{ model: User, as: 'researcher', attributes: USER_ATTRS }, { model: User, as: 'assignedTo', attributes: USER_ATTRS }],
    });
    if (existing) return { existing: await describeExisting(ctx, existing.id) };
  }
  const current = await ResearchClaim.findOne({
    where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: placeId },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
  });
  const fresh = current && Date.now() - new Date(current.updatedAt).getTime() < CLAIM_TTL_MS;
  // Someone else is on it: say so, and let the caller decide whether to take it over.
  if (fresh && current.userId !== ctx.userId && !takeOver) return { claimedBy: current.user, since: current.updatedAt };
  if (current) await current.update({ userId: ctx.userId, businessName: name || current.businessName, updatedAt: new Date() });
  else {
    await ResearchClaim.create({
      agencyOrganizationId: ctx.agencyId, googlePlaceId: placeId, businessName: name ? String(name).slice(0, 255) : null, userId: ctx.userId,
    }).catch(() => null);
  }
  return { claimed: true };
}

/** Drops the caller's claim (the panel was closed without finishing). */
async function release(ctx, googlePlaceId) {
  await ResearchClaim.destroy({ where: { agencyOrganizationId: ctx.agencyId, googlePlaceId: String(googlePlaceId || ''), userId: ctx.userId } });
  return { released: true };
}

/** Live claims for these listings, for the search results. */
async function activeClaims(agencyId, placeIds) {
  if (!placeIds.length) return [];
  const { Op } = require('sequelize'); // eslint-disable-line global-require
  return ResearchClaim.findAll({
    where: { agencyOrganizationId: agencyId, googlePlaceId: placeIds, updatedAt: { [Op.gt]: new Date(Date.now() - CLAIM_TTL_MS) } },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS }],
  });
}

module.exports = {
  createQualified,
  claim,
  release,
  setup,
  activeClaims,
  startDraft,
  getQualification,
  saveResearch,
  complete,
  setStatus,
  returnForCorrection,
  myResearch,
  isManager,
  REASON_OPTIONS,
};
