'use strict';

/**
 * Found during the mandated final Phase 1 review: impersonation tokens
 * were bare JWTs with no backing AuthSession row, so there was no way to
 * revoke an in-progress impersonation before its natural expiry. Adding
 * `impersonatedByUserId` lets impersonation reuse the existing AuthSession
 * revocation machinery (an admin's "Sign Out" action against the
 * impersonated user's sessions now also kills any active impersonation of
 * them, for free).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('AuthSessions', 'impersonatedByUserId', {
      type: Sequelize.UUID,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('AuthSessions', 'impersonatedByUserId');
  },
};
