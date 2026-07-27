'use strict';

const { SectionDefinition, DesignSystem } = require('../../models');
const {
  listSectionDefinitionsForGovernance, getSectionDefinitionForGovernance,
  listDesignSystemTemplatesForGovernance, getDesignSystemTemplateForGovernance,
} = require('../../core/authorization/clientVisibleModels');
const { DEFAULT_DESIGN_TOKENS } = require('../../core/websites/websiteCatalog');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function assertKnownStatus(status) {
  if (!SectionDefinition.LIBRARY_STATUSES.includes(status)) throw invalid(`Unknown status: ${status}`);
}

/**
 * Library governance (current-phase-plan.md § 2n): "curating/publishing/
 * deprecating platform- or agency-level DesignSystem/SectionDefinition
 * templates," builder.manage-gated (route-level). Every mutation here is
 * scoped to the caller's OWN agency's custom rows only — the platform-
 * provided base library (agencyOrganizationId: null) is migration-
 * seeded and never mutable through this API, matching how the starter
 * SectionDefinition library itself was seeded rather than created
 * through a governance endpoint that didn't exist yet.
 */
function listGovernedSectionDefinitions(context) {
  return listSectionDefinitionsForGovernance(context);
}

async function createSectionDefinition({
  context, name, componentKey, category, settingsSchema, variants, actorUserId,
}) {
  if (!name?.trim() || !componentKey?.trim() || !category?.trim()) {
    throw invalid('name, componentKey, and category are required');
  }
  return SectionDefinition.create({
    agencyOrganizationId: context.organization.id,
    name,
    componentKey,
    category,
    settingsSchema: settingsSchema || {},
    variants: variants || [],
    state: 'registered_custom',
    status: 'draft',
    isSystemDefined: false,
    createdByUserId: actorUserId,
  });
}

async function setSectionDefinitionStatus(context, sectionDefinitionId, status) {
  assertKnownStatus(status);
  const definition = await getSectionDefinitionForGovernance(context, sectionDefinitionId);
  if (!definition) throw invalid('Section definition not found', 404);
  await definition.update({ status });
  return definition;
}

function listGovernedDesignSystemTemplates(context) {
  return listDesignSystemTemplatesForGovernance(context);
}

async function createDesignSystemTemplate({ context, name, tokens, actorUserId }) {
  if (!name?.trim()) throw invalid('name is required');
  return DesignSystem.create({
    agencyOrganizationId: context.organization.id,
    organizationId: null,
    name,
    tokens: tokens || DEFAULT_DESIGN_TOKENS,
    isLibraryTemplate: true,
    status: 'draft',
    createdByUserId: actorUserId,
  });
}

async function setDesignSystemTemplateStatus(context, designSystemId, status) {
  assertKnownStatus(status);
  const template = await getDesignSystemTemplateForGovernance(context, designSystemId);
  if (!template) throw invalid('Design system template not found', 404);
  await template.update({ status });
  return template;
}

module.exports = {
  listGovernedSectionDefinitions,
  createSectionDefinition,
  setSectionDefinitionStatus,
  listGovernedDesignSystemTemplates,
  createDesignSystemTemplate,
  setDesignSystemTemplateStatus,
};
