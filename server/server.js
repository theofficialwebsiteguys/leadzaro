require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./models');
const { seedPlans } = require('./controllers/subscriptionController');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    await sequelize.sync({ alter: process.env.NODE_ENV !== 'production' });
    console.log('✅ Database synced');

    // Seed subscription plans if not present
    await seedPlans();
    console.log('✅ Subscription plans ready');

    app.listen(PORT, () => {
      console.log(`🚀 Leadzaro API running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Server failed to start:', err.message);
    process.exit(1);
  }
}

start();
