'use strict';

const router = require('express').Router({ mergeParams: true });
const { body, query } = require('express-validator');
const { authenticate } = require('../../middleware/auth');
const { resolveContext, requirePermission, requireAnyPermission } = require('../../core/authorization/context');
const { validate } = require('../../middleware/validate');
const controller = require('./websiteController');
const editorAssignmentController = require('./websiteEditorAssignmentController');
const commentController = require('./websiteCommentController');
const collaborationController = require('./websiteCollaborationController');
const repositoryController = require('./websiteRepositoryController');
const codegenController = require('./websiteCodegenController');
const deploymentController = require('./websiteDeploymentController');
const developmentHandoffController = require('./websiteDevelopmentHandoffController');
const mergeBackController = require('./websiteMergeBackController');
const domainController = require('./websiteDomainController');
const productionDeployController = require('./productionDeployController');
const publicFormTriageController = require('./websitePublicFormTriageController');
const analyticsController = require('./websiteAnalyticsController');
const exportController = require('./websiteExportController');
const seoPageSettingsController = require('./seoPageSettingsController');
const seoRedirectController = require('./seoRedirectController');
const seoAuditController = require('./seoAuditController');

router.use(authenticate, resolveContext());

router.get('/', requirePermission('projects.view'), controller.getWebsite);
router.post('/', requirePermission('builder.edit'), [
  body('name').notEmpty(),
  body('startingMode').notEmpty(),
], validate, controller.createWebsite);
router.patch('/draft', requirePermission('builder.edit'), controller.updateDraftSchema);

router.get('/versions', requirePermission('projects.view'), controller.listVersions);
// /versions/compare must be registered before the /versions/:versionId
// wildcard GET route below — Express matches in registration order, and
// :versionId would otherwise swallow the literal "compare" segment.
router.get('/versions/compare', requirePermission('projects.view'), [
  query('from').notEmpty(),
  query('to').notEmpty(),
], validate, controller.compareVersions);
router.get('/versions/:versionId', requirePermission('projects.view'), controller.getVersion);
router.post('/versions', requirePermission('builder.edit'), controller.createCheckpoint);
router.post('/versions/autosave', requirePermission('builder.edit'), controller.createAutosave);
router.post('/versions/:versionId/restore', requirePermission('builder.edit'), controller.restoreVersion);
router.post('/versions/:versionId/publish', requirePermission('builder.publish'), controller.publishVersion);

router.post('/forms/test-submit', requirePermission('builder.edit'), [
  body('pageId').notEmpty(),
  body('sectionId').notEmpty(),
], validate, controller.submitTestForm);

router.get('/editors', requirePermission('builder.manage'), editorAssignmentController.list);
router.post('/editors', requirePermission('builder.manage'), [
  body('userId').notEmpty(),
  body('editingLevel').notEmpty(),
], validate, editorAssignmentController.create);
router.delete('/editors/:assignmentId', requirePermission('builder.manage'), editorAssignmentController.remove);

router.get('/comments', requirePermission('projects.view'), commentController.list);
router.post('/comments', requirePermission('builder.edit'), [
  body('anchorKey').notEmpty(),
  body('body').notEmpty(),
], validate, commentController.create);
router.post('/comments/:commentId/resolve', requirePermission('builder.edit'), commentController.resolve);

router.get('/locks', requirePermission('projects.view'), collaborationController.listLocks);
router.post('/locks', requirePermission('builder.edit'), [
  body('sectionKey').notEmpty(),
], validate, collaborationController.acquireLock);
router.delete('/locks/:lockId', requirePermission('builder.edit'), collaborationController.releaseLock);

router.get('/presence', requirePermission('projects.view'), collaborationController.listPresence);
router.post('/presence', requirePermission('builder.edit'), collaborationController.heartbeatPresence);

router.get('/repository', requirePermission('builder.edit'), repositoryController.get);
router.post('/repository', requirePermission('builder.develop'), repositoryController.provision);

router.post('/versions/:versionId/generate', requirePermission('builder.develop'), codegenController.generate);

router.get('/deployments', requirePermission('builder.develop'), deploymentController.listDeployments);
router.post('/versions/:versionId/deploy-preview', requirePermission('builder.develop'), deploymentController.deployPreview);

router.get('/development-handoffs', requirePermission('builder.develop'), developmentHandoffController.list);
router.post('/versions/:versionId/promote-to-development', requirePermission('builder.develop'), developmentHandoffController.promote);

router.post('/merge-back', requirePermission('builder.develop'), [
  body('branchName').notEmpty(),
], validate, mergeBackController.mergeBack);

router.get('/domain', requirePermission('builder.manage'), domainController.get);
router.post('/domain/check-availability', requirePermission('builder.manage'), [
  body('domain').notEmpty(),
], validate, domainController.checkAvailability);
router.post('/domain/register', requirePermission('builder.manage'), [
  body('domain').notEmpty(),
], validate, domainController.register);
router.post('/domain/dns-records', requirePermission('builder.manage'), [
  body('records').isArray(),
], validate, domainController.updateDns);
router.post('/domain/map-document-root', requirePermission('builder.manage'), [
  body('path').notEmpty(),
], validate, domainController.mapDocumentRoot);
router.post('/domain/check-renewal', requirePermission('builder.manage'), domainController.checkRenewal);
router.post('/domain/initiate-transfer', requirePermission('builder.manage'), domainController.initiateTransfer);

router.get('/production-deployments', requirePermission('builder.manage'), productionDeployController.listDeployments);
// /production-deployments/current must be registered before the
// /production-deployments/:deploymentId wildcard below — same ordering
// reason as /versions/compare above.
router.get('/production-deployments/current', requirePermission('builder.manage'), productionDeployController.getCurrentLive);
router.get('/production-deployments/:deploymentId', requirePermission('builder.manage'), productionDeployController.getDeployment);
router.post('/versions/:versionId/deploy-production', requirePermission('builder.manage'), productionDeployController.deploy);

router.get('/public-form-submissions', requirePermission('builder.manage'), publicFormTriageController.list);
router.get('/public-form-submissions/:submissionId', requirePermission('builder.manage'), publicFormTriageController.get);
router.post('/public-form-submissions/:submissionId/convert', requirePermission('builder.manage'), publicFormTriageController.convert);
router.post('/public-form-submissions/:submissionId/status', requirePermission('builder.manage'), [
  body('status').isIn(['discarded', 'spam']),
], validate, publicFormTriageController.discard);

router.get('/analytics/events', requirePermission('builder.manage'), analyticsController.listEvents);
router.get('/analytics/summary', requirePermission('projects.view'), analyticsController.getSummary);
router.post('/analytics/google-analytics', requirePermission('builder.manage'), [
  body('measurementId').optional({ values: 'falsy' }).isLength({ max: 50 }),
], validate, analyticsController.setGoogleAnalyticsMeasurementId);

router.get('/versions/:versionId/export', requirePermission('builder.manage'), exportController.exportWebsite);

router.get('/seo/pages', requirePermission('projects.view'), seoPageSettingsController.list);
router.get('/seo/pages/:pageId', requirePermission('projects.view'), seoPageSettingsController.get);
router.put('/seo/pages/:pageId', requireAnyPermission(['builder.edit', 'builder.manage']), [
  body('metaTitle').optional({ values: 'falsy' }).isLength({ max: 255 }),
  body('metaDescription').optional({ values: 'falsy' }).isLength({ max: 500 }),
  body('canonicalUrl').optional({ values: 'falsy' }).isLength({ max: 500 }),
  body('robotsDirective').optional({ values: 'falsy' }).isLength({ max: 20 }),
], validate, seoPageSettingsController.upsert);
router.get('/seo/sitemap.xml', requirePermission('builder.manage'), seoPageSettingsController.sitemap);
router.get('/seo/robots.txt', requirePermission('builder.manage'), seoPageSettingsController.robots);

router.get('/seo/redirects', requirePermission('builder.manage'), seoRedirectController.list);
router.post('/seo/redirects', requirePermission('builder.manage'), [
  body('fromPath').notEmpty(),
  body('toPath').notEmpty(),
  body('statusCode').optional().isInt(),
], validate, seoRedirectController.create);
router.delete('/seo/redirects/:redirectId', requirePermission('builder.manage'), seoRedirectController.remove);

router.post('/seo/audits', requirePermission('builder.manage'), [
  body('versionId').notEmpty(),
], validate, seoAuditController.run);
router.get('/seo/audits', requirePermission('builder.manage'), seoAuditController.list);
router.get('/seo/audits/:auditId', requirePermission('builder.manage'), seoAuditController.get);

module.exports = router;
