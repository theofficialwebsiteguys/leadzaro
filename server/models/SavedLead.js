const { DataTypes } = require('sequelize');

const STATUSES = ['New', 'Saved', 'Contacted', 'Follow Up', 'Interested', 'Not Interested', 'Closed', 'Archived'];
const PRIORITIES = ['Low', 'Medium', 'High'];

module.exports = (sequelize) => {
  const SavedLead = sequelize.define('SavedLead', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Users', key: 'id' },
    },
    leadId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Leads', key: 'id' },
    },
    status: {
      type: DataTypes.ENUM(...STATUSES),
      defaultValue: 'Saved',
    },
    priority: {
      type: DataTypes.ENUM(...PRIORITIES),
      defaultValue: 'Medium',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    lastContactedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    nextFollowUpAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  SavedLead.associate = (models) => {
    SavedLead.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    SavedLead.belongsTo(models.Lead, { foreignKey: 'leadId', as: 'lead' });
  };

  return SavedLead;
};
