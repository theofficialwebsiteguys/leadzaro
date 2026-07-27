'use strict';

const crypto = require('node:crypto');

/**
 * Phase 5 slice 8. One platform-provided DesignSystem library template
 * (agencyOrganizationId: null, per § 2a "platform-provided defaults
 * visible to everyone") so the 'template' starting mode has at least
 * one real, usable row out of the box — mirroring how slice 2 seeded a
 * small starter SectionDefinition library rather than shipping the
 * feature with an empty catalog.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert('DesignSystems', [{
      id: crypto.randomUUID(),
      agencyOrganizationId: null,
      organizationId: null,
      name: 'Standard Business',
      tokens: JSON.stringify({
        colors: {
          primary: '#2563eb', secondary: '#1e293b', background: '#ffffff', text: '#0f172a',
        },
        fonts: { heading: 'Inter', body: 'Inter' },
        spacingScale: [4, 8, 12, 16, 24, 32, 48, 64],
        radii: { sm: 4, md: 8, lg: 16 },
      }),
      isLibraryTemplate: true,
      status: 'published',
      createdAt: now,
      updatedAt: now,
    }]);
  },

  async down() {
    // Reference-data seed: not reversed, matching prior precedent.
  },
};
