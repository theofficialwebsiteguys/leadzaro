'use strict';

const crypto = require('node:crypto');

/**
 * Guided role-based workflow (ADR 0016).
 *
 * Opportunities keep separate fields for each concept the workflow tracks:
 * qualification progress (and who did it), interest level, the meeting,
 * the pricing sent, payment confirmation and closing approval. Sales stage,
 * next action, owner and payments stay where they were.
 *
 * WorkCredits holds one qualification credit per lead for compensation
 * review; WorkSessions holds employee-started work timers. Neither is
 * backfilled — missing history is never invented.
 *
 * Roles: Lead Qualifier and Client Manager are added, Sales Representative
 * is shown as "Sales Outreach", and the company dashboard (revenue, SSL and
 * renewal alerts) and the Domains area leave the sales outreach role.
 */
const PERMISSIONS = [
  { key: 'qualification.work', category: 'sales', description: 'Research businesses, complete qualifications and assign them to sales' },
  { key: 'sales.approve_close', category: 'sales', description: 'Approve a submitted sale and convert it into a client' },
  { key: 'team.review_work', category: 'admin', description: 'Review employee work, attribution, recorded time and compensation' },
  { key: 'clients.onboard', category: 'projects', description: 'Receive approved client handoffs and complete client onboarding' },
];

const SELF_SERVICE = ['profile.manage', 'notifications.view', 'notifications.manage', 'sessions.manage'];
const NEW_ROLES = [
  {
    key: 'lead_qualifier',
    name: 'Lead Qualifier',
    permissions: [...SELF_SERVICE, 'leads.search', 'leads.contact_reveal', 'leads.save', 'qualification.work'],
  },
  {
    key: 'client_manager',
    name: 'Client Manager',
    permissions: [...SELF_SERVICE, 'clients.onboard', 'projects.view', 'projects.manage', 'domains.view', 'tasks.manage', 'requests.manage',
      'meetings.manage', 'meetings.request', 'files.manage', 'files.upload', 'messages.post'],
  },
];
const GRANTS = {
  administrator: PERMISSIONS.map((p) => p.key),
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const {
      STRING, TEXT, DATE, JSONB, UUID, UUIDV4, INTEGER,
    } = Sequelize;
    const col = (type, extra = {}) => ({ type, allowNull: true, ...extra });
    const userRef = { references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' };
    const timestamps = { createdAt: { type: DATE, allowNull: false }, updatedAt: { type: DATE, allowNull: false } };
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const add = (table, name, def) => queryInterface.addColumn(table, name, def, { transaction });
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      for (const [name, def] of Object.entries({
        qualificationStatus: col(STRING(20)),
        researcherUserId: col(UUID, userRef),
        qualifiedByUserId: col(UUID, userRef),
        qualifiedAt: col(DATE),
        qualificationNote: col(STRING(500)),
        research: { type: JSONB, allowNull: false, defaultValue: {} },
        interestLevel: { type: STRING(10), allowNull: false, defaultValue: 'unknown' },
        meeting: col(JSONB),
        proposal: col(JSONB),
        paymentConfirmedAt: col(DATE),
        closingStatus: col(STRING(20)),
        closingSubmittedAt: col(DATE),
        closingSubmittedByUserId: col(UUID, userRef),
        closingNote: col(TEXT),
        closingReviewedAt: col(DATE),
        closingReviewedByUserId: col(UUID, userRef),
        closingReviewNote: col(STRING(500)),
        closingException: col(STRING(500)),
        clientManagerUserId: col(UUID, userRef),
      })) await add('Opportunities', name, def);
      await queryInterface.addIndex('Opportunities', ['agencyOrganizationId', 'qualificationStatus', 'researcherUserId'], { transaction });
      await queryInterface.addIndex('Opportunities', ['agencyOrganizationId', 'closingStatus'], { transaction });

      await queryInterface.createTable('WorkCredits', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        opportunityId: { type: UUID, allowNull: false, references: { model: 'Opportunities', key: 'id' }, onDelete: 'CASCADE' },
        userId: { type: UUID, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
        kind: { type: STRING(20), allowNull: false },
        status: { type: STRING(20), allowNull: false, defaultValue: 'pending' },
        earnedAt: { type: DATE, allowNull: false },
        correctionCount: { type: INTEGER, allowNull: false, defaultValue: 0 },
        lastCorrectionReason: col(STRING(500)),
        reviewNote: col(STRING(500)),
        reviewedByUserId: col(UUID, userRef),
        reviewedAt: col(DATE),
        paidAt: col(DATE),
        paidByUserId: col(UUID, userRef),
        ...timestamps,
      }, { transaction });
      // One credit per lead and kind: reassignment, reopening, repeated saves
      // or double clicks can never credit the same work twice.
      await queryInterface.addIndex('WorkCredits', ['opportunityId', 'kind'], { unique: true, name: 'work_credits_opportunity_kind_unique', transaction });
      await queryInterface.addIndex('WorkCredits', ['agencyOrganizationId', 'userId', 'earnedAt'], { transaction });

      await queryInterface.createTable('WorkSessions', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        userId: { type: UUID, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
        opportunityId: col(UUID, { references: { model: 'Opportunities', key: 'id' }, onDelete: 'SET NULL' }),
        workType: { type: STRING(20), allowNull: false },
        source: { type: STRING(10), allowNull: false, defaultValue: 'timer' },
        status: { type: STRING(10), allowNull: false },
        startedAt: { type: DATE, allowNull: false },
        endedAt: col(DATE),
        pausedAt: col(DATE),
        pausedSeconds: { type: INTEGER, allowNull: false, defaultValue: 0 },
        minutes: col(INTEGER),
        note: col(STRING(1000)),
        originalMinutes: col(INTEGER),
        correctionReason: col(STRING(500)),
        correctedByUserId: col(UUID, userRef),
        correctedAt: col(DATE),
        reviewStatus: { type: STRING(12), allowNull: false, defaultValue: 'unreviewed' },
        reviewedByUserId: col(UUID, userRef),
        reviewedAt: col(DATE),
        ...timestamps,
      }, { transaction });
      // One open timer per person, so sessions can't overlap.
      await queryInterface.addIndex('WorkSessions', ['userId'], {
        unique: true, where: { status: ['running', 'paused'] }, name: 'work_sessions_one_open_per_user', transaction,
      });
      await queryInterface.addIndex('WorkSessions', ['agencyOrganizationId', 'userId', 'startedAt'], { transaction });

      // Payment confirmation is a recorded fact; copy it from existing payments.
      await q(`UPDATE "Opportunities" o SET "paymentConfirmedAt" = p.at
        FROM (SELECT "opportunityId", MIN("paidAt") AS at FROM "SalesPayments" WHERE kind = 'initial' AND "opportunityId" IS NOT NULL GROUP BY "opportunityId") p
        WHERE p."opportunityId" = o.id AND o."paymentConfirmedAt" IS NULL`);

      // Roles and permissions.
      for (const permission of PERMISSIONS) {
        await q(`INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
          VALUES (:id, :key, :category, :description, :now, :now) ON CONFLICT (key) DO NOTHING`, { id: crypto.randomUUID(), ...permission, now });
      }
      for (const role of NEW_ROLES) {
        await q(`INSERT INTO "Roles" (id, key, name, scope, "isSystem", description, "createdAt", "updatedAt")
          VALUES (:id, :key, :name, 'employee', true, :name, :now, :now) ON CONFLICT (key) DO NOTHING`, {
          id: crypto.randomUUID(), key: role.key, name: role.name, now,
        });
      }
      const grant = async (roleKey, keys) => {
        const [roles] = await q('SELECT id FROM "Roles" WHERE key = :roleKey', { roleKey });
        const [permissions] = await q('SELECT id FROM "Permissions" WHERE key IN (:keys)', { keys });
        for (const role of roles) {
          for (const permission of permissions) {
            await q(`INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
              VALUES (:id, :roleId, :permissionId, :now, :now) ON CONFLICT ("roleId", "permissionId") DO NOTHING`, {
              id: crypto.randomUUID(), roleId: role.id, permissionId: permission.id, now,
            });
          }
        }
      };
      for (const role of NEW_ROLES) await grant(role.key, role.permissions);
      for (const [roleKey, keys] of Object.entries(GRANTS)) await grant(roleKey, keys);

      await q(`UPDATE "Roles" SET name = 'Sales Outreach', description = 'Sales Outreach' WHERE key = 'sales_representative'`);
      await q(`DELETE FROM "RolePermissions" WHERE "roleId" IN (SELECT id FROM "Roles" WHERE key = 'sales_representative')
        AND "permissionId" IN (SELECT id FROM "Permissions" WHERE key IN ('dashboard.view', 'domains.view'))`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await q(`INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
        SELECT gen_random_uuid(), r.id, p.id, NOW(), NOW() FROM "Roles" r, "Permissions" p
        WHERE r.key = 'sales_representative' AND p.key IN ('dashboard.view', 'domains.view') ON CONFLICT ("roleId", "permissionId") DO NOTHING`);
      await q(`UPDATE "Roles" SET name = 'Sales Representative', description = 'Sales Representative' WHERE key = 'sales_representative'`);
      await queryInterface.dropTable('WorkSessions', { transaction });
      await queryInterface.dropTable('WorkCredits', { transaction });
      for (const name of ['qualificationStatus', 'researcherUserId', 'qualifiedByUserId', 'qualifiedAt', 'qualificationNote', 'research', 'interestLevel', 'meeting',
        'proposal', 'paymentConfirmedAt', 'closingStatus', 'closingSubmittedAt', 'closingSubmittedByUserId', 'closingNote', 'closingReviewedAt',
        'closingReviewedByUserId', 'closingReviewNote', 'closingException', 'clientManagerUserId']) {
        await queryInterface.removeColumn('Opportunities', name, { transaction });
      }
      // Roles and permissions are reference data and stay (memberships may already hold them).
    });
  },
};
