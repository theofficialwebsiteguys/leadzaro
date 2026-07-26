'use strict';

const webhookService = require('./webhookService');
const { success, error } = require('../../utils/response');

/**
 * `req.body` here is the raw Buffer (see app.js — this route is
 * deliberately mounted with express.raw() before the global JSON body
 * parser), never JSON-parsed, because Stripe's signature verification
 * must run against the exact bytes it signed.
 */
async function handleStripeWebhook(req, res, next) {
  try {
    await webhookService.processWebhook(req.body, req.headers['stripe-signature']);
    return success(res, {}, 'ok');
  } catch (err) {
    if (err.statusCode) return error(res, 'Webhook rejected', err.statusCode);
    next(err);
  }
}

module.exports = { handleStripeWebhook };
