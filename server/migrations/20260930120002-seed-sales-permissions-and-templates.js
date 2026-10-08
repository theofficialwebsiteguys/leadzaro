'use strict';

const crypto = require('node:crypto');

/**
 * Permissions for the sales workflow (ADR 0011) and a starter set of
 * shared templates per agency. Templates only use placeholders for facts
 * (names, links, meeting times) — no prices, promises or claims — and
 * managers can edit or archive them.
 */
const PERMISSIONS = [
  { key: 'outreach.send', category: 'outreach', description: 'Send email and text messages and start calls from Leadzaro' },
  { key: 'templates.manage_shared', category: 'outreach', description: "Create and edit the team's shared message templates" },
  { key: 'payments.create', category: 'payments', description: 'Create Stripe payment links and checkouts, and link Stripe customers' },
  { key: 'payments.custom_offer', category: 'payments', description: 'Create payment links for a custom amount not in the Stripe catalog' },
  { key: 'payments.record_manual', category: 'payments', description: 'Record a payment received outside Stripe (check, cash, bank transfer)' },
  { key: 'sales.view_team', category: 'sales', description: 'View team sales reports and set sales goals' },
];

const GRANTS = {
  administrator: PERMISSIONS.map((p) => p.key),
  sales_manager: ['outreach.send', 'templates.manage_shared', 'payments.create', 'payments.custom_offer', 'payments.record_manual', 'sales.view_team'],
  sales_representative: ['outreach.send', 'payments.create'],
  billing: ['payments.record_manual'],
};

const TEMPLATES = [
  {
    category: 'intro', channel: 'email', name: 'First email',
    subject: "A question about {{business_name}}'s website",
    body: "Hi {{contact_first_name}},\n\nI'm {{my_name}} with {{my_company}}. We build and look after websites for local businesses.\n\nWould you be open to a short call this week to talk about {{business_name}}'s website?\n\nThanks,\n{{my_name}}\n{{my_phone}}",
  },
  {
    category: 'intro', channel: 'sms', name: 'First text',
    body: "Hi {{contact_first_name}}, this is {{my_name}} with {{my_company}}. Do you have a few minutes this week to talk about {{business_name}}'s website? Reply STOP to opt out.",
  },
  {
    category: 'voicemail', channel: 'call', name: 'Voicemail script',
    body: "Hi {{contact_first_name}}, this is {{my_name}} from {{my_company}}. I'm calling about {{business_name}}'s website. You can reach me at {{my_phone}}. Again, that's {{my_name}} at {{my_phone}}. Thanks!",
  },
  {
    category: 'follow_up', channel: 'email', name: 'Follow-up email',
    subject: 'Following up — {{business_name}}',
    body: "Hi {{contact_first_name}},\n\nI wanted to follow up on my last message about {{business_name}}'s website. Is there a good time for a quick call?\n\nThanks,\n{{my_name}}\n{{my_phone}}",
  },
  {
    category: 'follow_up', channel: 'sms', name: 'Follow-up text',
    body: 'Hi {{contact_first_name}}, {{my_name}} from {{my_company}} again. Is there a good time this week for a quick call about your website?',
  },
  {
    category: 'meeting_confirmation', channel: 'email', name: 'Meeting confirmation',
    subject: 'Confirming our call — {{meeting_time}}',
    body: "Hi {{contact_first_name}},\n\nThanks for making time. I'm confirming our call on {{meeting_time}}.\n\nIf anything changes, just reply to this email or call me at {{my_phone}}.\n\nTalk soon,\n{{my_name}}",
  },
  {
    category: 'objection', channel: 'call', name: 'Objection: "We already have a website"',
    body: "That's great — most of the businesses we work with already had one. Can I ask how it's working for you? Is it bringing in calls or messages? If it's doing everything you need, no problem at all.",
  },
  {
    category: 'objection', channel: 'call', name: 'Objection: "Not a good time"',
    body: 'Totally understand. When would be a better time for a short call? I can follow up then.',
  },
  {
    category: 'payment_reminder', channel: 'email', name: 'Payment link',
    subject: 'Your secure payment link — {{business_name}}',
    body: "Hi {{contact_first_name}},\n\nAs discussed, here's the secure payment link to get started:\n{{payment_link}}\n\nLet me know if you have any questions.\n\nThanks,\n{{my_name}}\n{{my_phone}}",
  },
  {
    category: 'payment_reminder', channel: 'sms', name: 'Payment link text',
    body: "Hi {{contact_first_name}}, here's the secure payment link we talked about: {{payment_link}} — {{my_name}}, {{my_company}}",
  },
  {
    category: 'welcome', channel: 'email', name: 'Client welcome',
    subject: 'Welcome to {{my_company}}',
    body: "Hi {{contact_first_name}},\n\nThank you for choosing {{my_company}}. I'm handing {{business_name}} over to our team, who will be in touch about next steps.\n\nIf you need anything in the meantime, reply here or call me at {{my_phone}}.\n\n{{my_name}}",
  },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      for (const permission of PERMISSIONS) {
        await query(
          `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
           VALUES (:id, :key, :category, :description, :now, :now) ON CONFLICT (key) DO NOTHING`,
          { id: crypto.randomUUID(), ...permission, now },
        );
      }
      for (const [roleKey, keys] of Object.entries(GRANTS)) {
        const [roles] = await query('SELECT id FROM "Roles" WHERE key = :roleKey', { roleKey });
        const [permissions] = await query('SELECT id FROM "Permissions" WHERE key IN (:keys)', { keys });
        for (const role of roles) {
          for (const permission of permissions) {
            await query(
              `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
               VALUES (:id, :roleId, :permissionId, :now, :now) ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
              { id: crypto.randomUUID(), roleId: role.id, permissionId: permission.id, now },
            );
          }
        }
      }

      const [agencies] = await query(`SELECT id FROM "Organizations" WHERE type = 'agency' AND "deletedAt" IS NULL`);
      for (const agency of agencies) {
        const [[{ count }]] = await query('SELECT COUNT(*)::int AS count FROM "MessageTemplates" WHERE "agencyOrganizationId" = :id', { id: agency.id });
        if (count > 0) continue;
        for (const template of TEMPLATES) {
          await query(
            `INSERT INTO "MessageTemplates" (id, "agencyOrganizationId", scope, category, channel, name, subject, body, "isDefault", "createdAt", "updatedAt")
             VALUES (:id, :agencyId, 'shared', :category, :channel, :name, :subject, :body, true, :now, :now)`,
            {
              id: crypto.randomUUID(), agencyId: agency.id, subject: null, ...template, now,
            },
          );
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      const keys = PERMISSIONS.map((p) => p.key);
      await query('DELETE FROM "MessageTemplates" WHERE "isDefault" = true');
      await query('DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key IN (:keys))', { keys });
      await query('DELETE FROM "MembershipPermissionOverrides" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key IN (:keys))', { keys });
      await query('DELETE FROM "Permissions" WHERE key IN (:keys)', { keys });
    });
  },
};
