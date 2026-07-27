const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATES = ['managed', 'extended', 'registered_custom', 'detached'];
// Library-governance lifecycle (current-phase-plan.md § 2n) — distinct
// from STATES above, which describes Angular-integration status (§ 2d),
// not whether this section is currently offered for new use.
const LIBRARY_STATUSES = ['draft', 'published', 'deprecated'];

module.exports = (sequelize) => {
  const SectionDefinition = sequelize.define('SectionDefinition', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    componentKey: { type: DataTypes.STRING(60), allowNull: false },
    category: { type: DataTypes.STRING(60), allowNull: false },
    settingsSchema: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
    variants: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: [],
    },
    state: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'managed', validate: { isIn: [STATES] },
    },
    previewImageUrl: { type: DataTypes.STRING(500), allowNull: true },
    isSystemDefined: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published', validate: { isIn: [LIBRARY_STATUSES] },
    },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  SectionDefinition.STATES = STATES;
  SectionDefinition.LIBRARY_STATUSES = LIBRARY_STATUSES;

  installVisibilityGuard(SectionDefinition);

  return SectionDefinition;
};
