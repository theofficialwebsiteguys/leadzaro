const { SavedLead, Lead, LeadNote, OutreachActivity } = require('../models');
const { success, created, notFound, error } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { Op } = require('sequelize');

async function getSavedLeads(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority, search } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const leadWhere = {};
    if (search) {
      leadWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { city: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { rows, count } = await SavedLead.findAndCountAll({
      where,
      include: [{ model: Lead, as: 'lead', where: Object.keys(leadWhere).length ? leadWhere : undefined }],
      limit,
      offset,
      order: [['updatedAt', 'DESC']],
    });

    return success(res, formatPaginatedResponse(rows, count, page, limit));
  } catch (err) {
    next(err);
  }
}

async function saveLead(req, res, next) {
  try {
    const { leadData, status, priority, notes } = req.body;

    // Strip client-only fields that don't belong on the Lead model
    const leadDefaults = { ...leadData };
    delete leadDefaults.id;
    delete leadDefaults.isSaved;

    // Upsert the lead record
    let lead;
    if (leadDefaults.googlePlaceId) {
      [lead] = await Lead.findOrCreate({
        where: { googlePlaceId: leadDefaults.googlePlaceId },
        defaults: leadDefaults,
      });
    } else {
      lead = await Lead.create(leadDefaults);
    }

    const existing = await SavedLead.findOne({ where: { userId: req.user.id, leadId: lead.id } });
    if (existing) {
      return error(res, 'Lead already saved', 409);
    }

    const savedLead = await SavedLead.create({
      userId: req.user.id,
      leadId: lead.id,
      status: status || 'Saved',
      priority: priority || 'Medium',
      notes,
    });

    const result = await SavedLead.findByPk(savedLead.id, {
      include: [{ model: Lead, as: 'lead' }],
    });

    return created(res, { savedLead: result }, 'Lead saved successfully');
  } catch (err) {
    next(err);
  }
}

async function updateSavedLead(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const { status, priority, notes, lastContactedAt, nextFollowUpAt } = req.body;
    await savedLead.update({ status, priority, notes, lastContactedAt, nextFollowUpAt });

    const result = await SavedLead.findByPk(savedLead.id, {
      include: [{ model: Lead, as: 'lead' }],
    });

    return success(res, { savedLead: result }, 'Saved lead updated');
  } catch (err) {
    next(err);
  }
}

async function deleteSavedLead(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    await savedLead.destroy();
    return success(res, {}, 'Lead removed from saved list');
  } catch (err) {
    next(err);
  }
}

async function getSavedLeadDetail(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [
        { model: Lead, as: 'lead' },
      ],
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const notes = await LeadNote.findAll({
      where: { userId: req.user.id, leadId: savedLead.leadId },
      order: [['createdAt', 'DESC']],
    });

    const activities = await OutreachActivity.findAll({
      where: { userId: req.user.id, leadId: savedLead.leadId },
      order: [['createdAt', 'DESC']],
    });

    return success(res, { savedLead, notes, activities });
  } catch (err) {
    next(err);
  }
}

async function addNote(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const note = await LeadNote.create({
      userId: req.user.id,
      leadId: savedLead.leadId,
      content: req.body.content,
    });

    return created(res, { note }, 'Note added');
  } catch (err) {
    next(err);
  }
}

module.exports = { getSavedLeads, saveLead, updateSavedLead, deleteSavedLead, getSavedLeadDetail, addNote };
