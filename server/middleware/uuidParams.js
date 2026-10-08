'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Answers 404 for route ids that aren't UUIDs, instead of letting Postgres
 * reject them with a 500 ("invalid input syntax for type uuid").
 */
function requireUuidParams(router, names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (!UUID_PATTERN.test(value)) return res.status(404).json({ success: false, message: 'Not found' });
      return next();
    });
  }
}

module.exports = { requireUuidParams, UUID_PATTERN };
