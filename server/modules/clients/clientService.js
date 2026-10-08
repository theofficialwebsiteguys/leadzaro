'use strict';

const crypto = require('node:crypto');
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const {
  sequelize, Organization, ClientProfile, BillingAccount, Subscription, ServicePlan, Contact, OrganizationMembership, User, Opportunity, SalesPayment,
} = require('../../models');
const {
  getClientOrganizationForRequester, listClientOrganizationsForRequester, listClientProfilesForRequester, findOrCreateClientProfile,
  listContactsForRequester, listProjectsForRequester, getProjectByIdForRequester, listFilesForRequester, getFileByIdForRequester,
  listClientNotesForRequester, listTasksForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { slugify } = require('../../core/crm/slugify');
const { STAGE_LABELS } = require('../../core/crm/pipelineCatalog');
const { effectiveOffset } = require('../../core/workspace/timezone');
const fileService = require('../files/fileService');
const { createProjectRecord } = require('../projects/projectService');
const domainLinkService = require('../domains/domainLinkService');
const clientHealth = require('./clientHealth');
const { UUID_PATTERN } = require('../../middleware/uuidParams');
const {
  invalid, normalizeProfileInput, normalizeProjectInput, clientName, text,
} = require('./clientFields');

const EMPTY_PROFILE = Object.fromEntries(
  Object.values(ClientProfile.EDITABLE_FIELDS).flat().map((field) => [field, ['adminLinks', 'billingLinks', 'services'].includes(field) ? [] : null]),
);

// What a client costs us and how we get into their systems are for people
// who manage projects — the same bar as a project's internal financials
// (GET /projects/:id/financials) — not everyone who can view a project.
const INTERNAL_PROFILE_FIELDS = ['internalMonthlyCostCents', 'internalCostNotes', 'accessNotes'];

const SORTS = ['name', 'attention', 'next_action', 'since', 'recent'];
const STATUSES = ['active', 'ended', 'all'];
const MAX_PAGE_SIZE = 100;

function canSeeInternals(context) {
  return Boolean(context.permissionKeys?.has('projects.manage'));
}

function withoutInternals(profile) {
  const visible = { ...profile };
  for (const field of INTERNAL_PROFILE_FIELDS) delete visible[field];
  return visible;
}

function withDetails(message, statusCode, details) {
  const err = invalid(message, statusCode);
  err.details = details;
  return err;
}

/** Today's date in the workspace (its timezone when set, else the viewer's offset). */
function todayKeyFor(context, tzOffset) {
  return clientHealth.localDateKey(effectiveOffset(context.organization?.settings?.timezone || null, tzOffset));
}

async function getClientOrThrow(context, clientId) {
  const organization = await getClientOrganizationForRequester(context, clientId);
  if (!organization) throw invalid('Client not found', 404);
  return organization;
}

async function getProfile(context, organization) {
  const [profile] = await listClientProfilesForRequester(context, [organization.id]);
  if (!profile) return { ...EMPTY_PROFILE, organizationId: organization.id };
  const json = profile.toJSON();
  // Retired columns (ADR 0009): their data now lives in the domain registry.
  for (const field of ClientProfile.LEGACY_WEBSITE_FIELDS) delete json[field];
  return json;
}

/** An image file that belongs to this client — the only thing a logo, featured image or project preview may point at. */
async function assertClientImage(context, organization, fileId) {
  if (!fileId) return;
  const file = await getFileByIdForRequester(context, fileId);
  if (!file || file.organizationId !== organization.id) throw invalid('That file doesn’t belong to this client', 422);
  if (!file.mimeType.startsWith('image/')) throw invalid('Only an image can be used here', 422);
}

/** Active employees of the agency — the people who can manage a client. */
async function listTeam(agencyId) {
  const memberships = await OrganizationMembership.findAll({
    where: {
      organizationId: agencyId, membershipType: 'employee', status: 'active', deletedAt: null,
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  return memberships.filter((m) => m.user).map((m) => ({ id: m.user.id, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function assertTeamMember(context, userId) {
  if (!userId) return;
  const team = await listTeam(context.organization.id);
  if (!team.some((member) => member.id === userId)) throw invalid('The client manager must be an active member of your team', 422);
}

async function stripeBillingFor(organizationId) {
  // BillingAccount/Subscription are not visibility-guarded; the caller
  // has already resolved organizationId through the client tenant check.
  const billingAccount = await BillingAccount.findOne({ where: { organizationId } });
  if (!billingAccount) return null;
  const subscriptions = await Subscription.findAll({
    where: { billingAccountId: billingAccount.id },
    include: [{ model: ServicePlan, as: 'servicePlan' }],
    order: [['createdAt', 'DESC']],
  });
  return { stripeCustomerId: billingAccount.stripeCustomerId, billingAccountStatus: billingAccount.status, subscriptions };
}

function stripeSummaryFor(stripe, includeInternals) {
  if (!stripe || includeInternals) return stripe;
  const { stripeCustomerId, ...rest } = stripe;
  return rest;
}

function projectSummary(project, organizationName, filesById) {
  const json = project.toJSON();
  delete json.organization;
  return {
    ...json,
    displayName: project.name || organizationName,
    previewImage: project.previewFileId ? filesById.get(project.previewFileId) || null : null,
  };
}

function imageRef(file) {
  if (!file) return null;
  return {
    id: file.id, url: file.url, thumbnailUrl: file.thumbnailUrl, mediumUrl: file.mediumUrl, originalName: file.originalName,
  };
}

function accountFields(profile) {
  return {
    services: profile?.services || [],
    scopeNotes: profile?.scopeNotes || null,
    clientSince: profile?.clientSince || null,
    clientEndedAt: profile?.clientEndedAt || null,
    endReason: profile?.endReason || null,
    acquisitionSource: profile?.acquisitionSource || null,
    waitingOn: profile?.waitingOn || null,
    waitingOnNote: profile?.waitingOnNote || null,
    waitingOnSince: profile?.waitingOnSince || null,
    nextActionAt: profile?.nextActionAt || null,
    nextActionNote: profile?.nextActionNote || null,
  };
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function sortRows(rows, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    name: byName,
    attention: (a, b) => (SEVERITY_RANK[a.health.severity] ?? 9) - (SEVERITY_RANK[b.health.severity] ?? 9)
      || b.health.reasons.length - a.health.reasons.length || byName(a, b),
    next_action: (a, b) => {
      if (!a.nextActionAt && !b.nextActionAt) return byName(a, b);
      if (!a.nextActionAt) return 1;
      if (!b.nextActionAt) return -1;
      return new Date(a.nextActionAt) - new Date(b.nextActionAt);
    },
    since: (a, b) => String(b.clientSince || '').localeCompare(String(a.clientSince || '')) || byName(a, b),
    recent: (a, b) => new Date(b.health.lastNoteAt || 0) - new Date(a.health.lastNoteAt || 0) || byName(a, b),
  };
  return rows.sort(sorters[sort] || byName);
}

function matchesSearch(row, needle, digits) {
  if (!needle) return true;
  const haystack = [
    row.name, row.websiteUrl, row.manager?.name, ...(row.services || []),
    ...row.contactsIndex.map((c) => `${c.name || ''} ${c.email || ''}`),
  ].filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes(needle)) return true;
  return Boolean(digits && digits.length >= 4 && row.contactsIndex.some((c) => String(c.phone || '').replace(/\D/g, '').includes(digits)));
}

/**
 * The Clients directory (ADR 0013). Every client with its account facts
 * and health — manager, services, who it's waiting on, next action,
 * billing, onboarding and what's missing — computed in a fixed number of
 * queries. Filters, search, sort and paging happen here so the page only
 * receives (and signs image URLs for) what it shows.
 *
 * Without `page`, returns every client (for pickers such as linking a
 * domain) in the same shape.
 */
async function listClients(context, query = {}, viewerUserId = null) {
  const organizations = await listClientOrganizationsForRequester(context);
  const paged = query.page !== undefined;
  const empty = {
    clients: [], total: 0, page: 1, pageSize: 0, counts: {}, filters: clientHealth.FILTERS, team: [],
  };
  if (organizations.length === 0) return paged ? { ...empty, team: await listTeam(context.organization.id) } : { clients: [] };
  const ids = organizations.map((organization) => organization.id);

  const [profiles, contacts, projects] = await Promise.all([
    listClientProfilesForRequester(context, ids),
    listContactsForRequester(context, { organizationId: ids }),
    listProjectsForRequester(context, { organizationId: ids }),
  ]);
  const profileJson = profiles.map((p) => p.toJSON());
  const facts = await clientHealth.loadFacts(context.organization.id, ids, { profiles: profileJson, contacts, projects });
  const managers = await clientHealth.managerNames(profileJson);
  const todayKey = todayKeyFor(context, query.tzOffset);

  const profileByOrg = new Map(profileJson.map((profile) => [profile.organizationId, profile]));
  let rows = organizations.map((organization) => {
    const profile = profileByOrg.get(organization.id) || null;
    const fact = facts.get(organization.id);
    const orgContacts = fact.contacts;
    const primary = orgContacts.find((c) => c.isPrimary) || orgContacts[0] || null;
    const orgProjects = fact.projects;
    return {
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt,
      websiteUrl: profile?.websiteUrl || orgProjects.map((p) => p.liveUrl).find(Boolean) || null,
      logo: null,
      cover: null,
      primaryContact: primary ? {
        id: primary.id, name: primary.name, email: primary.email, phone: primary.phone, title: primary.title,
      } : null,
      projects: orgProjects.map((project) => ({
        id: project.id, displayName: project.name || organization.name, projectType: project.projectType, stage: project.stage,
      })),
      manager: profile?.accountManagerUserId ? managers.get(profile.accountManagerUserId) || null : null,
      ...accountFields(profile),
      health: clientHealth.assess(fact, { todayKey }),
      contactsIndex: orgContacts,
      imageIds: { logo: profile?.logoFileId || null, featured: profile?.featuredImageFileId || null, previews: orgProjects.map((p) => p.previewFileId).filter(Boolean) },
    };
  });

  const status = STATUSES.includes(query.status) ? query.status : (paged ? 'active' : 'all');
  const inStatus = (row) => (status === 'all' ? true : status === 'ended' ? Boolean(row.clientEndedAt) : !row.clientEndedAt);
  const statusRows = rows.filter(inStatus);

  const counts = { all: statusRows.length, ended: rows.filter((row) => row.clientEndedAt).length };
  for (const key of Object.keys(clientHealth.FILTERS)) {
    counts[key] = key === 'mine'
      ? statusRows.filter((row) => row.manager?.id === viewerUserId).length
      : statusRows.filter((row) => row.health.flags.includes(key)).length;
  }

  rows = statusRows;
  const view = query.view && clientHealth.FILTERS[query.view] ? query.view : null;
  if (view === 'mine') rows = rows.filter((row) => row.manager?.id === viewerUserId);
  else if (view) rows = rows.filter((row) => row.health.flags.includes(view));
  if (query.manager === 'none') rows = rows.filter((row) => !row.manager);
  else if (query.manager) rows = rows.filter((row) => row.manager?.id === query.manager);
  const needle = String(query.q || '').trim().toLowerCase().slice(0, 100);
  const digits = needle.replace(/\D/g, '');
  rows = rows.filter((row) => matchesSearch(row, needle, digits));
  const sort = SORTS.includes(query.sort) ? query.sort : (view === 'attention' ? 'attention' : 'name');
  sortRows(rows, sort);

  const total = rows.length;
  let page = 1;
  let pageSize = total;
  if (paged) {
    pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize, 10) || 25));
    page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) page = lastPage;
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
  }

  // Signed image URLs only for the clients actually returned.
  const imageIds = new Set();
  for (const row of rows) {
    for (const id of [row.imageIds.logo, row.imageIds.featured, ...row.imageIds.previews]) if (id) imageIds.add(id);
  }
  const images = imageIds.size ? await fileService.withDisplayUrls(await listFilesForRequester(context, { id: [...imageIds] })) : [];
  const filesById = new Map(images.map((file) => [file.id, file]));
  const clients = rows.map(({ contactsIndex, imageIds: refs, ...row }) => ({
    ...row,
    logo: imageRef(filesById.get(refs.logo)),
    // Cover falls back to a project preview so a client with a website
    // screenshot on its project still gets a visual card.
    cover: imageRef(filesById.get(refs.featured) || refs.previews.map((id) => filesById.get(id)).find(Boolean) || null),
  }));

  if (!paged) return { clients };
  return {
    clients, total, page, pageSize, counts, filters: clientHealth.FILTERS, team: await listTeam(context.organization.id), status, sort,
  };
}

/** Sales history for a client: every deal for the business and the money received. */
async function salesHistoryFor(agencyId, organizationId) {
  const [opportunities, payments] = await Promise.all([
    Opportunity.findAll({
      where: { agencyOrganizationId: agencyId, organizationId, deletedAt: null },
      include: [{ model: User, as: 'assignedTo', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit: 20,
    }),
    SalesPayment.findAll({
      where: { agencyOrganizationId: agencyId, organizationId },
      attributes: ['id', 'opportunityId', 'source', 'kind', 'status', 'amountCents', 'amountRefundedCents', 'currency', 'paidAt', 'stripeMode'],
      order: [['paidAt', 'DESC']],
      limit: 50,
    }),
  ]);
  const real = payments.filter((p) => !['test', 'mock'].includes(p.stripeMode) && p.status !== 'failed');
  const collected = {};
  for (const p of real) collected[p.currency] = (collected[p.currency] || 0) + p.amountCents - (p.amountRefundedCents || 0);
  return {
    deals: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      stageLabel: STAGE_LABELS[o.stage] || o.stage,
      wonAt: o.wonAt,
      createdAt: o.createdAt,
      archived: Boolean(o.archivedAt),
      owner: o.assignedTo ? { id: o.assignedTo.id, name: o.assignedTo.name } : null,
    })),
    payments: payments.slice(0, 10).map((p) => ({
      id: p.id, opportunityId: p.opportunityId, source: p.source, kind: p.kind, status: p.status, amountCents: p.amountCents, currency: p.currency, paidAt: p.paidAt, test: ['test', 'mock'].includes(p.stripeMode),
    })),
    collected: Object.entries(collected).map(([currency, amountCents]) => ({ currency, amountCents })),
    paymentCount: real.length,
  };
}

/** Everything the client binder needs, in one response. */
async function getClientDetail(context, clientId, { tzOffset } = {}) {
  const organization = await getClientOrThrow(context, clientId);

  const [profile, contacts, projects, rawFiles, recentNotes, stripe, openTasks, team, sales] = await Promise.all([
    getProfile(context, organization),
    listContactsForRequester(context, { organizationId: organization.id }),
    listProjectsForRequester(context, { organizationId: organization.id }),
    listFilesForRequester(context, { organizationId: organization.id }),
    listClientNotesForRequester(context, { organizationId: organization.id }),
    stripeBillingFor(organization.id),
    listTasksForRequester(context, { organizationId: organization.id, status: { [Op.ne]: 'done' }, archivedAt: null }),
    listTeam(context.organization.id),
    salesHistoryFor(context.organization.id, organization.id),
  ]);

  const files = await fileService.withDisplayUrls(rawFiles);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const includeInternals = canSeeInternals(context);
  const facts = await clientHealth.loadFacts(context.organization.id, [organization.id], { profiles: [profile], contacts, projects });
  const health = clientHealth.assess(facts.get(organization.id), { todayKey: todayKeyFor(context, tzOffset) });
  const teamById = new Map(team.map((member) => [member.id, member]));
  let manager = profile.accountManagerUserId ? teamById.get(profile.accountManagerUserId) || null : null;
  if (!manager && profile.accountManagerUserId) {
    // A manager who has since left the team still shows by name.
    const former = await User.findByPk(profile.accountManagerUserId, { attributes: ['id', 'name'] });
    manager = former ? { id: former.id, name: former.name, inactive: true } : null;
  }
  const projectNames = new Map(projects.map((p) => [p.id, p.name || organization.name]));
  const taskList = openTasks
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
    .slice(0, 8)
    .map((t) => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, projectId: t.projectId, projectName: projectNames.get(t.projectId) || null,
      assignee: t.assigneeUserId ? teamById.get(t.assigneeUserId) || null : null,
    }));

  return {
    client: { id: organization.id, name: organization.name, createdAt: organization.createdAt },
    canSeeInternals: includeInternals,
    profile: {
      ...(includeInternals ? profile : withoutInternals(profile)),
      logo: imageRef(filesById.get(profile.logoFileId)),
      featuredImage: imageRef(filesById.get(profile.featuredImageFileId)),
    },
    manager,
    team,
    health,
    tasks: { ...health.tasks, items: taskList },
    sales,
    contacts,
    projects: projects
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((project) => projectSummary(project, organization.name, filesById)),
    files,
    recentNotes: recentNotes.slice(0, 3),
    notesCount: recentNotes.length,
    stripe: stripeSummaryFor(stripe, includeInternals),
  };
}

async function assertNameAvailable(context, name, exceptOrganizationId = null) {
  const duplicate = await Organization.findOne({
    where: {
      type: 'client',
      managingAgencyOrganizationId: context.organization.id,
      deletedAt: null,
      ...(exceptOrganizationId ? { id: { [Op.ne]: exceptOrganizationId } } : {}),
      [Op.and]: [sqlWhere(fn('lower', col('name')), name.toLowerCase())],
    },
  });
  if (duplicate) throw withDetails(`A client named “${duplicate.name}” already exists`, 409, { existingClientId: duplicate.id });
}

/** The client Organization and its profile, inside a caller's transaction. Inputs must already be validated. */
async function createClientWithin(context, { name, profileFields }, transaction) {
  const organizationId = crypto.randomUUID();
  const organization = await Organization.create({
    id: organizationId,
    name,
    slug: `client-${slugify(name)}-${organizationId.slice(0, 8)}`,
    type: 'client',
    status: 'active',
    managingAgencyOrganizationId: context.organization.id,
  }, { transaction });
  await ClientProfile.create({
    ...profileFields, organizationId, agencyOrganizationId: context.organization.id,
  }, { transaction });
  return organization;
}

/**
 * Keeps a saved website URL's domain link in step and reports whether it
 * matched in Namecheap (ADR 0009). A Namecheap problem never fails the
 * save — the match is simply reported as not checked.
 */
function syncDomainLink(context, { organization, projectId = null, url, actorUserId }) {
  return domainLinkService.syncUrlLink({
    agencyOrganizationId: context.organization.id, organizationId: organization.id, projectId, url, actorUserId,
  });
}

const EXISTING_CLIENT_FIELDS = [
  'websiteUrl', 'services', 'scopeNotes', 'accountManagerUserId', 'clientSince', 'setupPriceCents', 'recurringPriceCents',
  'billingFrequency', 'paymentStatus', 'nextActionAt', 'nextActionNote',
];

function cleanContactInput(input) {
  if (!input || typeof input !== 'object') return null;
  const contact = {
    name: text('Contact name', input.name, 255),
    title: text('Contact title', input.title, 150),
    email: text('Contact email', input.email, 255),
    phone: text('Contact phone', input.phone, 50),
  };
  if (!contact.name && !contact.email && !contact.phone) return null;
  if (!contact.name) throw invalid('Add the contact’s name, or leave the contact fields empty');
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw invalid('The contact’s email address doesn’t look valid');
  return contact;
}

/**
 * "Add existing client" (ADR 0013): a business that is already a client
 * — never counted as a new sale. Checks Leads and Clients for the same
 * business first; the caller can then open that record, turn an existing
 * lead into this client (useOrganizationId), or confirm it is different
 * (confirmNew).
 */
async function createClient(context, input, actorUserId = null) {
  const name = clientName(input.name);
  const picked = Object.fromEntries(EXISTING_CLIENT_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
  const profileFields = normalizeProfileInput(picked);
  await assertTeamMember(context, profileFields.accountManagerUserId);
  const contact = cleanContactInput(input.contact);
  const agencyId = context.organization.id;
  profileFields.acquisitionSource = 'existing';

  if (input.useOrganizationId) {
    return convertLeadToExistingClient(context, {
      organizationId: String(input.useOrganizationId), profileFields, contact, actorUserId,
    });
  }

  await assertNameAvailable(context, name);
  if (!input.confirmNew) {
    // Lazy require: the sales module depends on this one.
    const { findPossibleDuplicates } = require('../sales/leadIntakeService'); // eslint-disable-line global-require
    const possibleDuplicates = await findPossibleDuplicates(agencyId, {
      name, website: profileFields.websiteUrl, email: contact?.email, phone: contact?.phone,
    });
    if (possibleDuplicates.length) {
      throw withDetails('This business may already be in Leadzaro. Review the matches before adding it.', 409, { possibleDuplicates });
    }
  }

  const organization = await sequelize.transaction(async (transaction) => {
    const created = await createClientWithin(context, { name, profileFields }, transaction);
    if (contact) {
      await Contact.create({
        ...contact, organizationId: created.id, agencyOrganizationId: agencyId, source: 'manual', isPrimary: true,
      }, { transaction });
    }
    return created;
  });
  const domainMatch = profileFields.websiteUrl
    ? await syncDomainLink(context, { organization, url: profileFields.websiteUrl, actorUserId })
    : null;
  return { organization, domainMatch, createdFrom: 'new' };
}

/** A business already in Leads becomes the client, keeping its contacts, notes and history — no duplicate record. */
async function convertLeadToExistingClient(context, {
  organizationId, profileFields, contact, actorUserId,
}) {
  const agencyId = context.organization.id;
  const organization = await Organization.findOne({ where: { id: organizationId, managingAgencyOrganizationId: agencyId, deletedAt: null } });
  if (!organization) throw invalid('That business wasn’t found', 404);
  if (organization.type === 'client') throw withDetails(`${organization.name} is already a client`, 409, { existingClientId: organization.id });
  if (organization.type !== 'prospect') throw invalid('Only a business in Leads can be turned into a client', 422);
  await assertNameAvailable(context, organization.name, organization.id);

  await sequelize.transaction(async (transaction) => {
    await organization.update({ type: 'client' }, { transaction });
    const existing = await ClientProfile.findOne({
      where: { organizationId: organization.id, agencyOrganizationId: agencyId }, transaction, __visibilityScoped: true,
    });
    const fields = { ...profileFields };
    if (!fields.websiteUrl && organization.website) fields.websiteUrl = organization.website;
    if (existing) await existing.update(fields, { transaction });
    else await ClientProfile.create({ ...fields, organizationId: organization.id, agencyOrganizationId: agencyId }, { transaction });
    if (contact) {
      const known = await Contact.findOne({
        where: {
          organizationId: organization.id, archivedAt: null, deletedAt: null, ...(contact.email ? { email: contact.email } : { name: contact.name }),
        },
        transaction,
      });
      if (!known) {
        const hasPrimary = await Contact.count({
          where: {
            organizationId: organization.id, isPrimary: true, archivedAt: null, deletedAt: null,
          },
          transaction,
        });
        await Contact.create({
          ...contact, organizationId: organization.id, agencyOrganizationId: agencyId, source: 'manual', isPrimary: !hasPrimary,
        }, { transaction });
      }
    }
  });
  const openDeals = await Opportunity.count({
    where: {
      agencyOrganizationId: agencyId, organizationId: organization.id, deletedAt: null, archivedAt: null, stage: { [Op.notIn]: ['won', 'lost'] },
    },
  });
  const url = profileFields.websiteUrl || organization.website;
  const domainMatch = url ? await syncDomainLink(context, { organization, url, actorUserId }) : null;
  return {
    organization, domainMatch, createdFrom: 'lead', openDeals,
  };
}

/** Partial update of the client's name and/or any profile fields. Returns the changed field names (for the audit trail — never the values). */
async function updateClient(context, clientId, input, actorUserId = null) {
  const organization = await getClientOrThrow(context, clientId);
  const changed = [];

  // Validate everything before writing anything, so a rejected field
  // never leaves a half-applied edit behind.
  const profileFields = normalizeProfileInput(input);
  await assertClientImage(context, organization, profileFields.logoFileId);
  await assertClientImage(context, organization, profileFields.featuredImageFileId);
  if (profileFields.accountManagerUserId) await assertTeamMember(context, profileFields.accountManagerUserId);

  const name = input.name !== undefined ? clientName(input.name) : organization.name;
  const renaming = name !== organization.name;
  if (renaming) await assertNameAvailable(context, name, organization.id);

  if (Object.keys(profileFields).length) {
    const profile = await findOrCreateClientProfile(context, organization);
    if (profileFields.waitingOn !== undefined && profileFields.waitingOn !== profile.waitingOn) {
      profileFields.waitingOnSince = profileFields.waitingOn ? new Date() : null;
      if (!profileFields.waitingOn && profileFields.waitingOnNote === undefined) profileFields.waitingOnNote = null;
    }
    if (profileFields.clientEndedAt) {
      const reason = profileFields.endReason !== undefined ? profileFields.endReason : profile.endReason;
      if (!reason) throw invalid('Say why the client ended — it keeps retention numbers honest');
      const since = profileFields.clientSince !== undefined ? profileFields.clientSince : profile.clientSince;
      if (since && profileFields.clientEndedAt < since) throw invalid('The end date can’t be before the client started');
    } else if (profileFields.clientEndedAt === null && profile.clientEndedAt && profileFields.endReason === undefined) {
      profileFields.endReason = null;
    }
    await profile.update(profileFields);
    changed.push(...Object.keys(profileFields));
  }

  if (renaming) {
    await organization.update({ name });
    changed.unshift('name');
  }

  const domainMatch = profileFields.websiteUrl !== undefined
    ? await syncDomainLink(context, { organization, url: profileFields.websiteUrl, actorUserId })
    : undefined;
  return { organization, changed, domainMatch };
}

/** Sets the client manager on several clients at once (max 200). Returns how many changed. */
async function assignManager(context, clientIds, accountManagerUserId) {
  if (!Array.isArray(clientIds) || !clientIds.length) throw invalid('Choose at least one client');
  if (clientIds.length > 200) throw invalid('Assign at most 200 clients at a time');
  if (!clientIds.every((id) => UUID_PATTERN.test(String(id)))) throw invalid('One of the selected clients isn’t valid — reload and try again');
  const managerId = accountManagerUserId ? String(accountManagerUserId) : null;
  await assertTeamMember(context, managerId);
  const organizations = await listClientOrganizationsForRequester(context, { id: clientIds.map(String) });
  if (organizations.length !== new Set(clientIds).size) throw invalid('Some of those clients weren’t found', 404);
  let changed = 0;
  for (const organization of organizations) {
    // eslint-disable-next-line no-await-in-loop
    const profile = await findOrCreateClientProfile(context, organization);
    if (profile.accountManagerUserId === managerId) continue;
    // eslint-disable-next-line no-await-in-loop
    await profile.update({ accountManagerUserId: managerId });
    changed += 1;
  }
  return { changed, clientIds: organizations.map((o) => o.id) };
}

async function getOwnedProject(context, organization, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project || project.organizationId !== organization.id) throw invalid('Project not found', 404);
  return project;
}

async function createProject(context, clientId, input, actorUserId) {
  const organization = await getClientOrThrow(context, clientId);
  const fields = normalizeProjectInput(input, { requireName: true });
  await assertClientImage(context, organization, fields.previewFileId);

  const project = await createProjectRecord({
    ...fields,
    organizationId: organization.id,
    agencyOrganizationId: context.organization.id,
    ownerUserId: actorUserId,
  });
  const domainMatch = fields.liveUrl
    ? await syncDomainLink(context, {
      organization, projectId: project.id, url: fields.liveUrl, actorUserId,
    })
    : null;
  return { project, domainMatch };
}

async function updateProject(context, clientId, projectId, input, actorUserId = null) {
  const organization = await getClientOrThrow(context, clientId);
  const project = await getOwnedProject(context, organization, projectId);
  const fields = normalizeProjectInput(input, { requireName: false });
  if (fields.name === null && input.name !== undefined) throw invalid('Project name cannot be empty');
  await assertClientImage(context, organization, fields.previewFileId);
  await project.update(fields);
  // A changed live URL re-evaluates the domain match, so the previous domain's details never carry over.
  const domainMatch = fields.liveUrl !== undefined
    ? await syncDomainLink(context, {
      organization, projectId: project.id, url: fields.liveUrl, actorUserId,
    })
    : undefined;
  return { project, changed: Object.keys(fields), domainMatch };
}

async function uploadClientFile({
  context, clientId, projectId, upload, uploadedByUserId,
}) {
  const organization = await getClientOrThrow(context, clientId);
  if (projectId) await getOwnedProject(context, organization, projectId);

  const file = await fileService.storeFile({
    organizationId: organization.id,
    agencyOrganizationId: context.organization.id,
    projectId: projectId || null,
    scope: projectId ? 'project' : 'organization',
    buffer: upload.buffer,
    originalName: upload.originalname,
    mimeType: upload.mimetype,
    isPrivate: true,
    uploadedByUserId,
  });
  const [withUrls] = await fileService.withDisplayUrls([file]);
  return withUrls;
}

async function getOwnedFile(context, organization, fileId) {
  const file = await getFileByIdForRequester(context, fileId);
  if (!file || file.organizationId !== organization.id) throw invalid('File not found', 404);
  return file;
}

async function getClientFileDownloadUrl(context, clientId, fileId) {
  const organization = await getClientOrThrow(context, clientId);
  await getOwnedFile(context, organization, fileId);
  return fileService.getSignedUrl(context, fileId, null, { download: true });
}

async function deleteClientFile(context, clientId, fileId) {
  const organization = await getClientOrThrow(context, clientId);
  await getOwnedFile(context, organization, fileId);
  return fileService.deleteFile(context, fileId);
}

module.exports = {
  getClientOrThrow,
  listClients,
  listTeam,
  getClientDetail,
  createClient,
  createClientWithin,
  assertNameAvailable,
  updateClient,
  assignManager,
  createProject,
  updateProject,
  uploadClientFile,
  getClientFileDownloadUrl,
  deleteClientFile,
};
