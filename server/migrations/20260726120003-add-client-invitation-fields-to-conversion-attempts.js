'use strict';

/**
 * Phase 3 second slice (see docs/leadzaro/current-phase-plan.md § 7d).
 * `clientInvitationStatus` is an immutable record of the initial
 * automatic client-user invite attempt only ('sent' | 'skipped_no_contact'
 * | 'failed') — never updated afterward, and never a substitute for the
 * real, independently-evolving `Invitation.status`. `invitationId` links
 * straight to that row rather than requiring it be re-derived later.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ConversionAttempts', 'clientInvitationStatus', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('ConversionAttempts', 'invitationId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'Invitations', key: 'id' },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ConversionAttempts', 'invitationId');
    await queryInterface.removeColumn('ConversionAttempts', 'clientInvitationStatus');
  },
};
