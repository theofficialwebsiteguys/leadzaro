const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Opportunity = sequelize.define('Opportunity', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // The prospect Organization this opportunity belongs to.
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Denormalized from Organization.managingAgencyOrganizationId at
    // creation time. Every authorization/query scope on this table uses
    // this column, matching the already-reviewed-and-tested pattern
    // SavedLead/LeadNote/OutreachActivity use for their own
    // organizationId — never a join through the prospect organization,
    // which nothing in a single-agency test suite would catch if wrong.
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // The canonical Google Places record this opportunity originated
    // from, if any (manually-created opportunities may have none).
    sourceLeadId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    stage: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    assignedToUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    scoreReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Set when this opportunity was merged away as a duplicate — points
    // at the surviving ("winner") opportunity. Merging archives, it never
    // deletes; this column plus the merge AuditLog entry are what
    // undo-merge uses to reverse the operation.
    mergedIntoOpportunityId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['agencyOrganizationId', 'sourceLeadId'],
        where: { archivedAt: null, deletedAt: null },
        name: 'opportunities_agency_lead_active_unique',
      },
    ],
  });

  Opportunity.associate = (models) => {
    Opportunity.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    Opportunity.belongsTo(models.Lead, { foreignKey: 'sourceLeadId', as: 'sourceLead' });
    Opportunity.belongsTo(models.User, { foreignKey: 'assignedToUserId', as: 'assignedTo' });
    Opportunity.belongsTo(models.Opportunity, { foreignKey: 'mergedIntoOpportunityId', as: 'mergedInto' });
    Opportunity.hasOne(models.WebsiteAudit, { foreignKey: 'opportunityId', as: 'websiteAudit' });
  };

  return Opportunity;
};
