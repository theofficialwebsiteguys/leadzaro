'use strict';

const crypto = require('node:crypto');
const { parseDomainInput } = require('../core/domains/domainName');

/**
 * Carries the domain and hosting facts people already typed into the
 * client hub's Website & Hosting form (ADR 0008) into the domain registry
 * (ADR 0009), so nothing has to be entered twice:
 *
 * - a client's website URL and domain become domain links on the client;
 * - each project's live URL becomes a link on that project;
 * - "registrar" and "domain renewal date" become the domain's manually
 *   entered registrar and expiration;
 * - "hosting provider" / "hosting renewal date" become a hosting plan for
 *   that client with unknown cost — one per client, because nothing
 *   recorded says whether two clients share an account.
 *
 * Only copies: the original ClientProfiles columns are left untouched
 * (and simply stop being edited), so rolling back loses nothing. down() is
 * therefore a no-op — the copied rows live in tables that the preceding
 * migrations' down() drop.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction }).then(([rows]) => rows);
      const recordIds = new Map();

      async function ensureRecord(agencyOrganizationId, domainName) {
        const key = `${agencyOrganizationId}|${domainName}`;
        if (recordIds.has(key)) return recordIds.get(key);
        const [existing] = await query('SELECT id FROM "DomainRecords" WHERE "agencyOrganizationId" = :agencyOrganizationId AND "domainName" = :domainName', { agencyOrganizationId, domainName });
        let id = existing?.id;
        if (!id) {
          id = crypto.randomUUID();
          await query(
            'INSERT INTO "DomainRecords" (id, "agencyOrganizationId", "domainName", "providerSslCertificates", "createdAt", "updatedAt") VALUES (:id, :agencyOrganizationId, :domainName, \'[]\', :now, :now)',
            {
              id, agencyOrganizationId, domainName, now,
            },
          );
        }
        recordIds.set(key, id);
        return id;
      }

      async function ensureLink({
        agencyOrganizationId, organizationId, projectId, domainRecordId, hostname, source, isPrimary,
      }) {
        const [existing] = await query(
          projectId
            ? 'SELECT id FROM "ClientDomainLinks" WHERE "projectId" = :projectId AND "domainRecordId" = :domainRecordId'
            : 'SELECT id FROM "ClientDomainLinks" WHERE "organizationId" = :organizationId AND "projectId" IS NULL AND "domainRecordId" = :domainRecordId',
          { projectId, organizationId, domainRecordId },
        );
        if (existing) return;
        await query(
          `INSERT INTO "ClientDomainLinks" (id, "agencyOrganizationId", "organizationId", "projectId", "domainRecordId", hostname, source, "isPrimary", "createdAt", "updatedAt")
           VALUES (:id, :agencyOrganizationId, :organizationId, :projectId, :domainRecordId, :hostname, :source, :isPrimary, :now, :now)`,
          {
            id: crypto.randomUUID(), agencyOrganizationId, organizationId, projectId, domainRecordId, hostname, source, isPrimary, now,
          },
        );
      }

      const usable = (value) => {
        const parsed = parseDomainInput(value);
        return parsed.ok && !parsed.platformSuffix ? parsed : null;
      };

      const profiles = await query(
        `SELECT p."organizationId", p."agencyOrganizationId", p."websiteUrl", p."domainName", p.registrar, p."hostingProvider",
                p."domainRenewalDate", p."hostingRenewalDate", o.name AS "clientName"
           FROM "ClientProfiles" p JOIN "Organizations" o ON o.id = p."organizationId"
          WHERE o."deletedAt" IS NULL`,
      );

      for (const profile of profiles) {
        const { agencyOrganizationId, organizationId } = profile;
        const website = usable(profile.websiteUrl);
        const domain = usable(profile.domainName);
        let websiteRecordId = null;
        let factsRecordId = null;

        if (website) {
          websiteRecordId = await ensureRecord(agencyOrganizationId, website.registrableDomain);
          await ensureLink({
            agencyOrganizationId, organizationId, projectId: null, domainRecordId: websiteRecordId, hostname: website.hostname, source: 'client_website', isPrimary: true,
          });
          factsRecordId = websiteRecordId;
        }
        if (domain) {
          const domainRecordId = await ensureRecord(agencyOrganizationId, domain.registrableDomain);
          if (domainRecordId !== websiteRecordId) {
            await ensureLink({
              agencyOrganizationId, organizationId, projectId: null, domainRecordId, hostname: domain.hostname, source: 'manual', isPrimary: !websiteRecordId,
            });
          }
          factsRecordId = domainRecordId;
        }
        if (factsRecordId && (profile.registrar || profile.domainRenewalDate)) {
          await query(
            `UPDATE "DomainRecords" SET "registrarName" = COALESCE("registrarName", :registrar), "manualExpiresOn" = COALESCE("manualExpiresOn", :expiresOn), "updatedAt" = :now
              WHERE id = :id`,
            {
              id: factsRecordId, registrar: profile.registrar ? profile.registrar.slice(0, 100) : null, expiresOn: profile.domainRenewalDate || null, now,
            },
          );
        }

        if (profile.hostingProvider || profile.hostingRenewalDate) {
          const planId = crypto.randomUUID();
          const provider = profile.hostingProvider ? profile.hostingProvider.slice(0, 100) : null;
          await query(
            `INSERT INTO "HostingPlans" (id, "agencyOrganizationId", name, "providerName", "expiresOn", "allocationMethod", currency, notes, "createdAt", "updatedAt")
             VALUES (:id, :agencyOrganizationId, :name, :provider, :expiresOn, 'equal', 'USD', :notes, :now, :now)`,
            {
              id: planId,
              agencyOrganizationId,
              name: `${provider || 'Hosting'} — ${profile.clientName}`.slice(0, 150),
              provider,
              expiresOn: profile.hostingRenewalDate || null,
              notes: `Carried over from ${profile.clientName}’s earlier Website & Hosting details. If several clients share one hosting account, move them onto a single shared plan so its cost is split instead of repeated.`,
              now,
            },
          );
          await query(
            `INSERT INTO "HostingPlanClients" (id, "agencyOrganizationId", "hostingPlanId", "organizationId", "projectIds", "createdAt", "updatedAt")
             VALUES (:id, :agencyOrganizationId, :planId, :organizationId, '[]', :now, :now)`,
            {
              id: crypto.randomUUID(), agencyOrganizationId, planId, organizationId, now,
            },
          );
        }
      }

      const projects = await query(
        `SELECT pr.id, pr."organizationId", pr."agencyOrganizationId", pr."liveUrl"
           FROM "Projects" pr JOIN "Organizations" o ON o.id = pr."organizationId"
          WHERE pr."liveUrl" IS NOT NULL AND o."deletedAt" IS NULL`,
      );
      for (const project of projects) {
        const live = usable(project.liveUrl);
        if (!live) continue;
        const domainRecordId = await ensureRecord(project.agencyOrganizationId, live.registrableDomain);
        await ensureLink({
          agencyOrganizationId: project.agencyOrganizationId,
          organizationId: project.organizationId,
          projectId: project.id,
          domainRecordId,
          hostname: live.hostname,
          source: 'project_url',
          isPrimary: true,
        });
      }
    });
  },

  async down() {
    // Intentionally empty — see the header comment.
  },
};
