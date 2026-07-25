const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LeadNote = sequelize.define('LeadNote', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    leadId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  });

  LeadNote.associate = (models) => {
    LeadNote.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    LeadNote.belongsTo(models.Lead, { foreignKey: 'leadId', as: 'lead' });
    LeadNote.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
  };

  return LeadNote;
};
