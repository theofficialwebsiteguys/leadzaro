'use strict';

const { ServiceExpense } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const { toDateOnly } = require('../../core/domains/domainFacts');
const { normalizeExpenseInput } = require('./domainFields');

/**
 * What was actually paid for a domain or hosting plan (ADR 0009). Always
 * entered by hand — Namecheap's API has no payment history, and a current
 * catalog price is never recorded as something that was paid.
 */

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function expenseDto(expense) {
  return {
    id: expense.id,
    domainRecordId: expense.domainRecordId,
    hostingPlanId: expense.hostingPlanId,
    amountCents: expense.amountCents,
    currency: expense.currency,
    paidOn: toDateOnly(expense.paidOn),
    coversFrom: toDateOnly(expense.coversFrom),
    coversTo: toDateOnly(expense.coversTo),
    description: expense.description,
    source: 'manual',
    createdAt: expense.createdAt,
  };
}

async function subjectWhere(agencyOrganizationId, { domainRecordId, hostingPlanId }) {
  if (Boolean(domainRecordId) === Boolean(hostingPlanId)) throw invalid('A payment belongs to exactly one domain or hosting plan');
  if (domainRecordId) {
    const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { id: domainRecordId } });
    if (!record) throw invalid('Domain not found', 404);
    return { domainRecordId };
  }
  const plan = await access.hostingPlans.findOne(agencyOrganizationId, { where: { id: hostingPlanId } });
  if (!plan) throw invalid('Hosting plan not found', 404);
  return { hostingPlanId };
}

async function listExpenses(context, subject) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const where = await subjectWhere(agencyOrganizationId, subject);
  const rows = await access.expenses.findAll(agencyOrganizationId, { where, order: [['paidOn', 'DESC'], ['createdAt', 'DESC']] });
  return rows.map(expenseDto);
}

async function addExpense(context, subject, input, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const where = await subjectWhere(agencyOrganizationId, subject);
  const fields = normalizeExpenseInput(input || {});
  const expense = await ServiceExpense.create({
    ...fields, ...where, agencyOrganizationId, createdByUserId: actorUserId,
  });
  return expenseDto(expense);
}

async function deleteExpense(context, expenseId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const expense = await access.expenses.findOne(agencyOrganizationId, { where: { id: expenseId } });
  if (!expense) throw invalid('Payment not found', 404);
  await expense.destroy();
}

module.exports = {
  expenseDto, listExpenses, addExpense, deleteExpense,
};
