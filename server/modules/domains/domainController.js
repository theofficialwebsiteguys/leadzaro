'use strict';

const access = require('../../core/domains/domainRegistryAccess');
const connectionService = require('../integrations/namecheapConnectionService');
const clientService = require('../clients/clientService');
const { getProjectByIdForRequester } = require('../../core/authorization/clientVisibleModels');
const domainViewService = require('./domainViewService');
const domainLinkService = require('./domainLinkService');
const domainReviewService = require('./domainReviewService');
const renewalService = require('./renewalService');
const hostingService = require('./hostingService');
const expenseService = require('./expenseService');
const inventoryService = require('./domainInventoryService');
const syncService = require('../integrations/namecheapSyncService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      // Conflicts and unconfirmed writes carry the current state / activity for the UI.
      if (err.statusCode && (err.code || err.activity || err.dns || err.quote || err.activityId)) {
        return res.status(err.statusCode).json({
          success: false, message: err.message, code: err.code || null, activity: err.activity || null, dns: err.dns || null, quote: err.quote || null, activityId: err.activityId || null,
        });
      }
      if (err.statusCode) return error(res, err.message, err.statusCode);
      if (err.name === 'SequelizeValidationError') return error(res, err.errors?.[0]?.message || 'Invalid input', 422);
      return next(err);
    }
    return undefined;
  };
}

function audit(req, action, targetType, targetId, metadata) {
  return recordAudit({
    organizationId: req.context.organization.id, actorUserId: req.user.id, action, targetType, targetId, metadata, req,
  });
}

// ─── Workspace-wide ─────────────────────────────────────────────────────

const connection = handler(async (req, res) => {
  const agencyOrganizationId = access.agencyIdFor(req.context);
  return success(res, { connection: domainViewService.connectionSummary(await connectionService.getConnection(agencyOrganizationId)) });
});

const renewals = handler(async (req, res) => success(res, await renewalService.listRenewals(req.context, { window: req.query.window || '60' })));

const review = handler(async (req, res) => success(res, await domainReviewService.reviewQueue(req.context)));

const lookup = handler(async (req, res) => success(res, {
  match: await domainReviewService.lookupForForm(req.context, { url: req.query.url, clientId: req.query.clientId || null }),
}));

const updateDomain = handler(async (req, res) => {
  const { record, changed } = await domainViewService.updateDomainDetails(req.context, req.params.domainId, req.body, req.user.id);
  if (changed.length) await audit(req, 'domain.updated', 'DomainRecord', record.id, { fields: changed });
  return success(res, { id: record.id, changed }, 'Domain details saved');
});

const ignore = handler(async (req, res) => {
  const result = await domainReviewService.setIgnored(req.context, req.params.domainId, true, req.user.id);
  await audit(req, 'domain.ignored', 'DomainRecord', result.id);
  return success(res, result, 'Domain ignored');
});

const unignore = handler(async (req, res) => {
  const result = await domainReviewService.setIgnored(req.context, req.params.domainId, false, req.user.id);
  await audit(req, 'domain.unignored', 'DomainRecord', result.id);
  return success(res, result, 'Domain restored to the review list');
});

const link = handler(async (req, res) => {
  const match = await domainReviewService.linkToClient(req.context, req.params.domainId, { clientId: req.body?.clientId, projectId: req.body?.projectId || null }, req.user.id);
  await audit(req, 'domain.linked', 'DomainRecord', req.params.domainId, { clientId: req.body?.clientId, projectId: req.body?.projectId || null });
  return success(res, { match }, 'Domain linked');
});

const createClient = handler(async (req, res) => {
  const result = await domainReviewService.createClientFromDomain(req.context, req.params.domainId, req.body, req.user.id);
  await audit(req, 'client.created', 'Organization', result.client.id, { fromDomainRecordId: req.params.domainId });
  return success(res, result, 'Client created', 201);
});

const checkAgain = handler(async (req, res) => success(res, await domainReviewService.checkAgain(req.context, req.params.domainId)));

// ─── Payments ───────────────────────────────────────────────────────────

const listDomainExpenses = handler(async (req, res) => success(res, { expenses: await expenseService.listExpenses(req.context, { domainRecordId: req.params.domainId }) }));

const addDomainExpense = handler(async (req, res) => {
  const expense = await expenseService.addExpense(req.context, { domainRecordId: req.params.domainId }, req.body, req.user.id);
  await audit(req, 'expense.recorded', 'ServiceExpense', expense.id, { domainRecordId: req.params.domainId });
  return success(res, { expense }, 'Payment recorded', 201);
});

const listPlanExpenses = handler(async (req, res) => success(res, { expenses: await expenseService.listExpenses(req.context, { hostingPlanId: req.params.planId }) }));

const addPlanExpense = handler(async (req, res) => {
  const expense = await expenseService.addExpense(req.context, { hostingPlanId: req.params.planId }, req.body, req.user.id);
  await audit(req, 'expense.recorded', 'ServiceExpense', expense.id, { hostingPlanId: req.params.planId });
  return success(res, { expense }, 'Payment recorded', 201);
});

const deleteExpense = handler(async (req, res) => {
  await expenseService.deleteExpense(req.context, req.params.expenseId);
  await audit(req, 'expense.deleted', 'ServiceExpense', req.params.expenseId);
  return success(res, null, 'Payment removed');
});

// ─── Hosting plans ──────────────────────────────────────────────────────

const listPlans = handler(async (req, res) => success(res, { plans: await hostingService.listPlans(req.context, { includeArchived: req.query.archived === '1' }) }));

const createPlan = handler(async (req, res) => {
  const plan = await hostingService.createPlan(req.context, req.body, req.user.id);
  await audit(req, 'hosting_plan.created', 'HostingPlan', plan.id);
  return success(res, { plan }, 'Hosting plan added', 201);
});

const updatePlan = handler(async (req, res) => {
  const plan = await hostingService.updatePlan(req.context, req.params.planId, req.body);
  await audit(req, 'hosting_plan.updated', 'HostingPlan', plan.id, { fields: Object.keys(req.body || {}) });
  return success(res, { plan }, 'Hosting plan saved');
});

const setPlanClient = handler(async (req, res) => {
  const plan = await hostingService.setPlanClient(req.context, req.params.planId, { clientId: req.params.clientId, projectIds: req.body?.projectIds || [], allocatedCents: req.body?.allocatedCents });
  await audit(req, 'hosting_plan.client_set', 'HostingPlan', plan.id, { clientId: req.params.clientId });
  return success(res, { plan }, 'Hosting plan updated');
});

const removePlanClient = handler(async (req, res) => {
  const plan = await hostingService.removePlanClient(req.context, req.params.planId, req.params.clientId);
  await audit(req, 'hosting_plan.client_removed', 'HostingPlan', plan.id, { clientId: req.params.clientId });
  return success(res, { plan }, 'Client removed from the plan');
});

// ─── Client- and project-scoped ─────────────────────────────────────────

const clientDomains = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  return success(res, await domainViewService.clientDomainsView(req.context, organization));
});

const addClientDomain = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const projectId = req.body?.projectId || null;
  if (projectId) await domainReviewService.resolveTarget(req.context, organization.id, projectId);
  const match = await domainLinkService.addManualLink({
    agencyOrganizationId: access.agencyIdFor(req.context), organizationId: organization.id, projectId, domain: req.body?.domain, isPrimary: Boolean(req.body?.isPrimary), actorUserId: req.user.id,
  });
  await audit(req, 'domain.link_added', 'ClientDomainLink', match.linkId, { clientId: organization.id, projectId });
  return success(res, { match }, 'Domain added', 201);
});

const updateClientDomainLink = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const agencyOrganizationId = access.agencyIdFor(req.context);
  const domainLink = await domainLinkService.getOwnedLink(agencyOrganizationId, organization.id, req.params.linkId);
  let match;
  if (req.body?.projectId !== undefined) {
    if (req.body.projectId) await domainReviewService.resolveTarget(req.context, organization.id, req.body.projectId);
    match = await domainLinkService.moveLink(agencyOrganizationId, domainLink, req.body.projectId || null);
  }
  if (req.body?.decision) match = await domainLinkService.decideLink({ agencyOrganizationId, link: domainLink, decision: req.body.decision, actorUserId: req.user.id });
  if (req.body?.isPrimary === true) match = await domainLinkService.setPrimary(agencyOrganizationId, domainLink);
  if (!match) match = await domainLinkService.describeLink(agencyOrganizationId, domainLink);
  await audit(req, 'domain.link_updated', 'ClientDomainLink', domainLink.id, { fields: Object.keys(req.body || {}) });
  return success(res, { match }, 'Domain link updated');
});

const removeClientDomainLink = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const agencyOrganizationId = access.agencyIdFor(req.context);
  const domainLink = await domainLinkService.getOwnedLink(agencyOrganizationId, organization.id, req.params.linkId);
  await domainLinkService.removeLink(agencyOrganizationId, domainLink);
  await audit(req, 'domain.link_removed', 'ClientDomainLink', domainLink.id, { clientId: organization.id });
  return success(res, null, 'Domain removed from this client');
});

const projectDomains = handler(async (req, res) => {
  access.agencyIdFor(req.context);
  const project = await getProjectByIdForRequester(req.context, req.params.projectId);
  if (!project) return error(res, 'Project not found', 404);
  const organization = await clientService.getClientOrThrow(req.context, project.organizationId);
  return success(res, await domainViewService.clientDomainsView(req.context, organization, { projectId: project.id }));
});

// ─── Read-only Domains list and domain page (ADR 0010) ─────────────────

const inventory = handler(async (req, res) => success(res, await inventoryService.inventory(req.context, { filter: req.query.filter || 'all', q: req.query.q || '' })));
const detail = handler(async (req, res) => success(res, { domain: await inventoryService.detail(req.context, req.params.domainId) }));
const refresh = handler(async (req, res) => {
  const { domain } = { domain: await inventoryService.detail(req.context, req.params.domainId) };
  const check = await syncService.checkDomain({ agencyOrganizationId: access.agencyIdFor(req.context), domainName: domain.domainName, force: true });
  return success(res, { check, domain: await inventoryService.detail(req.context, req.params.domainId) });
});

module.exports = {
  inventory,
  detail,
  refresh,
  connection,
  renewals,
  review,
  lookup,
  updateDomain,
  ignore,
  unignore,
  link,
  createClient,
  checkAgain,
  listDomainExpenses,
  addDomainExpense,
  listPlanExpenses,
  addPlanExpense,
  deleteExpense,
  listPlans,
  createPlan,
  updatePlan,
  setPlanClient,
  removePlanClient,
  clientDomains,
  addClientDomain,
  updateClientDomainLink,
  removeClientDomainLink,
  projectDomains,
};
