'use strict';

const libraryGovernanceService = require('./libraryGovernanceService');
const { listDesignSystemTemplatesForBrowsing } = require('../../core/authorization/clientVisibleModels');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listSectionDefinitionsForGovernance(req, res, next) {
  try {
    const sectionDefinitions = await libraryGovernanceService.listGovernedSectionDefinitions(req.context);
    return success(res, { sectionDefinitions });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createSectionDefinition(req, res, next) {
  try {
    const sectionDefinition = await libraryGovernanceService.createSectionDefinition({
      context: req.context,
      name: req.body.name,
      componentKey: req.body.componentKey,
      category: req.body.category,
      settingsSchema: req.body.settingsSchema,
      variants: req.body.variants,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'library.section_definition_created',
      targetType: 'SectionDefinition',
      targetId: sectionDefinition.id,
      req,
    });

    return success(res, { sectionDefinition }, 'Section definition created', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function setSectionDefinitionStatus(req, res, next) {
  try {
    const sectionDefinition = await libraryGovernanceService.setSectionDefinitionStatus(req.context, req.params.id, req.body.status);

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'library.section_definition_status_changed',
      targetType: 'SectionDefinition',
      targetId: sectionDefinition.id,
      metadata: { status: sectionDefinition.status },
      req,
    });

    return success(res, { sectionDefinition }, 'Status updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listDesignSystemTemplates(req, res, next) {
  try {
    const designSystemTemplates = await listDesignSystemTemplatesForBrowsing(req.context);
    return success(res, { designSystemTemplates });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listDesignSystemTemplatesForGovernance(req, res, next) {
  try {
    const designSystemTemplates = await libraryGovernanceService.listGovernedDesignSystemTemplates(req.context);
    return success(res, { designSystemTemplates });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function createDesignSystemTemplate(req, res, next) {
  try {
    const designSystemTemplate = await libraryGovernanceService.createDesignSystemTemplate({
      context: req.context,
      name: req.body.name,
      tokens: req.body.tokens,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'library.design_system_template_created',
      targetType: 'DesignSystem',
      targetId: designSystemTemplate.id,
      req,
    });

    return success(res, { designSystemTemplate }, 'Design system template created', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function setDesignSystemTemplateStatus(req, res, next) {
  try {
    const designSystemTemplate = await libraryGovernanceService.setDesignSystemTemplateStatus(req.context, req.params.id, req.body.status);

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'library.design_system_template_status_changed',
      targetType: 'DesignSystem',
      targetId: designSystemTemplate.id,
      metadata: { status: designSystemTemplate.status },
      req,
    });

    return success(res, { designSystemTemplate }, 'Status updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listSectionDefinitionsForGovernance,
  createSectionDefinition,
  setSectionDefinitionStatus,
  listDesignSystemTemplates,
  listDesignSystemTemplatesForGovernance,
  createDesignSystemTemplate,
  setDesignSystemTemplateStatus,
};
