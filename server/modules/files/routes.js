'use strict';

const router = require('express').Router({ mergeParams: true });
const multer = require('multer');
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./fileController');

// In-memory buffer, not written to local disk — the buffer is handed
// straight to StorageProvider.upload(). 20MB cap to bound memory use per
// request; real size/type policy belongs to the storage provider/CDN
// once a real one is configured, not enforced twice here.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.list);
router.post('/', requirePermission('files.upload'), upload.single('file'), [
  body('scope').notEmpty(),
], validate, controller.upload);
router.get('/:fileId/signed-url', requirePermission('projects.view'), controller.getSignedUrl);
router.delete('/:fileId', requirePermission('files.manage'), controller.remove);

module.exports = router;
