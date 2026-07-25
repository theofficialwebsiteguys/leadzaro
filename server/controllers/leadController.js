const { searchLeads, getPlaceDetails } = require('../services/leadSearchService');
const { Lead, SavedLead } = require('../models');
const { success, notFound } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { Op } = require('sequelize');

async function search(req, res, next) {
  try {
    const { keyword, location, radius, minRating, minReviews, demo } = req.query;
    const { page, limit } = getPagination(req.query);

    const results = await searchLeads({ keyword, location, radius, minRating, minReviews, demo, page, limit });

    // Mark which results the organization has already saved
    const savedLeads = await SavedLead.findAll({
      where: { organizationId: req.context.organization.id, archivedAt: null, deletedAt: null },
      include: [{ model: Lead, as: 'lead', attributes: ['googlePlaceId'] }],
    });
    const savedPlaceIds = new Set(savedLeads.map((sl) => sl.lead?.googlePlaceId).filter(Boolean));

    const enriched = results.items.map((item) => ({
      ...item,
      isSaved: savedPlaceIds.has(item.googlePlaceId || item.id),
    }));

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

module.exports = { search, getById, getAll, getContactDetails };
