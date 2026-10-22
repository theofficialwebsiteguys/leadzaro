'use strict';

const crypto = require('node:crypto');

/**
 * ADR 0017: qualification of businesses already in Leadzaro, the sales
 * handoff and realistic outcomes.
 *
 *  - Organizations.emailSources: where each email was found, per address
 *    ({ type, note, url, legacyText, by, at }), replacing a free-text field
 *    that was treated as a link. Existing text is mapped to the nearest
 *    choice and also kept verbatim, so nothing anyone typed is lost.
 *  - Opportunities.salesAcceptedAt / salesAcceptedByUserId: sales accepting
 *    a handoff, apart from the qualifier completing it.
 *  - WorkCredits.note: why a credit is special (e.g. research added to an
 *    existing lead) for the person reviewing it.
 *  - ResearchClaims.start / draft: qualification progress saved on the
 *    server, so research can be resumed from My Work.
 *  - Two shared templates per agency: a thank-you and an information email,
 *    for "not right now" and "asked for information" (never sent automatically).
 */

const TYPES = ['website', 'facebook', 'privacy_policy', 'social', 'google_business', 'directory', 'referral', 'other'];

// A frozen copy of the mapping in modules/sales/emailSources.js, so this
// migration gives the same result however that module changes later.
function inferType(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;
  if (/^(https?:\/\/)?[^\s/$.?#]+\.[^\s]{2,}$/i.test(value)) {
    if (/privacy/.test(value)) return 'privacy_policy';
    if (/(^|\/\/|\.)(facebook\.com|fb\.com|fb\.me)/.test(value)) return 'facebook';
    if (/(instagram|linkedin|tiktok|twitter|x)\.com|youtube\.com|pinterest\.com|threads\.net|linktr\.ee/.test(value)) return 'social';
    if (/yelp\.com|yellowpages\.com|bbb\.org|angi\.com|homeadvisor\.com|thumbtack\.com|mapquest\.com|manta\.com|nextdoor\.com|houzz\.com/.test(value)) return 'directory';
    if (/google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo\.gl|g\.page|business\.google/.test(value)) return 'google_business';
    return 'website';
  }
  if (/facebook|\bfb\b/.test(value)) return 'facebook';
  if (/privacy/.test(value)) return 'privacy_policy';
  if (/instagram|insta\b|linkedin|tiktok|twitter|youtube|social/.test(value)) return 'social';
  if (/google|gbp|business profile|maps/.test(value)) return 'google_business';
  if (/yelp|directory|yellow ?pages|bbb|angi|thumbtack|chamber|nextdoor/.test(value)) return 'directory';
  if (/referr|called|phone call|spoke|talked|in person|conversation|told us|direct/.test(value)) return 'referral';
  if (/website|site|contact (page|us)|about|footer|home ?page/.test(value)) return 'website';
  return 'other';
}

function sourceFrom(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const isLink = /^(https?:\/\/)?[^\s/$.?#]+\.[^\s]{2,}$/i.test(value) && !/\s/.test(value);
  const type = inferType(value);
  if (!TYPES.includes(type)) return null;
  return {
    type,
    note: type === 'other' ? value.slice(0, 200) : null,
    url: isLink ? (/^https?:\/\//i.test(value) ? value : `https://${value}`).slice(0, 500) : null,
    legacyText: isLink ? null : value.slice(0, 200),
    by: null,
    at: null,
    migrated: true,
  };
}

const TEMPLATES = [
  {
    category: 'thank_you',
    channel: 'email',
    name: 'Thanks for your time',
    subject: 'Thanks for your time — {{business_name}}',
    body: 'Hi {{contact_first_name}},\n\nThanks for taking the time to talk today. I understand now isn’t the right time, and that’s completely fine.\n\nIf anything changes with {{business_name}}’s website, I’m happy to help — just reply to this email.\n\nThanks again,\n{{my_name}}\n{{my_phone}}',
  },
  {
    category: 'information',
    channel: 'email',
    name: 'The information you asked for',
    subject: 'The information you asked for — {{business_name}}',
    body: 'Hi {{contact_first_name}},\n\nThanks for your interest. Here’s the information you asked for:\n\n[What they asked for — write it here]\n\nHappy to answer any questions, or to set up a quick call if that’s easier.\n\nThanks,\n{{my_name}}\n{{my_phone}}',
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const {
      JSONB, DATE, UUID, STRING,
    } = Sequelize;
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await queryInterface.addColumn('Organizations', 'emailSources', { type: JSONB, allowNull: false, defaultValue: {} }, { transaction });
      await queryInterface.addColumn('Opportunities', 'salesAcceptedAt', { type: DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('Opportunities', 'salesAcceptedByUserId', { type: UUID, allowNull: true }, { transaction });
      await queryInterface.addColumn('WorkCredits', 'note', { type: STRING(255), allowNull: true }, { transaction });
      await queryInterface.addColumn('ResearchClaims', 'start', { type: JSONB, allowNull: true }, { transaction });
      await queryInterface.addColumn('ResearchClaims', 'draft', { type: JSONB, allowNull: true }, { transaction });
      await queryInterface.addIndex('ResearchClaims', ['agencyOrganizationId', 'userId', 'updatedAt'], { name: 'research_claims_user_recent', transaction });

      // Sources for existing emails: free text kept, mapped to the nearest choice.
      const [orgs] = await query(`SELECT id, email, "emailDiscovery" FROM "Organizations"
        WHERE email IS NOT NULL AND "emailDiscovery" IS NOT NULL AND "deletedAt" IS NULL`);
      for (const org of orgs) {
        const d = org.emailDiscovery || {};
        const key = String(org.email).trim().toLowerCase();
        const sameAsDiscovered = d.email && String(d.email).toLowerCase() === key && d.emailSource && d.emailSource !== 'manual';
        const source = sameAsDiscovered ? sourceFrom(d.emailSourceUrl) : sourceFrom(d.manualSourceUrl || (d.email && String(d.email).toLowerCase() === key ? d.emailSourceUrl : null));
        if (!source) continue; // eslint-disable-line no-continue
        await query('UPDATE "Organizations" SET "emailSources" = :sources WHERE id = :id', { id: org.id, sources: JSON.stringify({ [key]: source }) });
      }

      // A lead that has already been contacted by its owner counts as accepted.
      await query(`UPDATE "Opportunities" SET "salesAcceptedAt" = COALESCE("lastInteractionAt", "updatedAt"), "salesAcceptedByUserId" = "assignedToUserId"
        WHERE "qualificationStatus" = 'assigned' AND "assignedToUserId" IS NOT NULL AND "lastInteractionAt" IS NOT NULL`);

      const [agencies] = await query(`SELECT id FROM "Organizations" WHERE type = 'agency' AND "deletedAt" IS NULL`);
      const now = new Date();
      for (const agency of agencies) {
        for (const template of TEMPLATES) {
          const [[existing]] = await query('SELECT id FROM "MessageTemplates" WHERE "agencyOrganizationId" = :agencyId AND category = :category LIMIT 1', { agencyId: agency.id, category: template.category });
          if (existing) continue; // eslint-disable-line no-continue
          await query(
            `INSERT INTO "MessageTemplates" (id, "agencyOrganizationId", scope, category, channel, name, subject, body, "isDefault", "createdAt", "updatedAt")
             VALUES (:id, :agencyId, 'shared', :category, :channel, :name, :subject, :body, true, :now, :now)`,
            {
              id: crypto.randomUUID(), agencyId: agency.id, ...template, now,
            },
          );
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`DELETE FROM "MessageTemplates" WHERE "isDefault" = true AND category IN ('thank_you', 'information')`, { transaction });
      await queryInterface.removeIndex('ResearchClaims', 'research_claims_user_recent', { transaction });
      await queryInterface.removeColumn('ResearchClaims', 'draft', { transaction });
      await queryInterface.removeColumn('ResearchClaims', 'start', { transaction });
      await queryInterface.removeColumn('WorkCredits', 'note', { transaction });
      await queryInterface.removeColumn('Opportunities', 'salesAcceptedByUserId', { transaction });
      await queryInterface.removeColumn('Opportunities', 'salesAcceptedAt', { transaction });
      await queryInterface.removeColumn('Organizations', 'emailSources', { transaction });
    });
  },
};
