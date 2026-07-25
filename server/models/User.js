const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    companyName: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    salespersonType: {
      type: DataTypes.ENUM(
        'Website Developer',
        'Marketing Agency',
        'Roofing Company',
        'Real Estate Agent',
        'Insurance Agent',
        'Local Service Business',
        'Cannabis Sales',
        'Custom / Other'
      ),
      allowNull: false,
      defaultValue: 'Custom / Other',
    },
    targetIndustry: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    serviceArea: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      defaultValue: 'user',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  });

  User.associate = (models) => {
    User.hasMany(models.SavedLead, { foreignKey: 'userId', as: 'savedLeads' });
    User.hasMany(models.LeadNote, { foreignKey: 'userId', as: 'notes' });
    User.hasMany(models.OutreachActivity, { foreignKey: 'userId', as: 'outreachActivities' });
    User.hasOne(models.UserSubscription, { foreignKey: 'userId', as: 'subscription' });
  };

  return User;
};
