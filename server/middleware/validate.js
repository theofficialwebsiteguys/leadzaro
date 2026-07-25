const { validationResult } = require('express-validator');
const { error } = require('../utils/response');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => `${e.path}: ${e.msg}`);
    return error(res, 'Validation failed', 422, details);
  }
  next();
}

module.exports = { validate };
