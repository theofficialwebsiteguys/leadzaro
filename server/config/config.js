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

// sequelize-cli config: mirrors server/config/database.js (the runtime
// connection used by server/models/index.js) so `sequelize-cli db:migrate`
// operates against the same database the app itself uses. Kept as a
// separate file because sequelize-cli requires a plain per-environment
// config object rather than a live Sequelize instance.
module.exports = {
  development: {
    ...base,
    database: process.env.DB_NAME || 'leadzaro',
  },
  test: {
    ...base,
    database: process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'leadzaro'}_test`,
  },
  production: {
    ...base,
    database: process.env.DB_NAME,
    logging: false,
  },
};
