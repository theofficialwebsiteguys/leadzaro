'use strict';

const crypto = require('node:crypto');

/**
 * Phase 5 slice 2. A small starter library of platform-provided
 * sections (agencyOrganizationId: null, visible to every agency and
 * their clients). Each property in settingsSchema is independently
 * tagged with its own editingLevel/requiresReview (current-phase-plan.md
 * § 2e) — the enforcement logic that reads these tags lands in slice 3,
 * but the shape is decided now so that slice doesn't need a schema
 * change. 'form' reserves the shape current-phase-plan.md § 2j decided
 * for the client-editable form builder (slice 6 wires it up).
 */
const SECTIONS = [
  {
    name: 'Hero', componentKey: 'hero', category: 'header',
    settingsSchema: {
      heading: { type: 'text', editingLevel: 'basic', requiresReview: false },
      subheading: { type: 'text', editingLevel: 'basic', requiresReview: false },
      backgroundImage: { type: 'image', editingLevel: 'basic', requiresReview: false },
      layout: { type: 'select', editingLevel: 'professional', requiresReview: false },
      backgroundOverlayOpacity: { type: 'number', editingLevel: 'professional', requiresReview: false },
    },
    variants: ['split-image', 'centered', 'full-bleed'],
  },
  {
    name: 'Text Block', componentKey: 'text', category: 'content',
    settingsSchema: {
      body: { type: 'richtext', editingLevel: 'basic', requiresReview: false },
    },
    variants: ['default'],
  },
  {
    name: 'Image', componentKey: 'image', category: 'content',
    settingsSchema: {
      image: { type: 'image', editingLevel: 'basic', requiresReview: false },
      caption: { type: 'text', editingLevel: 'basic', requiresReview: false },
    },
    variants: ['default', 'full-width'],
  },
  {
    name: 'Call to Action', componentKey: 'cta', category: 'conversion',
    settingsSchema: {
      label: { type: 'text', editingLevel: 'basic', requiresReview: false },
      targetRoute: { type: 'text', editingLevel: 'basic', requiresReview: false },
      style: { type: 'select', editingLevel: 'professional', requiresReview: false },
    },
    variants: ['button', 'banner'],
  },
  {
    name: 'Form', componentKey: 'form', category: 'conversion',
    settingsSchema: {
      fields: { type: 'form_fields', editingLevel: 'professional', requiresReview: true },
      submitTarget: { type: 'form_submit_target', editingLevel: 'advanced', requiresReview: true },
    },
    variants: ['default'],
  },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert('SectionDefinitions', SECTIONS.map((section) => ({
      id: crypto.randomUUID(),
      agencyOrganizationId: null,
      name: section.name,
      componentKey: section.componentKey,
      category: section.category,
      settingsSchema: JSON.stringify(section.settingsSchema),
      variants: JSON.stringify(section.variants),
      state: 'managed',
      isSystemDefined: true,
      createdAt: now,
      updatedAt: now,
    })));
  },

  async down() {
    // Reference-data seed: not reversed, matching prior precedent.
  },
};
