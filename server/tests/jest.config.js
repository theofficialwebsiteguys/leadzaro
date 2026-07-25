'use strict';

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/server/tests/**/*.test.js'],
  globalSetup: '<rootDir>/server/tests/helpers/globalSetup.js',
  testTimeout: 20000,
  verbose: true,
};
