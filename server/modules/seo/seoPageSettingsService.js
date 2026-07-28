'use strict';

const {
  listWebsitePageSeoSettingsForRequester, getWebsitePageSeoSettingsForRequester, upsertWebsitePageSeoSettingsForRequester,
  getWebsiteDomainForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { WebsitePageSeoSettings } = require('../../models');
const { getWebsite } = require('../websites/websiteService');
const { assertSeoEntitlement } = require('./seoEntitlementService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function livePageIds(website) {
  return new Set((website.draftSchema?.pages || []).map((page) => page.id));
}

async function getPageSettings(context, projectId, pageId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  return getWebsitePageSeoSettingsForRequester(context, website.id, pageId);
}

/**
 * Always iterates the live draft schema's own page list and left-joins
 * against WebsitePageSeoSettings (current-phase-plan.md § 2b) — never
 * lists settings rows independently, so a row for a since-deleted page
 * is simply never surfaced, with no explicit cleanup needed.
 */
async function listPageSettings(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);

  const pages = website.draftSchema?.pages || [];
  const settingsRows = await listWebsitePageSeoSettingsForRequester(context, { websiteId: website.id });
  const settingsByPageId = new Map(settingsRows.map((row) => [row.pageId, row]));

  return pages.map((page) => ({
    pageId: page.id,
    route: page.route,
    title: page.title,
    seoSettings: settingsByPageId.get(page.id) || null,
  }));
}

async function upsertPageSettings({
  context, projectId, pageId, metaTitle, metaDescription, canonicalUrl, robotsDirective, schemaJson, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);

  if (!livePageIds(website).has(pageId)) throw invalid('No such page in the current draft', 404);
  if (robotsDirective && !WebsitePageSeoSettings.ROBOTS_DIRECTIVES.includes(robotsDirective)) {
    throw invalid(`Unknown robotsDirective: ${robotsDirective}`);
  }

  const fields = { updatedByUserId: actorUserId };
  if (metaTitle !== undefined) fields.metaTitle = metaTitle || null;
  if (metaDescription !== undefined) fields.metaDescription = metaDescription || null;
  if (canonicalUrl !== undefined) fields.canonicalUrl = canonicalUrl || null;
  if (robotsDirective !== undefined) fields.robotsDirective = robotsDirective;
  if (schemaJson !== undefined) fields.schemaJson = schemaJson || null;

  return upsertWebsitePageSeoSettingsForRequester(context, website, pageId, fields);
}

function pagePath(route) {
  const trimmed = (route || '').replace(/^\//, '');
  return trimmed ? `/${trimmed}` : '/';
}

/**
 * Sitemap/robots.txt are generated on-demand, never persisted (§ 2b —
 * the same "nothing stores a stale copy" precedent as every other
 * generated artifact in this codebase). Employee-only: building an
 * absolute URL needs the registered domain, and WebsiteDomain itself
 * is employee-only (Phase 7 § 2d) — rather than carve a client-visible
 * exception into that established boundary, sitemap/robots.txt
 * generation stays alongside it as an employee-side action, matching
 * how these files are realistically served as part of a deployed
 * bundle rather than fetched live through an authenticated client API.
 */
async function generateSitemap(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  const domainRecord = await getWebsiteDomainForRequester(context, website.id);
  if (!domainRecord || domainRecord.status !== 'active') {
    throw invalid('A registered, active domain is required to generate a sitemap', 422);
  }

  const pages = website.draftSchema?.pages || [];
  const settingsRows = await listWebsitePageSeoSettingsForRequester(context, { websiteId: website.id });
  const settingsByPageId = new Map(settingsRows.map((row) => [row.pageId, row]));

  const urls = pages
    .filter((page) => {
      const settings = settingsByPageId.get(page.id);
      return !settings?.robotsDirective?.startsWith('noindex');
    })
    .map((page) => `  <url><loc>https://${domainRecord.domain}${pagePath(page.route)}</loc></url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function generateRobotsTxt(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  const domainRecord = await getWebsiteDomainForRequester(context, website.id);

  const sitemapLine = domainRecord?.status === 'active' ? `Sitemap: https://${domainRecord.domain}/sitemap.xml\n` : '';
  return `User-agent: *\nAllow: /\n${sitemapLine}`;
}

module.exports = {
  getPageSettings, listPageSettings, upsertPageSettings, generateSitemap, generateRobotsTxt,
};
