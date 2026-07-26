'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { SYSTEM_USER_ID } = require('../core/constants/systemUser');

const SYSTEM_USER_EMAIL = 'system@internal.leadzaro.local';

/**
 * Phase 3 second slice (see docs/leadzaro/current-phase-plan.md § 7b).
 * Seeds a fixed-id, non-loginable "system" User used as the
 * `invitedByUserId` actor for system-initiated invitations that have no
 * human requester (currently: the client-user invite a Stripe webhook
 * triggers automatically on conversion). `isActive: false` blocks both
 * password login (authService.login) and any bearer-token use
 * (middleware/auth.js) even though its password hash is also random and
 * never recorded anywhere — belt and suspenders, not required for either
 * alone to be sufficient.
 *
 * A genuinely new pattern in this codebase (no prior seeded
 * "system"/service account existed), recorded here rather than added
 * silently, per CLAUDE.md rule 6.
 */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM "Users" WHERE id = :id LIMIT 1`,
      { replacements: { id: SYSTEM_USER_ID } }
    );
    if (existing.length) return;

    const now = new Date();
    const randomPasswordHash = await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10);

    await queryInterface.bulkInsert('Users', [{
      id: SYSTEM_USER_ID,
      name: 'Leadzaro System',
      email: SYSTEM_USER_EMAIL,
      passwordHash: randomPasswordHash,
      companyName: null,
      salespersonType: 'Custom / Other',
      role: 'user',
      isActive: false,
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('Users', { id: SYSTEM_USER_ID });
  },
};
