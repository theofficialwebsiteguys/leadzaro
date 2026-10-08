'use strict';

/**
 * A client (Organization) may own several projects — a website, an app,
 * an SEO engagement — rather than exactly one. See ADR 0008.
 *
 * - Drops the one-project-per-organization unique index. The only code
 *   that relied on it was ensureProjectForConversion's idempotency check;
 *   that guarantee moves to a partial unique index on
 *   sourceConversionAttemptId, so one conversion still yields exactly one
 *   project at the database level.
 * - Adds descriptive project fields. `name` stays nullable: every
 *   pre-existing project (and every test fixture) has none, and the UI
 *   falls back to the client's name — nothing is backfilled with
 *   invented values.
 */
module.exports = {
  // Both directions run in one transaction (Postgres DDL is
  // transactional), so a failure part-way never leaves Projects with
  // neither the old unique index nor the new one.
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('Projects', 'projects_organization_unique', { transaction });
      await queryInterface.addIndex('Projects', ['organizationId'], { name: 'projects_organization_id', transaction });
      await queryInterface.addIndex('Projects', ['sourceConversionAttemptId'], {
        unique: true,
        name: 'projects_source_conversion_unique',
        where: { sourceConversionAttemptId: { [Sequelize.Op.ne]: null } },
        transaction,
      });

      await queryInterface.addColumn('Projects', 'name', { type: Sequelize.STRING(150), allowNull: true }, { transaction });
      await queryInterface.addColumn('Projects', 'projectType', { type: Sequelize.STRING(30), allowNull: true }, { transaction });
      await queryInterface.addColumn('Projects', 'description', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      await queryInterface.addColumn('Projects', 'liveUrl', { type: Sequelize.STRING(500), allowNull: true }, { transaction });
      await queryInterface.addColumn('Projects', 'previewUrl', { type: Sequelize.STRING(500), allowNull: true }, { transaction });
      await queryInterface.addColumn('Projects', 'previewFileId', {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Files', key: 'id' }, onDelete: 'SET NULL',
      }, { transaction });
      await queryInterface.addColumn('Projects', 'outstandingNeeds', {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(
        'SELECT "organizationId" FROM "Projects" GROUP BY "organizationId" HAVING COUNT(*) > 1 LIMIT 1',
        { transaction },
      );
      if (duplicates.length) {
        throw new Error('Cannot restore the one-project-per-client constraint: at least one client now has multiple projects. Merge or delete the extra projects first.');
      }

      for (const column of ['outstandingNeeds', 'previewFileId', 'previewUrl', 'liveUrl', 'description', 'projectType', 'name']) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn('Projects', column, { transaction });
      }
      await queryInterface.removeIndex('Projects', 'projects_source_conversion_unique', { transaction });
      await queryInterface.removeIndex('Projects', 'projects_organization_id', { transaction });
      await queryInterface.addIndex('Projects', ['organizationId'], { unique: true, name: 'projects_organization_unique', transaction });
    });
  },
};
