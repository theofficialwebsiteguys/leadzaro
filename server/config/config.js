'use strict';

require('dotenv').config();

const base = {
  username: process.env.DB_USER || 'leadzaro_user',
  password: process.env.DB_PASS || 'leadzaro_pass',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  dialect: 'postgres',
  logging: false,
};

// Hosted Postgres (Heroku) supplies one DATABASE_URL — whose credentials
// Heroku can rotate — instead of separate DB_* values, and requires TLS.
// When it is set (outside tests), both the app and sequelize-cli use it.
const hosted = process.env.DATABASE_URL ? {
  use_env_variable: 'DATABASE_URL',
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' },
  },
} : null;

// sequelize-cli config: mirrors server/config/database.js (the runtime
// connection used by server/models/index.js) so `sequelize-cli db:migrate`
// operates against the same database the app itself uses. Kept as a
// separate file because sequelize-cli requires a plain per-environment
// config object rather than a live Sequelize instance.
module.exports = {
  development: hosted || {
    ...base,
    database: process.env.DB_NAME || 'leadzaro',
  },
  test: {
    ...base,
    database: process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'leadzaro'}_test`,
  },
  production: hosted || {
    ...base,
    database: process.env.DB_NAME,
    logging: false,
  },
};
