/**
 * One-off bootstrap: grants full administrator access on the Website Guys
 * agency organization to a given email, creating the user if needed. This
 * exists because the normal onboarding path (Administration -> Invitations)
 * requires an existing admin to send the invite -- there is no such admin
 * yet on a fresh install.
 *
 * Usage:
 *   node server/scripts/createInitialAdmin.js <email> [password] [name]
 *
 * If password is omitted, a random one is generated and printed once.
 * Safe to re-run: an existing user/membership/role assignment is reused
 * rather than duplicated.
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sequelize, User, Organization, OrganizationMembership, Role, MembershipRole } = require('../models');

const AGENCY_SLUG = 'the-website-guys';
const AGENCY_NAME = 'The Website Guys';

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node server/scripts/createInitialAdmin.js <email> [password] [name]');
    process.exitCode = 1;
    return;
  }
  const passwordArg = process.argv[3];
  const password = passwordArg || crypto.randomBytes(12).toString('base64url');
  const name = process.argv[4] || email.split('@')[0];

  const t = await sequelize.transaction();
  try {
    const [org] = await Organization.findOrCreate({
      where: { slug: AGENCY_SLUG },
      defaults: { name: AGENCY_NAME, slug: AGENCY_SLUG, type: 'agency', status: 'active' },
      transaction: t,
    });

    const passwordHash = await bcrypt.hash(password, 10);
    let user = await User.findOne({ where: { email }, transaction: t });
    let createdUser = false;
    if (!user) {
      user = await User.create({ name, email, passwordHash, isActive: true }, { transaction: t });
      createdUser = true;
    } else {
      await user.update({ passwordHash, isActive: true }, { transaction: t });
    }

    let membership = await OrganizationMembership.findOne({
      where: { organizationId: org.id, userId: user.id },
      transaction: t,
    });
    if (!membership) {
      membership = await OrganizationMembership.create(
        {
          organizationId: org.id,
          userId: user.id,
          status: 'active',
          membershipType: 'employee',
          acceptedAt: new Date(),
        },
        { transaction: t }
      );
    } else if (membership.status !== 'active' || membership.membershipType !== 'employee') {
      await membership.update(
        { status: 'active', membershipType: 'employee', acceptedAt: membership.acceptedAt || new Date() },
        { transaction: t }
      );
    }

    const adminRole = await Role.findOne({ where: { key: 'administrator', scope: 'employee' }, transaction: t });
    if (!adminRole) {
      throw new Error("Role 'administrator' not found -- has the RBAC seed migration (npm run migrate) been run?");
    }

    const existingAssignment = await MembershipRole.findOne({
      where: { membershipId: membership.id, roleId: adminRole.id },
      transaction: t,
    });
    if (!existingAssignment) {
      await MembershipRole.create({ membershipId: membership.id, roleId: adminRole.id }, { transaction: t });
    }

    await t.commit();

    console.log('---');
    console.log(`${createdUser ? 'Created' : 'Updated'} user "${email}" as administrator on "${org.name}".`);
    if (!passwordArg) {
      console.log(`Generated password: ${password}`);
      console.log('Log in and change this immediately from Settings.');
    }
    console.log('---');
  } catch (err) {
    await t.rollback();
    throw err;
  } finally {
    await sequelize.close();
  }
}

main().catch((err) => {
  console.error('Failed to create/promote admin:', err);
  process.exitCode = 1;
});
