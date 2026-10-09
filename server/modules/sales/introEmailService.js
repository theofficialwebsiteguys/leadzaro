'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, OutreachActivity, User, Contact,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { invalid, assertNoSecrets } = require('./salesCommon');
const contactDiscovery = require('./contactDiscoveryService');

/**
 * The introduction email (ADR 0014): a reason for outreach the employee
 * writes (helped by observations Leadzaro actually recorded), a draft
 * built only from facts on file, and the current unsent draft kept on the
 * deal. There is no AI provider in Leadzaro, so drafts come from this
 * template; every sentence that depends on a fact names it in `evidence`.
 * Nothing here sends anything.
 */

function day(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Factual observations that could justify reaching out, each with the
 * sentence it would become and the evidence behind it. Careful wording:
 * "not listed" is not "doesn't exist"; one failed load is not "broken".
 */
function observations(organization) {
  const research = contactDiscovery.present(organization);
  const out = [];
  const name = organization.name;
  const website = organization.website;
  const socialSite = website && contactDiscovery.isSocialUrl(website);
  const facebook = organization.facebookUrl || (socialSite && contactDiscovery.normalizeFacebookUrl(website)) || null;
  const checked = day(research.checkedAt);

  if (!website || socialSite) {
    if (facebook) {
      out.push({
        key: 'facebook_no_website',
        observation: `A Facebook page is on record, but no standalone website was found in the sources checked (their Google listing${checked ? ' and our check' : ''}). That doesn’t prove they have none.`,
        reason: `I came across ${name}’s Facebook page but couldn’t find a separate website for the business.`,
        evidence: `Facebook page: ${facebook}. Google listing website: ${socialSite ? `${website} (a social profile)` : 'none listed'}.${checked ? ` Checked ${checked}.` : ''}`,
      });
    } else {
      out.push({
        key: 'no_website_listed',
        observation: 'No website is listed on their Google profile. That doesn’t prove they have none — search for one before saying so.',
        reason: `When I looked ${name} up on Google, I couldn’t find a website listed for the business.`,
        evidence: 'Google listing showed no website when the lead was saved.',
      });
    }
  }
  const site = research.website;
  if (site?.standalone && site.reachable === false) {
    out.push({
      key: 'website_unreachable',
      observation: `${site.url} didn’t load during the check on ${day(site.checkedAt)} (${site.error}). One failed check doesn’t mean it’s down for good — open it yourself before mentioning it.`,
      reason: `When we tried to visit ${hostOf(site.url)} on ${day(site.checkedAt)}, the site didn’t load.`,
      evidence: `Automated check on ${day(site.checkedAt)}: ${site.error}.`,
    });
  }
  if (site?.standalone && site.reachable && site.secure === false) {
    out.push({
      key: 'not_https',
      observation: `${site.finalUrl} loaded without a secure (https) connection on ${day(site.checkedAt)}.`,
      reason: `I noticed ${hostOf(site.finalUrl)} loads without a secure (https) connection, so browsers show it as “Not secure.”`,
      evidence: `Loaded ${site.finalUrl} over http on ${day(site.checkedAt)}.`,
    });
  }
  return out;
}

/** Emails already sent to this business or this address by anyone on the team. */
async function previousEmails(agencyId, organizationId, email, { limit = 5 } = {}) {
  const opportunityIds = (await Opportunity.findAll({ where: { agencyOrganizationId: agencyId, organizationId }, attributes: ['id'] })).map((o) => o.id);
  const who = [];
  if (opportunityIds.length) who.push({ opportunityId: opportunityIds });
  if (email) who.push(sequelize.where(sequelize.fn('lower', sequelize.col('toAddress')), String(email).toLowerCase()));
  if (!who.length) return [];
  const rows = await OutreachActivity.findAll({
    where: {
      organizationId: agencyId,
      channel: 'email',
      direction: 'outbound',
      deletedAt: null,
      [Op.and]: [{ [Op.or]: who }, { [Op.or]: [{ status: null }, { status: { [Op.ne]: 'failed' } }] }],
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC']],
    limit,
  });
  return rows.map((a) => ({
    id: a.id, at: a.occurredAt || a.createdAt, subject: a.subject, body: a.body, to: a.toAddress, status: a.status, origin: a.origin, user: a.user ? { id: a.user.id, name: a.user.name } : null,
  }));
}

async function outreachContext(ctx, opportunity, organization) {
  return {
    observations: observations(organization),
    previousEmails: await previousEmails(ctx.agencyId, organization.id, organization.email),
  };
}

async function load(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  const organization = await Organization.findByPk(opportunity.organizationId);
  return { opportunity, organization };
}

async function updateReason(ctx, opportunityId, input) {
  const { opportunity } = await load(ctx, opportunityId);
  const reason = String(input.reason ?? '').trim();
  const evidence = String(input.evidence ?? '').trim();
  if (reason.length > 1000) throw invalid('Keep the reason under 1,000 characters.');
  if (evidence.length > 2000) throw invalid('Keep the supporting notes under 2,000 characters.');
  assertNoSecrets(reason, 'Reason for outreach');
  assertNoSecrets(evidence, 'Supporting notes');
  await opportunity.update({ outreachReason: reason || null, outreachEvidence: evidence || null });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.outreach_reason_updated', targetType: 'Opportunity', targetId: opportunity.id, req: ctx.req,
  });
  return { outreachReason: opportunity.outreachReason, outreachEvidence: opportunity.outreachEvidence };
}

function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function sentence(text) {
  const t = String(text || '').trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
}

/**
 * Builds an editable introduction from facts on file only. Returns the
 * subject, body, the evidence each part relies on, and warnings about
 * anything missing. The employee reviews, edits and presses Send.
 */
async function draftIntro(ctx, opportunityId, input = {}) {
  const { opportunity, organization } = await load(ctx, opportunityId);
  const user = await User.findByPk(ctx.userId, { attributes: ['name', 'email', 'phone', 'preferences'] });
  const contact = input.contactId
    ? await Contact.findOne({ where: { id: input.contactId, organizationId: organization.id, deletedAt: null } })
    : await Contact.findOne({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] });
  const kit = ctx.authContext?.organization?.settings?.salesKit || {};
  const monthly = (Array.isArray(kit.services) ? kit.services : []).filter((s) => s.billing === 'monthly' && Number.isInteger(s.priceCents) && s.priceCents > 0);
  const startingPlan = monthly.sort((a, b) => a.priceCents - b.priceCents)[0] || null;

  const name = organization.name;
  const myName = user?.name || '';
  const myFirst = myName.split(' ')[0] || myName;
  const company = ctx.agencyName || 'our team';
  const reason = opportunity.outreachReason ? sentence(opportunity.outreachReason) : null;
  const facts = observations(organization);
  const noWebsite = !organization.website || contactDiscovery.isSocialUrl(organization.website);
  const unreachable = facts.some((f) => f.key === 'website_unreachable');
  const evidence = [];
  const warnings = [];

  evidence.push({ label: 'Business', value: [name, organization.category].filter(Boolean).join(' · ') });
  if (organization.city || organization.state) evidence.push({ label: 'Location', value: [organization.city, organization.state].filter(Boolean).join(', ') });
  evidence.push({ label: 'Website', value: organization.website || 'None on record' });
  if (organization.facebookUrl) evidence.push({ label: 'Facebook', value: organization.facebookUrl });

  const greeting = contact?.name ? `Hi ${contact.name.split(' ')[0]},` : 'Hi there,';
  let opener;
  if (reason) {
    opener = reason;
    evidence.push({ label: 'Reason for outreach', value: opportunity.outreachReason, source: opportunity.outreachEvidence || 'Entered by an employee' });
  } else {
    opener = `I’m reaching out to a few local businesses${organization.city ? ` in ${organization.city}` : ''} about their websites.`;
    warnings.push('No reason for outreach is saved yet, so the opening is general. Add a specific, supported reason for a better email.');
  }

  let help = `I’m ${myFirst || 'writing'} with ${company}. We build websites for local businesses and then manage them — when something needs updating or fixing, a real person on our team takes care of it, so you can stay focused on running ${name}.`;
  if (!myFirst) help = `I’m with ${company}. We build websites for local businesses and then manage them — when something needs updating or fixing, a real person on our team takes care of it, so you can stay focused on running ${name}.`;
  let specific = null;
  if (noWebsite) specific = `We could set up a straightforward website for ${name} and handle the upkeep for you.`;
  else if (unreachable && reason) specific = 'If the site needs attention, we can get it back in shape and look after it from here on.';

  let price = null;
  if (startingPlan) {
    price = `Plans start at ${money(startingPlan.priceCents)}/month.`;
    evidence.push({ label: 'Price', value: `${money(startingPlan.priceCents)}/month`, source: `Sales kit: ${startingPlan.name}` });
  } else {
    warnings.push('No monthly plan is in the Sales kit (Settings → Sales kit), so the price isn’t mentioned.');
  }

  const ask = 'Would a quick 10-minute call this week be worth it to see if we’re a fit? If email is easier, just reply here.';
  const signature = String(user?.preferences?.signature || '').trim() || [myName, company, user?.phone].filter(Boolean).join('\n');
  evidence.push({ label: 'Sender', value: [myName, user?.email].filter(Boolean).join(' — ') });

  let subject = `Quick question for ${name}`;
  if (noWebsite) subject = `A website for ${name}`;
  else if (unreachable && reason) subject = `${name}’s website`;

  const body = [greeting, opener, [help, specific].filter(Boolean).join(' '), price, ask, signature].filter(Boolean).join('\n\n');
  return {
    subject: subject.slice(0, 300), body, evidence, warnings, contactId: contact?.id || null,
  };
}

async function saveDraft(ctx, opportunityId, input) {
  const { opportunity } = await load(ctx, opportunityId);
  if (input.clear) {
    await opportunity.update({ emailDraft: null });
    return { emailDraft: null };
  }
  const subject = String(input.subject || '').slice(0, 300);
  const body = String(input.body || '');
  if (!body.trim() && !subject.trim()) throw invalid('The draft is empty.');
  if (body.length > 20000) throw invalid('The draft is too long.');
  assertNoSecrets(body, 'Draft');
  const user = await User.findByPk(ctx.userId, { attributes: ['id', 'name'] });
  const emailDraft = {
    subject, body, to: String(input.to || '').slice(0, 255) || null, savedAt: new Date().toISOString(), savedBy: { id: ctx.userId, name: user?.name || null },
  };
  await opportunity.update({ emailDraft });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'outreach.draft_saved', targetType: 'Opportunity', targetId: opportunity.id, req: ctx.req,
  });
  return { emailDraft };
}

module.exports = {
  observations, previousEmails, outreachContext, updateReason, draftIntro, saveDraft,
};
