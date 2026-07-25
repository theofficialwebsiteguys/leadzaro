'use strict';

// Creates the disposable test database (if it doesn't already exist) on
// the same Postgres server used for development. Run before `npm run
// migrate` with NODE_ENV=test, or via `npm run test:backend` prerequisites.

require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT, 10) || 5432;
  const user = process.env.DB_USER || 'leadzaro_user';
  const password = process.env.DB_PASS || 'leadzaro_pass';
  const testDbName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'leadzaro'}_test`;

  const client = new Client({ host, port, user, password, database: 'postgres' });
  await client.connect();

  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDbName]);
    if (rows.length === 0) {
      // Database identifiers cannot be parameterized; testDbName is
      // sourced from trusted local env config, not user input.
      await client.query(`CREATE DATABASE "${testDbName.replace(/"/g, '')}"`);
      console.log(`Created test database "${testDbName}".`);
    } else {
      console.log(`Test database "${testDbName}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed to set up test database:', err.message);
  process.exit(1);
});
