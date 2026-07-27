'use strict';

const meetingService = require('./meetingService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const meetings = await meetingService.listMeetings(req.context, req.params.projectId);
    return success(res, { meetings });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function requestMeeting(req, res, next) {
  try {
    const meeting = await meetingService.requestMeeting({
      context: req.context, projectId: req.params.projectId, subject: req.body.subject, proposedSlots: req.body.proposedSlots, requestedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'meeting.requested', targetType: 'Meeting', targetId: meeting.id, req,
    });

    return success(res, { meeting }, 'Meeting requested', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function confirm(req, res, next) {
  try {
    const meeting = await meetingService.confirmMeeting({
      context: req.context, meetingId: req.params.meetingId, confirmedSlot: req.body.confirmedSlot, attendeeEmails: req.body.attendeeEmails,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'meeting.confirmed', targetType: 'Meeting', targetId: meeting.id, req,
    });

    return success(res, { meeting }, 'Meeting confirmed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function decline(req, res, next) {
  try {
    const meeting = await meetingService.declineMeeting({ context: req.context, meetingId: req.params.meetingId });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'meeting.declined', targetType: 'Meeting', targetId: meeting.id, req,
    });
    return success(res, { meeting }, 'Meeting declined');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function cancel(req, res, next) {
  try {
    const meeting = await meetingService.cancelMeeting({ context: req.context, meetingId: req.params.meetingId });
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'meeting.cancelled', targetType: 'Meeting', targetId: meeting.id, req,
    });
    return success(res, { meeting }, 'Meeting cancelled');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, requestMeeting, confirm, decline, cancel,
};
