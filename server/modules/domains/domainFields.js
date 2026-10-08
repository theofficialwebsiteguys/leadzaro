'use strict';

const { DomainRecord, HostingPlan } = require('../../models');
const {
  invalid, text, url, cents, date, blank, longText,
} = require('../clients/clientFields');
const { sensitiveDataProblem } = require('../clients/sensitiveData');

/**
 * Validation for the manual fields of the domain registry (ADR 0009).
 * Every field is optional and partial updates are the norm. Blank means
 * "unknown" and is stored as NULL — an unknown amount is never 0.
 */

const PERIOD_MONTHS = [1, 3, 6, 12, 24, 36, 60, 120];

function periodMonths(field, value) {
  if (blank(value)) return null;
  const number = Number(value);
  if (!PERIOD_MONTHS.includes(number)) throw invalid(`${field} must be one of ${PERIOD_MONTHS.join(', ')} months`);
  return number;
}

function currency(field, value) {
  if (blank(value)) return null;
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw invalid(`${field} must be a 3-letter currency code such as USD`);
  return code;
}

function safeShortText(field, value, max) {
  const normalized = text(field, value, max);
  const problem = sensitiveDataProblem(normalized);
  if (problem) throw invalid(problem);
  return normalized;
}

/** true / false / null ("unknown"), also accepting "on"/"off"/"unknown" from forms. */
function tristate(field, value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') return null;
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false' || value === 'off') return false;
  throw invalid(`${field} must be on, off or unknown`);
}

const DOMAIN_FIELD_RULES = {
  registrarName: (v) => text('Registrar', v, 100),
  manualRegisteredOn: (v) => date('Registration date', v),
  manualExpiresOn: (v) => date('Expiration date', v),
  manualAutoRenew: (v) => tristate('Auto-renew', v),
  dnsProviderName: (v) => text('DNS provider', v, 100),
  renewalPriceCents: (v) => cents('Renewal amount', v),
  renewalCurrency: (v) => currency('Renewal currency', v),
  renewalPeriodMonths: (v) => periodMonths('Renewal period', v),
  nextChargeOn: (v) => date('Next charge date', v),
  clientChargeCents: (v) => cents('Amount charged to the client', v),
  clientChargePeriodMonths: (v) => periodMonths('Client charge period', v),
  notes: (v) => longText('Notes', v),
};

/** Only DomainRecord.MANUAL_FIELDS can be written — provider* and estimated* columns belong to the sync. */
function normalizeDomainManualInput(input) {
  const out = {};
  for (const field of DomainRecord.MANUAL_FIELDS) {
    if (input[field] !== undefined) out[field] = DOMAIN_FIELD_RULES[field](input[field]);
  }
  if (out.renewalPriceCents !== undefined && out.renewalPriceCents !== null && !out.renewalCurrency && input.renewalCurrency === undefined) out.renewalCurrency = 'USD';
  return out;
}

const PLAN_FIELD_RULES = {
  name: (v) => {
    const name = text('Plan name', v, 150);
    if (!name) throw invalid('Give the hosting plan a name');
    return name;
  },
  providerName: (v) => text('Hosting provider', v, 100),
  planName: (v) => text('Plan', v, 100),
  controlPanelUrl: (v) => url('Control panel link', v),
  costCents: (v) => cents('Plan cost', v),
  currency: (v) => currency('Currency', v) || 'USD',
  billingPeriodMonths: (v) => periodMonths('Billing period', v),
  expiresOn: (v) => date('Renewal/expiration date', v),
  nextChargeOn: (v) => date('Next charge date', v),
  autoRenew: (v) => tristate('Auto-renew', v),
  allocationMethod: (v) => {
    if (!HostingPlan.ALLOCATION_METHODS.includes(v)) throw invalid('Allocation must be equal, manual or none');
    return v;
  },
  notes: (v) => longText('Notes', v),
};

function normalizePlanInput(input, { requireName }) {
  const out = {};
  for (const [field, rule] of Object.entries(PLAN_FIELD_RULES)) {
    if (input[field] !== undefined || (field === 'name' && requireName)) out[field] = rule(input[field]);
  }
  return out;
}

function normalizeExpenseInput(input) {
  const amountCents = cents('Amount paid', input.amountCents);
  if (amountCents === null) throw invalid('Enter the amount that was actually paid');
  const paidOn = date('Date paid', input.paidOn);
  if (!paidOn) throw invalid('Enter the date it was paid');
  const coversFrom = date('Covers from', input.coversFrom);
  const coversTo = date('Covers to', input.coversTo);
  if (coversFrom && coversTo && coversTo < coversFrom) throw invalid('The covered period ends before it starts');
  return {
    amountCents,
    currency: currency('Currency', input.currency) || 'USD',
    paidOn,
    coversFrom,
    coversTo,
    description: safeShortText('Description', input.description, 200),
  };
}

module.exports = {
  PERIOD_MONTHS, normalizeDomainManualInput, normalizePlanInput, normalizeExpenseInput, tristate,
};
