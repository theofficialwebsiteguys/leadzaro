'use strict';

const { WebsiteRedirect } = require('../../models');
const {
  listWebsiteRedirectsForRequester, getWebsiteRedirectByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('../websites/websiteService');
const { assertSeoEntitlement } = require('./seoEntitlementService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizePath(path) {
  const trimmed = (path || '').trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

async function listRedirects(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  return listWebsiteRedirectsForRequester(context, { websiteId: website.id });
}

async function createRedirect({
  context, projectId, fromPath, toPath, statusCode, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);

  const normalizedFrom = normalizePath(fromPath);
  const normalizedTo = normalizePath(toPath);
  if (!normalizedFrom || !normalizedTo) throw invalid('fromPath and toPath are required');
  if (normalizedFrom === normalizedTo) throw invalid('fromPath and toPath must differ');
  if (statusCode && !WebsiteRedirect.STATUS_CODES.includes(statusCode)) throw invalid(`Unsupported statusCode: ${statusCode}`);

  try {
    return await WebsiteRedirect.create({
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      fromPath: normalizedFrom,
      toPath: normalizedTo,
      statusCode: statusCode || 301,
      createdByUserId: actorUserId,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw invalid(`A redirect from ${normalizedFrom} already exists for this website`, 409);
    }
    throw err;
  }
}

async function deleteRedirect(context, projectId, redirectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);

  const redirect = await getWebsiteRedirectByIdForRequester(context, redirectId);
  if (!redirect || redirect.websiteId !== website.id) throw invalid('Redirect not found', 404);

  await redirect.destroy();
  return redirect;
}

module.exports = { listRedirects, createRedirect, deleteRedirect };
