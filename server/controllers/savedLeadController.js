const { SavedLead, Lead, LeadNote, OutreachActivity } = require('../models');
const { recordAudit } = require('../core/audit/auditService');
const { success, created, notFound, error } = require('../utils/response');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { Op } = require('sequelize');

async function getSavedLeads(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { status, priority, search, archived } = req.query;

    const where = { organizationId: req.context.organization.id, deletedAt: null };
    where.archivedAt = archived === 'true' ? { [Op.ne]: null } : null;
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
    const organizationId = req.context.organization.id;

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

    const existing = await SavedLead.findOne({
      where: { organizationId, leadId: lead.id, archivedAt: null, deletedAt: null },
    });
    if (existing) {
      return error(res, 'Lead already saved', 409);
    }

    const savedLead = await SavedLead.create({
      organizationId,
      userId: req.user.id,
      leadId: lead.id,
      status: status || 'Saved',
      priority: priority || 'Medium',
      notes,
    });

    await recordAudit({
      organizationId, actorUserId: req.user.id, action: 'saved_lead.created', targetType: 'SavedLead', targetId: savedLead.id, req,
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
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const { status, priority, notes, lastContactedAt, nextFollowUpAt } = req.body;
    await savedLead.update({ status, priority, notes, lastContactedAt, nextFollowUpAt });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'saved_lead.updated',
      targetType: 'SavedLead',
      targetId: savedLead.id,
      metadata: { status, priority },
      req,
    });

    const result = await SavedLead.findByPk(savedLead.id, {
      include: [{ model: Lead, as: 'lead' }],
    });

    return success(res, { savedLead: result }, 'Saved lead updated');
  } catch (err) {
    next(err);
  }
}

async function archiveSavedLead(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    await savedLead.update({ archivedAt: new Date() });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'saved_lead.archived', targetType: 'SavedLead', targetId: savedLead.id, req,
    });

    return success(res, {}, 'Lead archived');
  } catch (err) {
    next(err);
  }
}

async function restoreSavedLead(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');
    if (!savedLead.archivedAt) return error(res, 'Saved lead is not archived', 400);

    const conflict = await SavedLead.findOne({
      where: {
        organizationId: req.context.organization.id, leadId: savedLead.leadId, archivedAt: null, deletedAt: null, id: { [Op.ne]: savedLead.id },
      },
    });
    if (conflict) {
      return error(res, 'This business already has an active saved lead in your organization', 409);
    }

    await savedLead.update({ archivedAt: null });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'saved_lead.restored', targetType: 'SavedLead', targetId: savedLead.id, req,
    });

    return success(res, {}, 'Lead restored');
  } catch (err) {
    next(err);
  }
}

async function getSavedLeadDetail(req, res, next) {
  try {
    const savedLead = await SavedLead.findOne({
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
      include: [
        { model: Lead, as: 'lead' },
      ],
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const notes = await LeadNote.findAll({
      where: { organizationId: req.context.organization.id, leadId: savedLead.leadId },
      order: [['createdAt', 'DESC']],
    });

    const activities = await OutreachActivity.findAll({
      where: { organizationId: req.context.organization.id, leadId: savedLead.leadId, deletedAt: null },
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
      where: { id: req.params.id, organizationId: req.context.organization.id, deletedAt: null },
    });
    if (!savedLead) return notFound(res, 'Saved lead not found');

    const note = await LeadNote.create({
      organizationId: req.context.organization.id,
      userId: req.user.id,
      leadId: savedLead.leadId,
      content: req.body.content,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'lead_note.created', targetType: 'LeadNote', targetId: note.id, req,
    });

    return created(res, { note }, 'Note added');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSavedLeads, saveLead, updateSavedLead, archiveSavedLead, restoreSavedLead, getSavedLeadDetail, addNote,
};
