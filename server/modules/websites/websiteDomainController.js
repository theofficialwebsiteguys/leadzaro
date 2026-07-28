'use strict';

const websiteDomainService = require('./websiteDomainService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function get(req, res, next) {
  try {
    const domain = await websiteDomainService.getDomain(req.context, req.params.projectId);
    return success(res, { domain });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function checkAvailability(req, res, next) {
  try {
    const result = await websiteDomainService.checkAvailability(req.context, req.params.projectId, req.body.domain);
    return success(res, result);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function register(req, res, next) {
  try {
    const domain = await websiteDomainService.registerDomain({
      context: req.context, projectId: req.params.projectId, domain: req.body.domain, years: req.body.years, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.domain_registered',
      targetType: 'WebsiteDomain',
      targetId: domain.id,
      metadata: { projectId: req.params.projectId, domain: domain.domain, status: domain.status },
      req,
    });

    return success(res, { domain }, 'Domain registered');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateDns(req, res, next) {
  try {
    const domain = await websiteDomainService.updateDnsRecords({
      context: req.context, projectId: req.params.projectId, records: req.body.records,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.domain_dns_updated',
      targetType: 'WebsiteDomain',
      targetId: domain.id,
      metadata: { projectId: req.params.projectId, recordCount: (req.body.records || []).length },
      req,
    });

    return success(res, { domain }, 'DNS records updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function mapDocumentRoot(req, res, next) {
  try {
    const domain = await websiteDomainService.mapDocumentRoot({
      context: req.context, projectId: req.params.projectId, path: req.body.path,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.domain_document_root_mapped',
      targetType: 'WebsiteDomain',
      targetId: domain.id,
      metadata: { projectId: req.params.projectId, path: domain.documentRootPath },
      req,
    });

    return success(res, { domain }, 'Document root mapped');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function checkRenewal(req, res, next) {
  try {
    const result = await websiteDomainService.checkRenewal({ context: req.context, projectId: req.params.projectId });

    if (result.noticeSent) {
      await recordAudit({
        organizationId: req.context.organization.id,
        actorUserId: req.user.id,
        action: 'website.domain_renewal_notice_sent',
        targetType: 'WebsiteDomain',
        metadata: {
          projectId: req.params.projectId,
          notifiedEmployeeUserIds: result.notifiedEmployeeUserIds,
          notifiedClientUserIds: result.notifiedClientUserIds,
        },
        req,
      });
    }

    return success(res, result);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  get, checkAvailability, register, updateDns, mapDocumentRoot, checkRenewal,
};
