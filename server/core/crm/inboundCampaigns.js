'use strict';

/**
 * Public acquisition landing pages (master architecture § 20). A
 * validated reference list, not an enum, matching the pipeline-stage
 * catalog's reasoning — new campaigns are a data change (add an entry
 * here), not a code change to a switch statement or a migration.
 */
const CAMPAIGNS = [
  {
    slug: 'starter-website',
    requestedService: 'starter-website',
    headline: '$99/Month Websites',
    subhead: 'A professionally designed, fully managed website for one flat monthly rate — no big upfront cost.',
  },
  {
    slug: 'custom-website',
    requestedService: 'custom-website',
    headline: 'Custom Website Design',
    subhead: 'A website built around exactly how your business works, from the ground up.',
  },
  {
    slug: 'free-audit',
    requestedService: 'free-audit',
    headline: 'Free Website Audit',
    subhead: "Find out how your current website and online presence stack up — free, no obligation.",
  },
  {
    slug: 'local-services',
    requestedService: 'local-services',
    headline: 'Websites for Local Service Businesses',
    subhead: 'Built to turn nearby searches into booked jobs.',
  },
  {
    slug: 'restaurants',
    requestedService: 'restaurants',
    headline: 'Websites for Restaurants',
    subhead: 'Menus, hours, and online ordering — easy for guests to find and use.',
  },
  {
    slug: 'automotive',
    requestedService: 'automotive',
    headline: 'Websites for Automotive Businesses',
    subhead: 'Showcase your services and inventory and make it easy to book an appointment.',
  },
  {
    slug: 'professional-services',
    requestedService: 'professional-services',
    headline: 'Websites for Professional Services',
    subhead: 'A polished, trustworthy site that helps clients choose you with confidence.',
  },
  {
    slug: 'redesign',
    requestedService: 'redesign',
    headline: 'Website Redesigns',
    subhead: "Already have a site? We'll modernize it without starting from zero.",
  },
  {
    slug: 'ongoing-management',
    requestedService: 'ongoing-management',
    headline: 'Ongoing Website Management',
    subhead: 'Updates, hosting, and support handled for you — so the site keeps working long after launch.',
  },
];

const CAMPAIGN_SLUGS = CAMPAIGNS.map((c) => c.slug);

function getCampaign(slug) {
  return CAMPAIGNS.find((c) => c.slug === slug) || null;
}

module.exports = { CAMPAIGNS, CAMPAIGN_SLUGS, getCampaign };
