const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

// client_website / project_url: derived from a website URL and re-evaluated
// whenever that URL changes. manual: added by hand. namecheap_link: linked
// from the unlinked-domains review list (ADR 0009).
const SOURCES = ['client_website', 'project_url', 'manual', 'namecheap_link'];
// A person's explicit decision, which automatic matching never overrides.
const OVERRIDES = ['confirmed', 'rejected'];

module.exports = (sequelize) => {
  const ClientDomainLink = sequelize.define('ClientDomainLink', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    projectId: { type: DataTypes.UUID, allowNull: true },
    domainRecordId: { type: DataTypes.UUID, allowNull: false },
    hostname: { type: DataTypes.STRING(253), allowNull: false },
    source: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [SOURCES] } },
    isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    linkOverride: { type: DataTypes.STRING(12), allowNull: true, validate: { isIn: [OVERRIDES] } },
    overrideAt: { type: DataTypes.DATE, allowNull: true },
    overrideByUserId: { type: DataTypes.UUID, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  ClientDomainLink.SOURCES = SOURCES;
  ClientDomainLink.OVERRIDES = OVERRIDES;

  installVisibilityGuard(ClientDomainLink, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return ClientDomainLink;
};
