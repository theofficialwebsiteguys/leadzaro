require('dotenv').config();
const { validateEnv, env } = require('./core/config/env');

validateEnv();

const app = require('./app');
const { sequelize } = require('./models');
const { seedPlans } = require('./controllers/subscriptionController');

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    const [tables] = await sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SequelizeMeta'"
    );
    if (tables.length === 0) {
      console.error('❌ No migrations have been run against this database yet.');
      console.error('   Run `npm run migrate` (and `npm run db:seed` if applicable), then start the server again.');
      process.exit(1);
    }

    // Seed subscription plans if not present (legacy, idempotent reference data)
    await seedPlans();
    console.log('✅ Subscription plans ready');

    app.listen(env.PORT, () => {
      console.log(`🚀 Leadzaro API running at http://localhost:${env.PORT}`);
      // Daily Namecheap sync + renewal reminders (ADR 0009); off when JOBS_ENABLED=false.
      require('./core/jobs/scheduler').startScheduler();
    });
  } catch (err) {
    console.error('❌ Server failed to start:', err.message);
    process.exit(1);
  }
}

start();
