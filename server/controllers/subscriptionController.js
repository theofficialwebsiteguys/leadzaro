const { SubscriptionPlan, UserSubscription } = require('../models');
const { success, notFound, error } = require('../utils/response');

async function getPlans(req, res, next) {
  try {
    const plans = await SubscriptionPlan.findAll({
      where: { isActive: true },
      order: [['price', 'ASC']],
    });
    return success(res, { plans });
  } catch (err) {
    next(err);
  }
}

async function getCurrentSubscription(req, res, next) {
  try {
    const subscription = await UserSubscription.findOne({
      where: { userId: req.user.id },
      include: [{ model: SubscriptionPlan, as: 'plan' }],
    });

    if (!subscription) return notFound(res, 'No active subscription found');
    return success(res, { subscription });
  } catch (err) {
    next(err);
  }
}

async function upgradePlan(req, res, next) {
  try {
    const { planId } = req.body;

    const plan = await SubscriptionPlan.findByPk(planId);
    if (!plan) return notFound(res, 'Plan not found');

    // Stripe integration placeholder
    return error(res, 'Payment integration coming soon. Please contact us to upgrade.', 501);
  } catch (err) {
    next(err);
  }
}

// Seed default plans on first use
async function seedPlans() {
  const plans = [
    { name: 'Free Trial', price: 0, monthlySearches: 10, savedLeadsLimit: 25, exportAccess: false, teamMembers: 1, advancedFilters: false },
    { name: 'Starter', price: 29, monthlySearches: 100, savedLeadsLimit: 200, exportAccess: false, teamMembers: 1, advancedFilters: false },
    { name: 'Pro', price: 79, monthlySearches: 500, savedLeadsLimit: 2000, exportAccess: true, teamMembers: 3, advancedFilters: true },
    { name: 'Agency', price: 199, monthlySearches: -1, savedLeadsLimit: -1, exportAccess: true, teamMembers: 10, advancedFilters: true },
  ];

  for (const plan of plans) {
    await SubscriptionPlan.findOrCreate({ where: { name: plan.name }, defaults: plan });
  }
}

module.exports = { getPlans, getCurrentSubscription, upgradePlan, seedPlans };
