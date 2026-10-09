'use strict';

/**
 * Lead search → email workflow (ADR 0014).
 *
 * Organizations (the agency's record of a business) gain the business's
 * Facebook page and the email-discovery record — what was checked, when,
 * what was found and where. Discovery state is kept apart from the lead's
 * pipeline stage and from message delivery status.
 *
 * Opportunities gain the employee's reason for outreach (with the evidence
 * behind it) and the current unsent email draft, so a teammate opening
 * the lead sees both.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, JSONB } = Sequelize;
    await queryInterface.sequelize.transaction(async (transaction) => {
      const add = (table, name, def) => queryInterface.addColumn(table, name, def, { transaction });
      await add('Organizations', 'facebookUrl', { type: STRING(500), allowNull: true });
      await add('Organizations', 'emailDiscovery', { type: JSONB, allowNull: true });
      await add('Opportunities', 'outreachReason', { type: TEXT, allowNull: true });
      await add('Opportunities', 'outreachEvidence', { type: TEXT, allowNull: true });
      await add('Opportunities', 'emailDraft', { type: JSONB, allowNull: true });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const remove = (table, name) => queryInterface.removeColumn(table, name, { transaction });
      await remove('Organizations', 'facebookUrl');
      await remove('Organizations', 'emailDiscovery');
      await remove('Opportunities', 'outreachReason');
      await remove('Opportunities', 'outreachEvidence');
      await remove('Opportunities', 'emailDraft');
    });
  },
};
