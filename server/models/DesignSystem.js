const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

// Library-governance lifecycle (current-phase-plan.md § 2n) — only ever
// meaningful for isLibraryTemplate: true rows; a client's own forked
// instance never has its status read.
const LIBRARY_STATUSES = ['draft', 'published', 'deprecated'];

module.exports = (sequelize) => {
  const DesignSystem = sequelize.define('DesignSystem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    tokens: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
    isLibraryTemplate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    forkedFromDesignSystemId: { type: DataTypes.UUID, allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published', validate: { isIn: [LIBRARY_STATUSES] },
    },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  DesignSystem.LIBRARY_STATUSES = LIBRARY_STATUSES;

  DesignSystem.associate = (models) => {
    DesignSystem.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    DesignSystem.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'createdBy' });
  };

  installVisibilityGuard(DesignSystem);

  return DesignSystem;
};
