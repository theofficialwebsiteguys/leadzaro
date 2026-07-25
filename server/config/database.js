require('dotenv').config();
const { Sequelize } = require('sequelize');
const config = require('./config.js')[process.env.NODE_ENV || 'development'];

// Built from the same per-environment config sequelize-cli uses (see
// config.js), so the running app and `sequelize-cli db:migrate` always
// agree on which database they're talking to — critical for
// NODE_ENV=test to actually hit the disposable test database rather than
// silently falling back to the development one.
const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      underscored: false,
      timestamps: true,
    },
  }
);

module.exports = sequelize;
