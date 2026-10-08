'use strict';

const clientService = require('./clientService');
const contactService = require('../contacts/contactService');
const noteService = require('../notes/noteService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode, err.details || null);
  // Model-level validation (e.g. an invalid email on a contact) is a
  // user input problem, not a server fault.
  if (err.name === 'SequelizeValidationError') return error(res, err.errors?.[0]?.message || 'Invalid input', 422);
  next(err);
}

function audit(req, action, targetType, targetId, metadata) {
  return recordAudit({
    organizationId: req.context.organization.id, actorUserId: req.user.id, action, targetType, targetId, metadata, req,
  });
}

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      handleServiceError(err, res, next);
    }
  };
}

const list = handler(async (req, res) => {
  const result = await clientService.listClients(req.context, req.query || {}, req.user.id);
  return success(res, result);
});

const getById = handler(async (req, res) => {
  const detail = await clientService.getClientDetail(req.context, req.params.clientId, { tzOffset: req.query.tzOffset });
  return success(res, detail);
});

const create = handler(async (req, res) => {
  const {
    organization, domainMatch, createdFrom, openDeals,
  } = await clientService.createClient(req.context, req.body, req.user.id);
  await audit(req, createdFrom === 'lead' ? 'client.created_from_lead' : 'client.created', 'Organization', organization.id, { acquisitionSource: 'existing' });
  return success(res, {
    client: { id: organization.id, name: organization.name }, domainMatch, createdFrom, openDeals: openDeals || 0,
  }, 'Client added', 201);
});

const update = handler(async (req, res) => {
  const { organization, changed, domainMatch } = await clientService.updateClient(req.context, req.params.clientId, req.body, req.user.id);
  if (changed.length) await audit(req, 'client.updated', 'Organization', organization.id, { fields: changed });
  return success(res, { client: { id: organization.id, name: organization.name }, changed, domainMatch }, 'Client updated');
});

const assignManager = handler(async (req, res) => {
  const result = await clientService.assignManager(req.context, req.body?.clientIds, req.body?.accountManagerUserId);
  if (result.changed) await audit(req, 'client.manager_assigned', 'Organization', null, { count: result.changed, accountManagerUserId: req.body?.accountManagerUserId || null });
  return success(res, result, result.changed ? `Client manager updated for ${result.changed} client${result.changed === 1 ? '' : 's'}` : 'Nothing to change');
});

// ─── Contacts ────────────────────────────────────────────────────────────

const listContacts = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const contacts = await contactService.listContacts(req.context, organization);
  return success(res, { contacts });
});

const createContact = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const contact = await contactService.createContact({ context: req.context, organization, input: req.body });
  await audit(req, 'contact.created', 'Contact', contact.id);
  return success(res, { contact }, 'Contact added', 201);
});

const updateContact = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const contact = await contactService.updateContact({
    context: req.context, organization, contactId: req.params.contactId, input: req.body,
  });
  await audit(req, 'contact.updated', 'Contact', contact.id);
  return success(res, { contact }, 'Contact updated');
});

const archiveContact = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const contact = await contactService.archiveContact({ context: req.context, organization, contactId: req.params.contactId });
  await audit(req, 'contact.archived', 'Contact', contact.id);
  return success(res, { contact }, 'Contact removed');
});

// ─── Projects ────────────────────────────────────────────────────────────

const createProject = handler(async (req, res) => {
  const { project, domainMatch } = await clientService.createProject(req.context, req.params.clientId, req.body, req.user.id);
  await audit(req, 'project.created', 'Project', project.id, { clientId: req.params.clientId });
  return success(res, { project, domainMatch }, 'Project created', 201);
});

const updateProject = handler(async (req, res) => {
  const { project, changed, domainMatch } = await clientService.updateProject(req.context, req.params.clientId, req.params.projectId, req.body, req.user.id);
  if (changed.length) await audit(req, 'project.updated', 'Project', project.id, { fields: changed });
  return success(res, { project, domainMatch }, 'Project updated');
});

// ─── Files ───────────────────────────────────────────────────────────────

const uploadFile = handler(async (req, res) => {
  if (!req.file) return error(res, 'A file is required', 422);
  const file = await clientService.uploadClientFile({
    context: req.context,
    clientId: req.params.clientId,
    projectId: req.body.projectId || null,
    upload: req.file,
    uploadedByUserId: req.user.id,
  });
  await audit(req, 'file.uploaded', 'File', file.id, { scope: file.scope, originalName: file.originalName });
  return success(res, { file }, 'File uploaded', 201);
});

const downloadUrl = handler(async (req, res) => {
  const { url, expiresInSeconds } = await clientService.getClientFileDownloadUrl(req.context, req.params.clientId, req.params.fileId);
  return success(res, { url, expiresInSeconds });
});

const deleteFile = handler(async (req, res) => {
  const result = await clientService.deleteClientFile(req.context, req.params.clientId, req.params.fileId);
  await audit(req, 'file.deleted', 'File', req.params.fileId);
  return success(res, result, 'File deleted');
});

// ─── Notes ───────────────────────────────────────────────────────────────

const listNotes = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const notes = await noteService.listNotesForClient(req.context, organization);
  return success(res, { notes });
});

const createNote = handler(async (req, res) => {
  const organization = await clientService.getClientOrThrow(req.context, req.params.clientId);
  const note = await noteService.createNoteForClient({
    context: req.context, organization, projectId: req.body.projectId || null, body: req.body.body, authorUserId: req.user.id,
  });
  await audit(req, 'client_note.created', 'ClientNote', note.id);
  return success(res, { note }, 'Note added', 201);
});

module.exports = {
  list,
  getById,
  create,
  update,
  assignManager,
  listContacts,
  createContact,
  updateContact,
  archiveContact,
  createProject,
  updateProject,
  uploadFile,
  downloadUrl,
  deleteFile,
  listNotes,
  createNote,
};
