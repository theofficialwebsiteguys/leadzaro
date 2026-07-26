'use strict';

const crypto = require('node:crypto');
const { CHANNEL_DEFAULTS } = require('../core/projects/projectCatalog');

/**
 * Seeds the default channel set (see projectCatalog.js) for every
 * Project that doesn't have one yet — every Project created by the
 * Phase-4-opening backfill (20260727120002) predates this migration, so
 * none of them have channels. Idempotent per (projectId, key), safe to
 * re-run.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [projects] = await query(`SELECT id, "organizationId", "agencyOrganizationId" FROM "Projects"`);
      for (const project of projects) {
        for (const channel of CHANNEL_DEFAULTS) {
          await query(
            `INSERT INTO "ProjectChannels" (id, "projectId", "organizationId", "agencyOrganizationId", key, name, visibility, "createdAt", "updatedAt")
             VALUES (:id, :projectId, :organizationId, :agencyOrganizationId, :key, :name, :visibility, :now, :now)
             ON CONFLICT ("projectId", key) DO NOTHING`,
            {
              id: crypto.randomUUID(),
              projectId: project.id,
              organizationId: project.organizationId,
              agencyOrganizationId: project.agencyOrganizationId,
              key: channel.key,
              name: channel.name,
              visibility: channel.visibility,
              now,
            }
          );
        }
      }
    });
  },

  async down() {
    // Data backfill, not a reference-data seed: not reversed, matching
    // this repo's established precedent.
  },
};
