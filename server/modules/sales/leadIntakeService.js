'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Lead, Contact, User, SavedLead,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const opportunityService = require('../crm/opportunityService');
const { STAGE_LABELS } = require('../../core/crm/pipelineCatalog');
const {
  invalid, phoneKey, registrableDomain, FREE_EMAIL_DOMAINS, isEmail, nameKey,
} = require('./salesCommon');

/**
 * Getting businesses into Leads (ADR 0011). Duplicates are caught on
 * reliable identifiers only: the Google listing id is an exact match;
 * the same phone number, website domain or business email is a possible
 * match that a person reviews — nothing is merged automatically.
 */

// Social and site-builder hosts many unrelated businesses share — a
// matching "website" on one of these proves nothing.
const SHARED_HOSTS = new Set([
  'facebook.com', 'fb.com', 'instagram.com', 'google.com', 'goo.gl', 'business.site', 'yelp.com', 'linktr.ee', 'wixsite.com',
  'squarespace.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'blogspot.com', 'square.site', 'tiktok.com', 'x.com',
  'twitter.com', 'linkedin.com', 'nextdoor.com', 'angi.com', 'homeadvisor.com', 'thumbtack.com', 'bbb.org', 'yellowpages.com', 'mapquest.com',
]);

function siteDomain(value) {
  const domain = registrableDomain(value);
  return domain && !SHARED_HOSTS.has(domain) ? domain : null;
}

/**
 * Every business the agency already has — leads and clients — with every
 * identifier a duplicate could match on. A client's website often lives
 * on its client profile and its phone and email on its contacts, so those
 * count too (ADR 0013).
 */
async function agencyBusinesses(agencyId) {
  const organizations = await Organization.findAll({
    where: { managingAgencyOrganizationId: agencyId, deletedAt: null, type: ['prospect', 'client'] },
    attributes: ['id', 'name', 'type', 'phone', 'email', 'website'],
  });
  if (!organizations.length) return [];
  // ClientProfile is visibility-guarded; this raw read is pinned to the agency.
  const [profiles] = await sequelize.query(
    'SELECT "organizationId", "websiteUrl" FROM "ClientProfiles" WHERE "agencyOrganizationId" = :agencyId AND "websiteUrl" IS NOT NULL',
    { replacements: { agencyId } },
  );
  const contacts = await Contact.findAll({
    where: {
      agencyOrganizationId: agencyId, organizationId: organizations.map((o) => o.id), archivedAt: null, deletedAt: null,
    },
    attributes: ['organizationId', 'email', 'phone'],
  });
  const extra = new Map();
  const bucket = (id) => {
    if (!extra.has(id)) extra.set(id, { phones: [], emails: [], websites: [] });
    return extra.get(id);
  };
  for (const p of profiles) bucket(p.organizationId).websites.push(p.websiteUrl);
  for (const c of contacts) {
    if (c.phone) bucket(c.organizationId).phones.push(c.phone);
    if (c.email) bucket(c.organizationId).emails.push(c.email);
  }
  return organizations.map((o) => {
    const more = extra.get(o.id) || { phones: [], emails: [], websites: [] };
    return {
      id: o.id,
      name: o.name,
      type: o.type,
      phones: [o.phone, ...more.phones].filter(Boolean),
      emails: [o.email, ...more.emails].filter(Boolean).map((e) => e.toLowerCase()),
      websites: [o.website, ...more.websites].filter(Boolean),
    };
  });
}

function matchReasons(business, {
  phone, website, email, name,
}) {
  const reasons = [];
  const pk = phoneKey(phone);
  if (pk && business.phones.some((p) => phoneKey(p) === pk)) reasons.push('same phone number');
  const domain = siteDomain(website);
  if (domain && business.websites.some((w) => siteDomain(w) === domain)) reasons.push('same website');
  const lowerEmail = email ? String(email).trim().toLowerCase() : null;
  const emailDomain = lowerEmail ? registrableDomain(lowerEmail) : null;
  if (lowerEmail && business.emails.includes(lowerEmail)) reasons.push('same email');
  else if (emailDomain && !FREE_EMAIL_DOMAINS.has(emailDomain) && business.websites.some((w) => siteDomain(w) === emailDomain)) reasons.push('email matches their website');
  const nk = nameKey(name);
  if (nk && nameKey(business.name) === nk) reasons.push('same name');
  return reasons;
}

async function opportunitiesFor(agencyId, organizationIds) {
  if (!organizationIds.length) return [];
  return Opportunity.findAll({
    where: { agencyOrganizationId: agencyId, organizationId: organizationIds, deletedAt: null },
    include: [{ model: User, as: 'assignedTo', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC']],
  });
}

async function findPossibleDuplicates(agencyId, facts) {
  const businesses = await agencyBusinesses(agencyId);
  const reasonsFor = (b) => {
    const reasons = matchReasons(b, facts);
    // A contact's own phone or email also identifies the business.
    for (const reason of matchReasons(b, { phone: facts.contactPhone, email: facts.contactEmail })) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    return reasons;
  };
  const matches = businesses
    .map((b) => ({ business: b, reasons: reasonsFor(b) }))
    .filter((m) => m.reasons.length)
    .slice(0, 5);
  const opportunities = await opportunitiesFor(agencyId, matches.map((m) => m.business.id));
  return matches.map(({ business, reasons }) => {
    const opp = opportunities.find((o) => o.organizationId === business.id && !o.archivedAt) || opportunities.find((o) => o.organizationId === business.id);
    return {
      organizationId: business.id,
      name: business.name,
      isClient: business.type === 'client',
      reasons,
      opportunityId: opp?.id || null,
      stage: opp?.stage || null,
      stageLabel: opp ? STAGE_LABELS[opp.stage] : null,
      assignedTo: opp?.assignedTo || null,
    };
  });
}

function cleanLeadData(input) {
  const text = (value, max) => (value === undefined || value === null ? null : String(value).trim().slice(0, max) || null);
  const data = {
    name: text(input.name, 255),
    phone: text(input.phone, 50),
    website: text(input.website, 500),
    address: text(input.address, 255),
    city: text(input.city, 100),
    state: text(input.state, 100),
    zip: text(input.zip, 20),
    category: text(input.category, 150),
    googleMapsUrl: text(input.googleMapsUrl, 500),
    googlePlaceId: text(input.googlePlaceId, 255),
    rating: input.rating === undefined || input.rating === null || input.rating === '' ? null : Number(input.rating),
    reviewCount: Number.isInteger(Number(input.reviewCount)) ? Number(input.reviewCount) : 0,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    source: ['google', 'demo'].includes(input.source) ? input.source : 'manual',
  };
  if (!data.name) throw invalid('Business name is required');
  if (data.website && !/^https?:\/\//i.test(data.website)) data.website = `https://${data.website}`;
  data.hasWebsite = Boolean(data.website);
  return data;
}

/**
 * Adds a business to Leads. Returns the existing lead instead when the
 * Google listing is already there; returns possible duplicates for review
 * unless the caller confirms (confirmNew) or chooses to add a new deal to
 * an existing business (existingOrganizationId).
 */
async function createLead(ctx, input) {
  const leadData = cleanLeadData(input.leadData || {});
  const email = input.email ? String(input.email).trim().slice(0, 255) : null;
  if (email && !isEmail(email)) throw invalid('That email address does not look valid.');

  if (input.existingOrganizationId) {
    const organization = await Organization.findOne({ where: { id: input.existingOrganizationId, managingAgencyOrganizationId: ctx.agencyId, deletedAt: null } });
    if (!organization) throw invalid('Business not found', 404);
    const created = await Opportunity.create({
      organizationId: organization.id,
      agencyOrganizationId: ctx.agencyId,
      sourceLeadId: null,
      stage: 'new',
      title: input.title ? String(input.title).trim().slice(0, 200) : null,
      assignedToUserId: ctx.userId,
      createdByUserId: ctx.userId,
      stageChangedAt: new Date(),
    });
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.created', targetType: 'Opportunity', targetId: created.id, metadata: { existingOrganizationId: organization.id }, req: ctx.req,
    });
    return { opportunityId: created.id, created: true };
  }

  if (leadData.googlePlaceId) {
    const lead = await Lead.findOne({ where: { googlePlaceId: leadData.googlePlaceId } });
    if (lead) {
      const existing = await Opportunity.findOne({
        where: {
          agencyOrganizationId: ctx.agencyId, sourceLeadId: lead.id, deletedAt: null, archivedAt: null,
        },
      });
      if (existing) throw invalid('This business is already in Leads.', 409, { existingOpportunityId: existing.id });
    }
  }

  if (!input.confirmNew) {
    const possibleDuplicates = await findPossibleDuplicates(ctx.agencyId, {
      phone: leadData.phone, website: leadData.website, email, name: leadData.name, contactEmail: input.contact?.email, contactPhone: input.contact?.phone,
    });
    if (possibleDuplicates.length) {
      throw invalid('This may be a business you already have. Review the matches before adding it.', 409, { possibleDuplicates });
    }
  }

  const { opportunity, organization } = await opportunityService.createFromLead({
    agencyOrganizationId: ctx.agencyId,
    leadData,
    assignedToUserId: input.assignToMe === false ? null : ctx.userId,
    actorUserId: ctx.userId,
  });

  const orgUpdates = {};
  if (email) {
    orgUpdates.email = email;
    orgUpdates.detailsSource = { ...(organization.detailsSource || {}), email: 'manual' };
  }
  if (leadData.source === 'manual') {
    orgUpdates.detailsSource = Object.fromEntries(Object.keys({ ...(orgUpdates.detailsSource || organization.detailsSource || {}) }).map((k) => [k, 'manual']));
  }
  if (Object.keys(orgUpdates).length) await organization.update(orgUpdates);
  if (input.title) await opportunity.update({ title: String(input.title).trim().slice(0, 200) });

  const contact = input.contact || {};
  if (contact.name) {
    const contactEmail = contact.email ? String(contact.email).trim() : null;
    if (contactEmail && !isEmail(contactEmail)) throw invalid('The contact’s email address does not look valid.');
    await Contact.create({
      organizationId: organization.id,
      agencyOrganizationId: ctx.agencyId,
      name: String(contact.name).trim().slice(0, 255),
      title: contact.title ? String(contact.title).trim().slice(0, 150) : null,
      email: contactEmail,
      phone: contact.phone ? String(contact.phone).trim().slice(0, 50) : null,
      source: 'manual',
      isPrimary: true,
    });
  }

  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.created', targetType: 'Opportunity', targetId: opportunity.id, metadata: { source: leadData.source }, req: ctx.req,
  });
  return { opportunityId: opportunity.id, created: true };
}

/**
 * Pipeline status for search results: already a lead (and whose), an
 * existing client, or a possible match on phone/website.
 */
async function annotateSearchResults(agencyId, items) {
  const placeIds = items.map((i) => i.googlePlaceId || i.id).filter(Boolean);
  const leads = placeIds.length ? await Lead.findAll({ where: { googlePlaceId: placeIds }, attributes: ['id', 'googlePlaceId'] }) : [];
  const opportunities = leads.length ? await Opportunity.findAll({
    where: { agencyOrganizationId: agencyId, sourceLeadId: leads.map((l) => l.id), deletedAt: null },
    include: [{ model: User, as: 'assignedTo', attributes: ['id', 'name'] }, { model: Organization, as: 'organization', attributes: ['id', 'type'] }],
    order: [['archivedAt', 'DESC NULLS FIRST'], ['createdAt', 'DESC']],
  }) : [];
  const businesses = await agencyBusinesses(agencyId);

  return items.map((item) => {
    const lead = leads.find((l) => l.googlePlaceId === (item.googlePlaceId || item.id));
    const opp = lead ? opportunities.find((o) => o.sourceLeadId === lead.id) : null;
    let pipeline = null;
    if (opp) {
      pipeline = {
        opportunityId: opp.id,
        stage: opp.stage,
        stageLabel: STAGE_LABELS[opp.stage],
        assignedTo: opp.assignedTo ? { id: opp.assignedTo.id, name: opp.assignedTo.name } : null,
        isClient: opp.organization?.type === 'client',
        contacted: Boolean(opp.lastInteractionAt),
        lastInteractionAt: opp.lastInteractionAt,
        doNotContact: opp.doNotContact,
        archived: Boolean(opp.archivedAt),
      };
    }
    let possibleMatch = null;
    if (!pipeline) {
      const facts = { phone: item.phone, website: item.website, name: item.name };
      const match = businesses.find((b) => matchReasons(b, facts).length);
      if (match) possibleMatch = { organizationId: match.id, name: match.name, isClient: match.type === 'client', reasons: matchReasons(match, facts) };
    }
    return {
      ...item, isSaved: Boolean(pipeline && !pipeline.archived), pipeline, possibleMatch,
    };
  });
}

/** Old /app/leads/:savedLeadId links resolve to the matching lead. */
async function resolveSavedLead(ctx, savedLeadId) {
  const saved = await SavedLead.findOne({ where: { id: savedLeadId, organizationId: ctx.agencyId } });
  if (!saved) throw invalid('Lead not found', 404);
  const opportunity = await Opportunity.findOne({
    where: { agencyOrganizationId: ctx.agencyId, sourceLeadId: saved.leadId, deletedAt: null },
    order: [['archivedAt', 'DESC NULLS FIRST'], ['createdAt', 'DESC']],
  });
  if (!opportunity) throw invalid('Lead not found', 404);
  return { opportunityId: opportunity.id };
}

module.exports = {
  createLead, findPossibleDuplicates, annotateSearchResults, resolveSavedLead,
};
