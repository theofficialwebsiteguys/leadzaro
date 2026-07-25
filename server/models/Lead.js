const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Lead = sequelize.define('Lead', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    zip: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
    },
    website: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    hasWebsite: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    googleMapsUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    googlePlaceId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
    },
    rating: {
      type: DataTypes.DECIMAL(3, 1),
      allowNull: true,
    },
    reviewCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    source: {
      type: DataTypes.STRING(50),
      defaultValue: 'google_places',
    },
  });

  Lead.associate = (models) => {
    Lead.hasMany(models.SavedLead, { foreignKey: 'leadId', as: 'savedByUsers' });
    Lead.hasMany(models.LeadNote, { foreignKey: 'leadId', as: 'notes' });
    Lead.hasMany(models.OutreachActivity, { foreignKey: 'leadId', as: 'outreachActivities' });
  };

  return Lead;
};
