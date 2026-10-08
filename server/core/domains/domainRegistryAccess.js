'use strict';

const {
  IntegrationConnection, DomainRecord, ClientDomainLink, HostingPlan, HostingPlanClient, ServiceExpense,
} = require('../../models');

/**
 * The sanctioned way to query the domain registry's guarded models
 * (IntegrationConnection, DomainRecord, ClientDomainLink, HostingPlan,
 * HostingPlanClient, ServiceExpense) — the same runtime-guard pattern as
 * clientVisibleModels.js (ADR 0007), in its own module (ADR 0009).
 *
 * Every accessor takes the agency workspace id explicitly and applies it
 * after the caller's own conditions, so a caller-supplied `where` can
 * never widen a query past its workspace. Request code gets that id from
 * agencyIdFor(context), which refuses anything but an agency employee
 * membership: registrar data, costs and access notes are internal, and
 * client roles hold projects.view. The daily sync — which has no request
 * — passes the connection's own agencyOrganizationId.
 */

function agencyIdFor(context) {
  if (context?.membership?.membershipType !== 'employee' || !context.organization?.id) {
    const err = new Error('Domains and hosting are only available to agency team members');
    err.statusCode = 403;
    throw err;
  }
  return context.organization.id;
}

function scoped(agencyOrganizationId, { where = {}, ...options } = {}) {
  if (!agencyOrganizationId) throw new Error('An agency workspace id is required');
  return { ...options, where: { ...where, agencyOrganizationId }, __visibilityScoped: true };
}

function accessorsFor(Model) {
  return {
    findAll: (agencyOrganizationId, options) => Model.findAll(scoped(agencyOrganizationId, options)),
    findOne: (agencyOrganizationId, options) => Model.findOne(scoped(agencyOrganizationId, options)),
    count: (agencyOrganizationId, options) => Model.count(scoped(agencyOrganizationId, options)),
  };
}

const connections = accessorsFor(IntegrationConnection);
const domainRecords = accessorsFor(DomainRecord);
const domainLinks = accessorsFor(ClientDomainLink);
const hostingPlans = accessorsFor(HostingPlan);
const hostingPlanClients = accessorsFor(HostingPlanClient);
const expenses = accessorsFor(ServiceExpense);

/** Unique per (workspace, domain): concurrent callers converge on one row. */
async function findOrCreateDomainRecord(agencyOrganizationId, domainName, { transaction } = {}) {
  const existing = await domainRecords.findOne(agencyOrganizationId, { where: { domainName }, transaction });
  if (existing) return existing;
  try {
    return await DomainRecord.create({ agencyOrganizationId, domainName }, { transaction });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError' || transaction) throw err;
    return domainRecords.findOne(agencyOrganizationId, { where: { domainName } });
  }
}

/**
 * Re-reads a row this module already returned (so it is already within its
 * workspace). Sequelize's reload() is a findOne by primary key, which the
 * guard would otherwise refuse.
 */
function reload(instance) {
  return instance.reload({ __visibilityScoped: true });
}

/** For the scheduler only: connections with saved credentials, across workspaces. */
function listConnectionsWithCredentialsSystemLevel(provider) {
  const { Op } = require('sequelize'); // eslint-disable-line global-require
  return IntegrationConnection.findAll({
    where: { provider, credentialsCiphertext: { [Op.ne]: null } },
    __visibilityScoped: true,
  });
}

module.exports = {
  agencyIdFor,
  connections,
  domainRecords,
  domainLinks,
  hostingPlans,
  hostingPlanClients,
  expenses,
  findOrCreateDomainRecord,
  reload,
  listConnectionsWithCredentialsSystemLevel,
};
