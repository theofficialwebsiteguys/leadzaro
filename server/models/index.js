const sequelize = require('../config/database');

const User = require('./User')(sequelize);
const Lead = require('./Lead')(sequelize);
const SavedLead = require('./SavedLead')(sequelize);
const LeadNote = require('./LeadNote')(sequelize);
const OutreachActivity = require('./OutreachActivity')(sequelize);
const SubscriptionPlan = require('./SubscriptionPlan')(sequelize);
const UserSubscription = require('./UserSubscription')(sequelize);

const models = { User, Lead, SavedLead, LeadNote, OutreachActivity, SubscriptionPlan, UserSubscription };

// Run associations
Object.values(models).forEach((model) => {
  if (model.associate) model.associate(models);
});

module.exports = { sequelize, ...models };
