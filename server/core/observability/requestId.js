'use strict';

const crypto = require('node:crypto');

function requestId() {
  return (req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = { requestId };
