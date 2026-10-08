'use strict';

const { Op } = require('sequelize');
const { sequelize, Contact } = require('../../models');
const { listContactsForRequester, getContactByIdForRequester } = require('../../core/authorization/clientVisibleModels');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Blank form fields arrive as '' — stored as NULL so "not provided" is
// never confused with a real (empty) value, and so '' never trips the
// model's isEmail validator.
function blankToNull(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function pickContactFields(input) {
  const fields = {};
  for (const key of ['name', 'title', 'email', 'phone']) {
    const value = blankToNull(input[key]);
    if (value !== undefined) fields[key] = value;
  }
  if (input.isPrimary !== undefined) fields.isPrimary = Boolean(input.isPrimary);
  return fields;
}

/**
 * A client has at most one primary contact: marking one primary clears
 * the flag on the others, in the same transaction.
 */
async function clearOtherPrimaries(organizationId, keepContactId, transaction) {
  await Contact.update(
    { isPrimary: false },
    { where: { organizationId, isPrimary: true, id: { [Op.ne]: keepContactId } }, transaction },
  );
}

// `organization` must already be resolved through
// getClientOrganizationForRequester (tenant + client-type check).
function listContacts(context, organization) {
  return listContactsForRequester(context, { organizationId: organization.id });
}

async function createContact({ context, organization, input }) {
  const fields = pickContactFields(input);
  if (!fields.name) throw invalid('Contact name is required');

  const existingCount = await Contact.count({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null } });
  // The first contact added to a client becomes primary unless told otherwise.
  const isPrimary = fields.isPrimary ?? existingCount === 0;

  return sequelize.transaction(async (transaction) => {
    const contact = await Contact.create({
      ...fields,
      isPrimary,
      organizationId: organization.id,
      agencyOrganizationId: context.organization.id,
      source: 'manual',
    }, { transaction });
    if (isPrimary) await clearOtherPrimaries(organization.id, contact.id, transaction);
    return contact;
  });
}

async function getOwnedContact(context, organization, contactId) {
  const contact = await getContactByIdForRequester(context, contactId);
  if (!contact || contact.organizationId !== organization.id || contact.archivedAt || contact.deletedAt) {
    throw invalid('Contact not found', 404);
  }
  return contact;
}

async function updateContact({
  context, organization, contactId, input,
}) {
  const contact = await getOwnedContact(context, organization, contactId);
  const fields = pickContactFields(input);
  if (fields.name === null) throw invalid('Contact name cannot be empty');

  return sequelize.transaction(async (transaction) => {
    await contact.update(fields, { transaction });
    if (fields.isPrimary) await clearOtherPrimaries(organization.id, contact.id, transaction);
    return contact;
  });
}

async function archiveContact({ context, organization, contactId }) {
  const contact = await getOwnedContact(context, organization, contactId);
  await contact.update({ archivedAt: new Date(), isPrimary: false });
  return contact;
}

module.exports = {
  listContacts, createContact, updateContact, archiveContact,
};
