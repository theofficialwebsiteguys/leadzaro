const {
  searchLeads, getPlaceDetails, getPlaceFullDetails, getStaticMap,
} = require('../services/leadSearchService');
const { Lead, SavedLead } = require('../models');
const { annotateSearchResults } = require('../modules/sales/leadIntakeService');
const { success, notFound } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { Op } = require('sequelize');

async function search(req, res, next) {
  try {
    const { keyword, location, radius, minRating, minReviews, demo } = req.query;
    const { page, limit } = getPagination(req.query);

    const results = await searchLeads({ keyword, location, radius, minRating, minReviews, demo, page, limit });

    // Each result shows whether it is already a lead (whose, which stage),
    // an existing client, or a possible match on phone/website.
    const enriched = await annotateSearchResults(req.context.organization.id, results.items);

    return success(res, { ...results, items: enriched });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return notFound(res, 'Lead not found');

    const savedLead = await SavedLead.findOne({
      where: { organizationId: req.context.organization.id, leadId: lead.id, deletedAt: null },
    });

    return success(res, { lead: { ...lead.toJSON(), savedLead } });
  } catch (err) {
    next(err);
  }
}

async function getAll(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { category, city, hasWebsite } = req.query;

    const where = {};
    if (category) where.category = { [Op.iLike]: `%${category}%` };
    if (city) where.city = { [Op.iLike]: `%${city}%` };
    if (hasWebsite !== undefined) where.hasWebsite = hasWebsite === 'true';

    const { rows, count } = await Lead.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });
    return success(res, formatPaginatedResponse(rows, count, page, limit));
  } catch (err) {
    next(err);
  }
}

async function getContactDetails(req, res, next) {
  try {
    const { placeId } = req.params;
    const details = await getPlaceDetails(placeId);
    return success(res, { details });
  } catch (err) {
    next(err);
  }
}

/** Everything worth knowing before adding a result: phone, website, hours, status. */
async function getFullDetails(req, res, next) {
  try {
    const details = await getPlaceFullDetails(req.params.placeId);
    return success(res, { details });
  } catch (err) {
    if (/Places API error|timeout/i.test(err.message)) return res.status(502).json({ success: false, message: 'Google couldn’t load this business’s details right now.' });
    return next(err);
  }
}

/** The results map image, proxied so the Google key stays on the server. */
async function getMapImage(req, res, next) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const zoom = Number.parseInt(req.query.zoom, 10);
  const width = Number.parseInt(req.query.w, 10);
  const height = Number.parseInt(req.query.h, 10);
  const valid = Number.isFinite(lat) && lat >= -85 && lat <= 85 && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && zoom >= 2 && zoom <= 18 && width >= 100 && width <= 640 && height >= 100 && height <= 640;
  if (!valid) return res.status(422).json({ success: false, message: 'Invalid map request' });
  try {
    const image = await getStaticMap({
      lat, lng, zoom, width, height,
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(image);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    return next(err);
  }
}

module.exports = {
  search, getById, getAll, getContactDetails, getFullDetails, getMapImage,
};
