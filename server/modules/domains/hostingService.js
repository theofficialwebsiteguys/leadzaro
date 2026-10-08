'use strict';

const { sequelize, HostingPlan, HostingPlanClient } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  hostingShares, annualize, daysUntil, toDateOnly, tally,
} = require('../../core/domains/domainFacts');
const { getClientOrganizationForRequester, listClientOrganizationsForRequester, listProjectsForRequester } = require('../../core/authorization/clientVisibleModels');
const { normalizePlanInput } = require('./domainFields');
const { cents } = require('../clients/clientFields');

/**
 * Hosting plans (ADR 0009) — maintained by hand, since Namecheap's API
 * exposes no hosting data. One plan can serve several clients/projects;
 * its cost is stored once and split by an explicit allocation method, so
 * totals count the plan once and each client only its share.
 */

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function canSeeInternals(context) {
  return Boolean(context.permissionKeys?.has('projects.manage'));
}

function formatCents(value, currency) {
  return `${(value / 100).toFixed(2)} ${currency}`;
}

/** Manual allocations may not add up to more than the plan costs — that would double count. */
function assertAllocationsFit(plan, planClients) {
  if (plan.allocationMethod !== 'manual' || plan.costCents === null || plan.costCents === undefined) return;
  const allocated = planClients.reduce((sum, planClient) => sum + (planClient.allocatedCents || 0), 0);
  if (allocated > plan.costCents) {
    throw invalid(`Allocations add up to ${formatCents(allocated, plan.currency)}, more than the plan’s ${formatCents(plan.costCents, plan.currency)} cost.`);
  }
}

function planDto(plan, planClients, { clientNames, projectNames, includeInternals, forOrganizationId = null }) {
  const shares = hostingShares(plan, planClients);
  const clients = planClients
    .filter((planClient) => !forOrganizationId || planClient.organizationId === forOrganizationId)
    .map((planClient) => ({
      organizationId: planClient.organizationId,
      clientName: clientNames.get(planClient.organizationId) || 'Unknown client',
      projects: (planClient.projectIds || []).filter((id) => projectNames.has(id)).map((id) => ({ id, name: projectNames.get(id) })),
      ...(includeInternals ? {
        allocatedCents: planClient.allocatedCents,
        shareCents: shares.get(planClient.organizationId),
        shareAnnualCents: annualize(shares.get(planClient.organizationId), plan.billingPeriodMonths),
      } : {}),
    }));
  const expiresOn = toDateOnly(plan.expiresOn);
  const dto = {
    id: plan.id,
    name: plan.name,
    providerName: plan.providerName,
    planName: plan.planName,
    controlPanelUrl: plan.controlPanelUrl,
    billingPeriodMonths: plan.billingPeriodMonths,
    expiresOn,
    daysUntilExpiry: daysUntil(expiresOn),
    nextChargeOn: toDateOnly(plan.nextChargeOn),
    autoRenew: plan.autoRenew,
    allocationMethod: plan.allocationMethod,
    archivedAt: plan.archivedAt,
    notes: plan.notes,
    clientCount: planClients.length,
    shared: planClients.length > 1,
    clients,
  };
  if (includeInternals) {
    const allShares = [...shares.values()];
    const allocated = tally(allShares.filter((value) => value !== null));
    dto.costCents = plan.costCents;
    dto.currency = plan.currency;
    dto.annualCostCents = annualize(plan.costCents, plan.billingPeriodMonths);
    dto.allocation = {
      method: plan.allocationMethod,
      allocatedCents: plan.allocationMethod === 'none' ? 0 : allocated.knownCents || 0,
      unallocatedCents: plan.costCents === null || plan.costCents === undefined ? null : plan.costCents - (plan.allocationMethod === 'none' ? 0 : allocated.knownCents || 0),
      unknownShares: plan.allocationMethod === 'manual' ? allShares.filter((value) => value === null).length : 0,
    };
  }
  return dto;
}

async function namesFor(context, planClients) {
  const organizationIds = [...new Set(planClients.map((planClient) => planClient.organizationId))];
  if (!organizationIds.length) return { clientNames: new Map(), projectNames: new Map() };
  const [clients, projects] = await Promise.all([
    listClientOrganizationsForRequester(context),
    listProjectsForRequester(context, { organizationId: organizationIds }),
  ]);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name || clientNames.get(project.organizationId) || 'Project']));
  return { clientNames, projectNames };
}

async function listPlans(context, { includeArchived = false } = {}) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const plans = await access.hostingPlans.findAll(agencyOrganizationId, {
    where: includeArchived ? {} : { archivedAt: null }, order: [['name', 'ASC']],
  });
  const planClients = plans.length ? await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { hostingPlanId: plans.map((plan) => plan.id) } }) : [];
  const names = await namesFor(context, planClients);
  const includeInternals = canSeeInternals(context);
  return plans.map((plan) => planDto(plan, planClients.filter((pc) => pc.hostingPlanId === plan.id), { ...names, includeInternals }));
}

/** The plans one client is on, each with that client's share only. */
async function plansForClient(context, organizationId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const mine = await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { organizationId } });
  if (!mine.length) return [];
  const plans = await access.hostingPlans.findAll(agencyOrganizationId, { where: { id: mine.map((pc) => pc.hostingPlanId), archivedAt: null }, order: [['name', 'ASC']] });
  const allPlanClients = await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { hostingPlanId: plans.map((plan) => plan.id) } });
  const names = await namesFor(context, allPlanClients);
  const includeInternals = canSeeInternals(context);
  return plans.map((plan) => planDto(plan, allPlanClients.filter((pc) => pc.hostingPlanId === plan.id), {
    ...names, includeInternals, forOrganizationId: organizationId,
  }));
}

async function getOwnedPlan(agencyOrganizationId, planId) {
  const plan = await access.hostingPlans.findOne(agencyOrganizationId, { where: { id: planId } });
  if (!plan) throw invalid('Hosting plan not found', 404);
  return plan;
}

async function describePlan(context, plan) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const planClients = await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { hostingPlanId: plan.id } });
  return planDto(plan, planClients, { ...(await namesFor(context, planClients)), includeInternals: canSeeInternals(context) });
}

async function createPlan(context, input, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const fields = normalizePlanInput(input || {}, { requireName: true });
  const plan = await HostingPlan.create({
    ...fields, currency: fields.currency || 'USD', agencyOrganizationId, createdByUserId: actorUserId,
  });
  if (input?.clientId) await setPlanClient(context, plan.id, { clientId: input.clientId, projectIds: input.projectIds || [] });
  return describePlan(context, plan);
}

async function updatePlan(context, planId, input) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const plan = await getOwnedPlan(agencyOrganizationId, planId);
  const fields = normalizePlanInput(input || {}, { requireName: false });
  const planClients = await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { hostingPlanId: plan.id } });
  assertAllocationsFit({ ...plan.get(), ...fields }, planClients);
  if (input?.archived !== undefined) fields.archivedAt = input.archived ? (plan.archivedAt || new Date()) : null;
  await plan.update(fields);
  return describePlan(context, plan);
}

async function assertProjectsBelong(context, organizationId, projectIds) {
  if (!Array.isArray(projectIds)) throw invalid('projectIds must be a list');
  const unique = [...new Set(projectIds)];
  if (!unique.length) return [];
  const projects = await listProjectsForRequester(context, { organizationId, id: unique });
  if (projects.length !== unique.length) throw invalid('Every project must belong to that client');
  return unique;
}

/** Adds a client to a plan or updates which of its projects use it / its manual allocation. */
async function setPlanClient(context, planId, { clientId, projectIds = [], allocatedCents }) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const plan = await getOwnedPlan(agencyOrganizationId, planId);
  const client = await getClientOrganizationForRequester(context, clientId);
  if (!client) throw invalid('Client not found', 404);
  const validProjectIds = await assertProjectsBelong(context, client.id, projectIds);

  await sequelize.transaction(async (transaction) => {
    let planClient = await access.hostingPlanClients.findOne(agencyOrganizationId, { where: { hostingPlanId: plan.id, organizationId: client.id }, transaction });
    const values = { projectIds: validProjectIds };
    if (allocatedCents !== undefined) values.allocatedCents = cents('Allocated amount', allocatedCents);
    if (planClient) await planClient.update(values, { transaction });
    else {
      planClient = await HostingPlanClient.create({
        agencyOrganizationId, hostingPlanId: plan.id, organizationId: client.id, ...values,
      }, { transaction });
    }
    const all = await access.hostingPlanClients.findAll(agencyOrganizationId, { where: { hostingPlanId: plan.id }, transaction });
    assertAllocationsFit(plan, all);
  });
  return describePlan(context, plan);
}

async function removePlanClient(context, planId, clientId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const plan = await getOwnedPlan(agencyOrganizationId, planId);
  const planClient = await access.hostingPlanClients.findOne(agencyOrganizationId, { where: { hostingPlanId: plan.id, organizationId: clientId } });
  if (planClient) await planClient.destroy();
  return describePlan(context, plan);
}

module.exports = {
  canSeeInternals,
  listPlans,
  plansForClient,
  getOwnedPlan,
  createPlan,
  updatePlan,
  setPlanClient,
  removePlanClient,
  assertAllocationsFit,
};
