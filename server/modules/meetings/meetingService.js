'use strict';

const { Meeting } = require('../../models');
const {
  getProjectByIdForRequester, listMeetingsForRequester, getMeetingByIdForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getGoogleCalendarAdapter } = require('../../core/integrations/googleCalendar/googleCalendarAdapter');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function assertProjectAccess(context, projectId) {
  const project = await getProjectByIdForRequester(context, projectId);
  if (!project) throw invalid('Project not found', 404);
  return project;
}

async function listMeetings(context, projectId) {
  const project = await assertProjectAccess(context, projectId);
  return listMeetingsForRequester(context, { projectId: project.id });
}

async function requestMeeting({
  context, projectId, subject, proposedSlots, requestedByUserId,
}) {
  const project = await assertProjectAccess(context, projectId);
  if (!subject?.trim()) throw invalid('subject is required');
  if (!Array.isArray(proposedSlots) || proposedSlots.length === 0) throw invalid('at least one proposed time slot is required');

  return Meeting.create({
    projectId: project.id,
    organizationId: project.organizationId,
    agencyOrganizationId: project.agencyOrganizationId,
    requestedByUserId,
    subject,
    proposedSlots,
    status: 'requested',
  });
}

/**
 * Confirms a meeting at one of its proposed slots and creates the real
 * calendar event (mock/disabled/live per GOOGLE_CALENDAR_PROVIDER — see
 * .env.example). A calendar failure never blocks the confirmation
 * itself; the meeting is still confirmed within Leadzaro even if the
 * real calendar event couldn't be created (matching
 * DisabledGoogleCalendarAdapter's "not configured" result, not a thrown
 * error, since the internal workflow doesn't depend on Calendar being
 * wired up).
 */
async function confirmMeeting({
  context, meetingId, confirmedSlot, attendeeEmails,
}) {
  const meeting = await getMeetingByIdForRequester(context, meetingId);
  if (!meeting) throw invalid('Meeting not found', 404);
  if (meeting.status !== 'requested') throw invalid('Only a requested meeting can be confirmed', 422);

  const adapter = getGoogleCalendarAdapter();
  const event = await adapter.createEvent({
    summary: meeting.subject,
    description: 'Leadzaro project meeting',
    attendeeEmails: attendeeEmails || [],
    startTime: confirmedSlot.start,
    endTime: confirmedSlot.end,
  });

  await meeting.update({
    status: 'confirmed',
    confirmedSlot,
    confirmedAt: new Date(),
    googleCalendarEventId: event.eventId,
  });
  return meeting;
}

async function declineMeeting({ context, meetingId }) {
  const meeting = await getMeetingByIdForRequester(context, meetingId);
  if (!meeting) throw invalid('Meeting not found', 404);
  await meeting.update({ status: 'declined' });
  return meeting;
}

async function cancelMeeting({ context, meetingId }) {
  const meeting = await getMeetingByIdForRequester(context, meetingId);
  if (!meeting) throw invalid('Meeting not found', 404);

  if (meeting.googleCalendarEventId) {
    const adapter = getGoogleCalendarAdapter();
    await adapter.cancelEvent(meeting.googleCalendarEventId);
  }

  await meeting.update({ status: 'cancelled' });
  return meeting;
}

module.exports = {
  listMeetings, requestMeeting, confirmMeeting, declineMeeting, cancelMeeting,
};
