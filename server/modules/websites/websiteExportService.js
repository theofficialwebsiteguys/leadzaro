'use strict';

const { getWebsite, getVersion } = require('./websiteService');
const { buildGeneratedFiles } = require('./websiteCodegenService');
const { getWebsiteDomainForRequester } = require('../../core/authorization/clientVisibleModels');

/**
 * Employee-controlled full website export (current-phase-plan.md § 5,
 * slice 9 — roadmap outcomes "cancellation export" and "employee-
 * controlled full website export" share this one mechanism). Reuses
 * the exact same generator primitive every other Phase 6/7 action
 * already builds on (buildGeneratedFiles) — never a second, subtly
 * different code path that happens to also read the schema.
 *
 * Returned directly as one JSON document rather than a persisted
 * storage artifact: this is a point-in-time snapshot for immediate
 * consumption (handing a client their content at cancellation,
 * archiving before a domain transfer), not a recurring downloadable
 * asset that needs later re-access the way an uploaded File does.
 */
async function exportWebsite(context, projectId, versionId) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const files = await buildGeneratedFiles(context, website, version);
  const domain = await getWebsiteDomainForRequester(context, website.id);

  return {
    exportedAt: new Date().toISOString(),
    website: { id: website.id, name: website.name, domain: domain?.domain || null },
    version: {
      id: version.id, versionNumber: version.versionNumber, label: version.label, status: version.status,
    },
    files,
  };
}

module.exports = { exportWebsite };
