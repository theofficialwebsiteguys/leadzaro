'use strict';

const router = require('express').Router();
const multer = require('multer');
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireEmployeeMembership } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./clientController');
const domainController = require('../domains/domainController');
const { requireUuidParams } = require('../../middleware/uuidParams');

requireUuidParams(router, ['linkId']);

// Same in-memory, 20MB-capped handling as the project files route.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// The client hub carries internal costs, access notes and team notes:
// agency team members only, on top of the usual permission checks.
router.use(authenticate, resolveContext(), requireEmployeeMembership());

router.get('/', requirePermission('projects.view'), controller.list);
router.post('/', requirePermission('projects.manage'), [
  body('name').isString().trim().notEmpty().withMessage('Client name is required'),
], validate, controller.create);
router.post('/assign-manager', requirePermission('projects.manage'), controller.assignManager);
router.get('/:clientId', requirePermission('projects.view'), controller.getById);
router.patch('/:clientId', requirePermission('projects.manage'), controller.update);

router.get('/:clientId/contacts', requirePermission('projects.view'), controller.listContacts);
router.post('/:clientId/contacts', requirePermission('projects.manage'), [
  body('name').isString().trim().notEmpty().withMessage('Contact name is required'),
], validate, controller.createContact);
router.patch('/:clientId/contacts/:contactId', requirePermission('projects.manage'), controller.updateContact);
router.post('/:clientId/contacts/:contactId/archive', requirePermission('projects.manage'), controller.archiveContact);

router.post('/:clientId/projects', requirePermission('projects.manage'), [
  body('name').isString().trim().notEmpty().withMessage('Project name is required'),
], validate, controller.createProject);
router.patch('/:clientId/projects/:projectId', requirePermission('projects.manage'), controller.updateProject);

router.post('/:clientId/files', requirePermission('files.upload'), upload.single('file'), controller.uploadFile);
router.get('/:clientId/files/:fileId/download-url', requirePermission('projects.view'), controller.downloadUrl);
router.delete('/:clientId/files/:fileId', requirePermission('files.manage'), controller.deleteFile);

// Domains & Hosting (ADR 0009).
router.get('/:clientId/domains', requirePermission('projects.view'), domainController.clientDomains);
router.post('/:clientId/domains', requirePermission('projects.manage'), domainController.addClientDomain);
router.patch('/:clientId/domain-links/:linkId', requirePermission('projects.manage'), domainController.updateClientDomainLink);
router.delete('/:clientId/domain-links/:linkId', requirePermission('projects.manage'), domainController.removeClientDomainLink);

router.get('/:clientId/notes', requirePermission('projects.view'), controller.listNotes);
router.post('/:clientId/notes', requirePermission('projects.manage'), [
  body('body').isString().trim().notEmpty(),
], validate, controller.createNote);

module.exports = router;
