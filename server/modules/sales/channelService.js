'use strict';

const crypto = require('node:crypto');
const { User } = require('../../models');
const { env } = require('../../core/config/env');
const { getEmailAdapter, isSmtpConfigured } = require('../../core/notifications/emailAdapter');
const { invalid } = require('./salesCommon');

/**
 * Outreach channels (ADR 0011). A channel is "connected" only when real
 * credentials are configured on the server — nothing is simulated. When
 * it is not connected, the workspace offers the external app instead
 * (mailto:/sms:/tel:) and the salesperson logs what happened by hand.
 */

function twilioConfigured() {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID));
}

function maskNumber(number) {
  if (!number) return null;
  return number.length > 4 ? `•••${number.slice(-4)}` : number;
}

function salesFromAddress() {
  const raw = env.SALES_EMAIL_FROM || env.EMAIL_FROM_ADDRESS;
  const match = /<([^>]+)>/.exec(raw);
  return (match ? match[1] : raw).trim();
}

async function channelStatus(ctx) {
  const user = await User.findByPk(ctx.userId, { attributes: ['id', 'phone', 'email', 'name'] });
  const twilio = twilioConfigured();
  const callbacks = Boolean(env.PUBLIC_API_BASE_URL);
  return {
    email: {
      connected: isSmtpConfigured(),
      provider: isSmtpConfigured() ? 'smtp' : null,
      from: isSmtpConfigured() ? salesFromAddress() : null,
      replyTo: user?.email || null,
      receivesReplies: false,
      tracksDelivery: false,
      setup: 'An administrator sets EMAIL_PROVIDER=smtp, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SALES_EMAIL_FROM on the server.',
      note: 'Replies go to your own inbox. Log them here with “Log a reply”.',
    },
    sms: {
      connected: twilio,
      provider: twilio ? 'twilio' : null,
      from: twilio ? maskNumber(env.TWILIO_FROM_NUMBER) || 'Messaging service' : null,
      receivesReplies: twilio && callbacks,
      tracksDelivery: twilio && callbacks,
      setup: 'An administrator sets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and PUBLIC_API_BASE_URL on the server, and points the Twilio number’s incoming-message webhook at /api/v1/sales/webhooks/twilio/inbound.',
      note: twilio && !callbacks ? 'Texts send, but delivery updates and replies need PUBLIC_API_BASE_URL.' : null,
    },
    call: {
      connected: twilio && Boolean(user?.phone),
      provider: twilio ? 'twilio' : null,
      needsYourPhone: twilio && !user?.phone,
      yourPhone: user?.phone || null,
      setup: twilio ? 'Add your own phone number in Settings → My account — Leadzaro rings you first, then connects the lead.' : 'Calling through Leadzaro uses the same Twilio setup as texting.',
      note: null,
    },
  };
}

// ---------------------------------------------------------------- email

async function sendEmail({
  to, subject, body, fromName, replyTo, activityId,
}) {
  if (!isSmtpConfigured()) throw invalid('Email sending is not connected. Use “Open in my email app” and log it, or ask an administrator to connect email.', 503);
  const address = salesFromAddress();
  const safeName = String(fromName || '').replace(/["<>\r\n]/g, '').trim();
  const result = await getEmailAdapter().send({
    to,
    subject,
    text: body,
    from: safeName ? `"${safeName}" <${address}>` : address,
    replyTo: replyTo || undefined,
    headers: activityId ? { 'X-Leadzaro-Activity': activityId } : undefined,
  });
  if (!result.delivered) return { ok: false, error: result.error || 'The email server did not accept the message.' };
  return { ok: true, providerMessageId: result.messageId || null, status: 'sent' };
}

// ---------------------------------------------------------------- twilio

function twilioAuthHeader() {
  return `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
}

async function twilioPost(resource, params) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/${resource}.json`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, error: `Could not reach Twilio: ${err.message}` };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: data.message ? `Twilio: ${data.message}` : `Twilio returned ${response.status}` };
  return { ok: true, data };
}

function callbackUrl(path) {
  return env.PUBLIC_API_BASE_URL ? `${env.PUBLIC_API_BASE_URL}${path}` : undefined;
}

async function sendSms({ to, body }) {
  if (!twilioConfigured()) throw invalid('Texting is not connected. Use “Open in my phone’s messages” and log it, or ask an administrator to connect Twilio.', 503);
  const result = await twilioPost('Messages', {
    To: to,
    From: env.TWILIO_MESSAGING_SERVICE_SID ? undefined : env.TWILIO_FROM_NUMBER,
    MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || undefined,
    Body: body,
    StatusCallback: callbackUrl('/api/v1/sales/webhooks/twilio/status'),
  });
  if (!result.ok) return result;
  return { ok: true, providerMessageId: result.data.sid, status: result.data.status || 'queued' };
}

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

/** Rings the salesperson first, then connects the lead, showing the business number as caller id. */
async function startBridgedCall({ repPhone, leadPhone }) {
  if (!twilioConfigured() || !env.TWILIO_FROM_NUMBER) throw invalid('Calling through Leadzaro is not connected. Use your phone and log the call.', 503);
  const twiml = `<Response><Say>Connecting your Leadzaro call.</Say><Dial callerId="${xmlEscape(env.TWILIO_FROM_NUMBER)}">${xmlEscape(leadPhone)}</Dial></Response>`;
  const result = await twilioPost('Calls', {
    To: repPhone,
    From: env.TWILIO_FROM_NUMBER,
    Twiml: twiml,
    StatusCallback: callbackUrl('/api/v1/sales/webhooks/twilio/status'),
  });
  if (!result.ok) return result;
  return { ok: true, providerMessageId: result.data.sid, status: result.data.status || 'queued' };
}

/** X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + sorted params)). */
function verifyTwilioSignature(path, params, signature) {
  if (!twilioConfigured() || !env.PUBLIC_API_BASE_URL || !signature) return false;
  const url = `${env.PUBLIC_API_BASE_URL}${path}`;
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(payload).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  channelStatus,
  twilioConfigured,
  sendEmail,
  sendSms,
  startBridgedCall,
  verifyTwilioSignature,
};
