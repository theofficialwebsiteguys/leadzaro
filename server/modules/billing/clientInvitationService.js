'use strict';

const { Op } = require('sequelize');
const { Contact } = require('../../models');
const invitationService = require('../invitations/invitationService');
const { SYSTEM_USER_ID } = require('../../core/constants/systemUser');
const { env } = require('../../core/config/env');

const CLIENT_OWNER_ROLE_KEY = 'client_owner';

/**
 * Invites the new client organization's primary contact as a portal user,
 * once a conversion genuinely completes — never on the duplicate-webhook
 * no-op path, since duplicate delivery is routine here, not a rare edge
 * case, and would otherwise resend an invite on every retry. Called
 * unconditionally by both the webhook handler and manual-conversion
 * controller after every `convertOpportunityToClient` call; this
 * function itself is what gates on `alreadyConverted`, so the invariant
 * lives in exactly one place instead of being reimplemented at each call
 * site. See docs/leadzaro/current-phase-plan.md § 7b.
 *
 * Runs strictly after the conversion transaction has already committed
 * (the caller only reaches this after `convertOpportunityToClient`
 * resolves) — sending an email is an external side effect that must
 * never run inside a still-open DB transaction. A failed invite send
 * must never propagate: the conversion itself already succeeded and is
 * real, so this never throws — only records what happened.
 */
async function triggerClientInvitationIfNew(conversionResult) {
  if (conversionResult.alreadyConverted) return { skipped: true, reason: 'already_converted' };

  const { conversionAttempt } = conversionResult;
  // Leadzaro is internal-only (ADR 0011): paying clients are welcomed by the
  // salesperson, not sent a login, unless explicitly re-enabled.
  if (!env.CLIENT_PORTAL_AUTO_INVITE) {
    await conversionAttempt.update({ clientInvitationStatus: 'skipped_internal' });
    return { skipped: true, reason: 'internal_only' };
  }
  const organizationId = conversionAttempt.resultingClientOrganizationId;

  const contacts = await Contact.findAll({
    where: {
      organizationId, isPrimary: true, email: { [Op.ne]: null }, deletedAt: null,
    },
    order: [['createdAt', 'ASC']],
  });

  if (contacts.length === 0) {
    await conversionAttempt.update({ clientInvitationStatus: 'skipped_no_contact' });
    return { skipped: true, reason: 'no_primary_contact' };
  }

  const [contact, ...extraContacts] = contacts;

  try {
    const invitation = await invitationService.createInvitation({
      organizationId,
      email: contact.email,
      membershipType: 'client',
      roleKeys: [CLIENT_OWNER_ROLE_KEY],
      invitedByUserId: conversionAttempt.createdByUserId || SYSTEM_USER_ID,
    });

    const ambiguityNote = extraContacts.length
      ? `Multiple primary contacts found for this organization; invited the oldest (contactId=${contact.id}). Review the other ${extraContacts.length} candidate(s).`
      : null;

    await conversionAttempt.update({
      clientInvitationStatus: 'sent',
      invitationId: invitation.id,
      failureReason: ambiguityNote
        ? [conversionAttempt.failureReason, ambiguityNote].filter(Boolean).join(' | ')
        : conversionAttempt.failureReason,
    });
    return { invited: true, invitation };
  } catch (err) {
    await conversionAttempt.update({ clientInvitationStatus: 'failed' });
    return { invited: false, error: err.message };
  }
}

module.exports = { triggerClientInvitationIfNew };
