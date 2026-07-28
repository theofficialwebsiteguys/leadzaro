'use strict';

const { WebsiteSeoAudit } = require('../../models');
const {
  listWebsiteSeoAuditsForRequester, getWebsiteSeoAuditByIdForRequester,
  listWebsitePageSeoSettingsForRequester, getWebsiteDomainForRequester, listSectionDefinitionsForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite, getVersion } = require('../websites/websiteService');
const { assertSeoEntitlement } = require('./seoEntitlementService');
const { runStructuralAudit } = require('../../core/seo/structuralAudit');
const { getSeoAuditAdapter } = require('../../core/integrations/seoAudit/seoAuditAdapter');

const LOW_PERFORMANCE_SCORE_THRESHOLD = 50;

function pagePath(route) {
  const trimmed = (route || '').replace(/^\//, '');
  return trimmed ? `/${trimmed}` : '/';
}

/**
 * Broken-link checking deliberately targets the website's own live
 * pages (built from the registered domain + this version's own page
 * routes), not arbitrary external links pulled from section content —
 * the current schema has no distinct "external link" field type to
 * extract those from. This checks a real, meaningful SEO concern
 * (are my own pages reachable to search engines) rather than a
 * concept the data doesn't model. Link/performance checks are skipped
 * entirely (structural findings only) when no domain is registered
 * yet — there is nothing live to check.
 */
async function runAudit({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  const version = await getVersion(context, projectId, versionId);

  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));
  const seoSettingsRows = await listWebsitePageSeoSettingsForRequester(context, { websiteId: website.id });
  const seoSettingsByPageId = new Map(seoSettingsRows.map((row) => [row.pageId, row]));

  const findings = runStructuralAudit(version.schema, sectionDefinitionsByKey, seoSettingsByPageId);

  const domainRecord = await getWebsiteDomainForRequester(context, website.id);
  if (domainRecord?.status === 'active') {
    const adapter = getSeoAuditAdapter();
    const pages = version.schema?.pages || [];
    const urls = pages.map((page) => `https://${domainRecord.domain}${pagePath(page.route)}`);

    const linkResults = urls.length ? await adapter.checkLinks(urls) : [];
    for (const result of linkResults) {
      if (result.status === 'ok') continue;
      findings.push({
        check: result.status === 'broken' ? 'broken_link' : 'inconclusive_link',
        severity: result.status === 'broken' ? 'error' : 'warning',
        message: `${result.url} was ${result.status === 'broken' ? 'unreachable' : 'not checkable'}`,
        url: result.url,
      });
    }

    const homeUrl = `https://${domainRecord.domain}/`;
    const perfResult = await adapter.checkPerformance(homeUrl);
    if (perfResult.status !== 'ok') {
      findings.push({
        check: perfResult.status === 'broken' ? 'performance_poor' : 'performance_inconclusive',
        severity: perfResult.status === 'broken' ? 'error' : 'warning',
        message: `Performance check for ${homeUrl} was ${perfResult.status}`,
        url: homeUrl,
      });
    } else if (perfResult.score != null && perfResult.score < LOW_PERFORMANCE_SCORE_THRESHOLD) {
      findings.push({
        check: 'performance_poor', severity: 'warning', message: `Performance score for ${homeUrl} is low (${perfResult.score})`, url: homeUrl,
      });
    }
  }

  return WebsiteSeoAudit.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    websiteVersionId: version.id,
    runByUserId: actorUserId,
    findings,
  });
}

async function listAudits(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  return listWebsiteSeoAuditsForRequester(context, { websiteId: website.id });
}

async function getAudit(context, projectId, auditId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  const audit = await getWebsiteSeoAuditByIdForRequester(context, auditId);
  if (!audit || audit.websiteId !== website.id) return null;
  return audit;
}

module.exports = { runAudit, listAudits, getAudit };
