'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, OutreachActivity, User, Contact,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { invalid, assertNoSecrets } = require('./salesCommon');
const contactDiscovery = require('./contactDiscoveryService');
const emailSources = require('./emailSources');

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

/**
 * What each quick-pick reason can mean for sales (ADR 0017). `why` is a
 * general point — not something checked for this business — and is shown
 * as such. `opener` turns what the qualifier recorded into a first line
 * for the customer, in plain first-person wording that claims no more than
 * was observed. `ask` is an open question for a call.
 */
const TAG_BRIEFS = {
  no_website: {
    label: 'No website found',
    why: 'People who look them up online have nowhere to go beyond the listing.',
    opener: (name) => `When I looked ${name} up online, I couldn’t find a website for the business.`,
    ask: 'How do new customers usually find you right now?',
  },
  broken_links: {
    label: 'Broken links',
    why: 'Links that don’t work tend to make visitors give up.',
    opener: () => 'I was looking at your website and noticed a few links that don’t seem to work.',
    ask: 'Is anyone looking after the website for you at the moment?',
  },
  outdated_info: {
    label: 'Outdated information',
    why: 'Out-of-date details (hours, services, prices) can cost calls and visits.',
    opener: () => 'I noticed some of the information on your website looks like it might be out of date.',
    ask: 'Is it easy for you to update the website yourselves?',
  },
  mobile_navigation: {
    label: 'Hard to use on mobile',
    why: 'Many people look businesses up on a phone; a site that’s hard to use there can lose them.',
    opener: () => 'I looked at your website on my phone and found it a little hard to get around.',
    ask: 'Do many customers find you from their phones?',
  },
  no_contact_action: {
    label: 'No clear contact or booking',
    why: 'Visitors who can’t quickly call, book or send a message often move on.',
    opener: () => 'I couldn’t find an easy way to get in touch or book through your website.',
    ask: 'How do most customers book with you today?',
  },
  relies_on_facebook: {
    label: 'Relies mainly on Facebook',
    why: 'A Facebook page on its own is harder to find on Google, and isn’t fully theirs to control.',
    opener: (name) => `It looks like Facebook is the main place people find ${name} online.`,
    ask: 'Has Facebook been working well for bringing in new customers?',
  },
};

function openerFor(opportunity, organization) {
  const tags = (opportunity.research?.reasonTags || []).filter((t) => TAG_BRIEFS[t]);
  if (tags.length) return { text: tags.slice(0, 2).map((t) => TAG_BRIEFS[t].opener(organization.name)).join(' '), fromNote: false };
  if (opportunity.outreachReason) return { text: sentence(opportunity.outreachReason), fromNote: true };
  return { text: null, fromNote: false };
}

/**
 * The sales handoff (ADR 0017): what the qualifier observed, why it may
 * matter, the supporting links, who researched it and when, the original
 * reason and later additions — plus a first line for an email and a short
 * call talking point built only from those facts. Missing is said plainly.
 */
async function briefingFor(ctx, opportunity, organization) {
  const research = opportunity.research || {};
  const tags = (research.reasonTags || []).filter((t) => TAG_BRIEFS[t]);
  const ids = new Set([opportunity.qualifiedByUserId, opportunity.researcherUserId, research.reasonBy?.userId, research.reasonOriginal?.by]
    .concat((research.reasonAdditions || []).map((a) => a.by), (research.reasonHistory || []).map((h) => h.replacedBy)).filter(Boolean));
  const users = ids.size ? await User.findAll({ where: { id: [...ids] }, attributes: ['id', 'name'] }) : [];
  const who = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? { id: u.id, name: u.name } : null;
  };
  const opener = openerFor(opportunity, organization);
  const links = [];
  if (organization.website) links.push({ label: 'Website', url: organization.website });
  if (organization.facebookUrl) links.push({ label: 'Facebook', url: organization.facebookUrl });
  const google = research.sources?.google?.url;
  if (google) links.push({ label: 'Google listing', url: google });
  const context = research.reasonContext || null;
  const contextLink = context && /^https?:\/\/\S+$/i.test(context.trim()) ? context.trim() : null;
  const original = research.reasonOriginal && research.reasonOriginal.text !== opportunity.outreachReason ? {
    text: research.reasonOriginal.text, by: who(research.reasonOriginal.by), at: research.reasonOriginal.at,
  } : null;
  const observed = opportunity.outreachReason || null;
  const firstAsk = tags.length ? TAG_BRIEFS[tags[0]].ask : 'How do customers usually find you today?';
  return {
    observed,
    missing: !observed,
    tags: tags.map((t) => ({ key: t, label: TAG_BRIEFS[t].label })),
    relevance: tags.map((t) => TAG_BRIEFS[t].why),
    context: contextLink ? null : context,
    contextLink,
    evidence: opportunity.outreachEvidence || null,
    links,
    researchedBy: who(opportunity.qualifiedByUserId) || who(opportunity.researcherUserId),
    researchedAt: opportunity.qualifiedAt || research.updatedAt || null,
    editedBy: research.reasonBy?.userId && research.reasonBy.userId !== (opportunity.qualifiedByUserId || opportunity.researcherUserId) ? who(research.reasonBy.userId) : null,
    editedAt: research.reasonBy?.at || null,
    original,
    additions: (research.reasonAdditions || []).slice(-5).map((a) => ({ text: a.text, context: a.context || null, by: who(a.by), at: a.at })),
    emailSource: organization.email ? emailSources.sourceFor(organization, organization.email) : null,
    emailOpener: opener.text,
    openerFromNote: opener.fromNote,
    talkingPoint: observed ? {
      opening: opener.text,
      ask: firstAsk,
      reminder: 'Say what you saw, then ask — don’t tell them what’s wrong with their business or promise results.',
    } : null,
  };
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

/**
 * Edits the reason to reach out. The qualifier's original is kept (and
 * every earlier version, with who replaced it), so an edit never erases
 * the research it came from.
 */
async function updateReason(ctx, opportunityId, input) {
  const { opportunity } = await load(ctx, opportunityId);
  const reason = String(input.reason ?? '').trim();
  const evidence = input.evidence === undefined ? opportunity.outreachEvidence || '' : String(input.evidence ?? '').trim();
  if (reason.length > 1000) throw invalid('Keep the reason under 1,000 characters.', 422, { field: 'reason' });
  if (evidence.length > 2000) throw invalid('Keep the supporting notes under 2,000 characters.', 422, { field: 'evidence' });
  assertNoSecrets(reason, 'Reason for outreach');
  assertNoSecrets(evidence, 'Supporting notes');
  const previous = String(opportunity.outreachReason || '').trim();
  const research = { ...(opportunity.research || {}) };
  const now = new Date().toISOString();
  if (previous && previous !== reason) {
    if (!research.reasonOriginal) research.reasonOriginal = { text: previous, tags: research.reasonTags || [], by: research.reasonBy?.userId || opportunity.qualifiedByUserId || opportunity.researcherUserId || null, at: research.reasonBy?.at || opportunity.qualifiedAt || null };
    research.reasonHistory = [...(research.reasonHistory || []), {
      text: previous, by: research.reasonBy?.userId || null, at: research.reasonBy?.at || null, replacedBy: ctx.userId, replacedAt: now,
    }].slice(-20);
  }
  if (previous !== reason) research.reasonBy = { userId: ctx.userId, at: now };
  await opportunity.update({ outreachReason: reason || null, outreachEvidence: evidence || null, research });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.outreach_reason_updated', targetType: 'Opportunity', targetId: opportunity.id, req: ctx.req,
  });
  return { outreachReason: opportunity.outreachReason, outreachEvidence: opportunity.outreachEvidence };
}

/** Adds context to the reason (e.g. what sales learned on a call), attributed, without changing the original. */
async function addReasonNote(ctx, opportunityId, input) {
  const { opportunity } = await load(ctx, opportunityId);
  const textNote = String(input.text ?? '').trim();
  if (!textNote) throw invalid('Write what you’d like to add.', 422, { field: 'text' });
  if (textNote.length > 500) throw invalid('Keep it under 500 characters.', 422, { field: 'text' });
  assertNoSecrets(textNote, 'Note');
  const research = { ...(opportunity.research || {}) };
  research.reasonAdditions = [...(research.reasonAdditions || []), { text: textNote, by: ctx.userId, at: new Date().toISOString() }].slice(-20);
  await opportunity.update({ research });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.outreach_reason_note_added', targetType: 'Opportunity', targetId: opportunity.id, req: ctx.req,
  });
  return { added: true };
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
  if (opportunity.doNotContact) throw invalid('This business is marked do not contact, so no email is drafted.', 409, { code: 'do_not_contact' });
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
  const opening = openerFor(opportunity, organization);
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
    opener = opening.text || reason;
    evidence.push({ label: 'Reason for outreach', value: opportunity.outreachReason, source: opportunity.outreachEvidence || 'Entered by an employee' });
    // The qualifier's note, word for word, was written for the team — say so, so it gets reworded.
    if (opening.fromNote) warnings.push('The opening line is the qualifier’s note word for word. Reword it for the customer before sending.');
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
  observations, previousEmails, outreachContext, updateReason, addReasonNote, draftIntro, saveDraft, briefingFor, openerFor, TAG_BRIEFS,
};
