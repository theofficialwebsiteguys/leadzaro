// Mirrors server/core/crm/inboundCampaigns.js — kept in sync manually.
export interface InboundCampaign {
  slug: string;
  headline: string;
  subhead: string;
}

export const INBOUND_CAMPAIGNS: InboundCampaign[] = [
  { slug: 'starter-website', headline: '$99/Month Websites', subhead: 'A professionally designed, fully managed website for one flat monthly rate — no big upfront cost.' },
  { slug: 'custom-website', headline: 'Custom Website Design', subhead: 'A website built around exactly how your business works, from the ground up.' },
  { slug: 'free-audit', headline: 'Free Website Audit', subhead: 'Find out how your current website and online presence stack up — free, no obligation.' },
  { slug: 'local-services', headline: 'Websites for Local Service Businesses', subhead: 'Built to turn nearby searches into booked jobs.' },
  { slug: 'restaurants', headline: 'Websites for Restaurants', subhead: 'Menus, hours, and online ordering — easy for guests to find and use.' },
  { slug: 'automotive', headline: 'Websites for Automotive Businesses', subhead: 'Showcase your services and inventory and make it easy to book an appointment.' },
  { slug: 'professional-services', headline: 'Websites for Professional Services', subhead: 'A polished, trustworthy site that helps clients choose you with confidence.' },
  { slug: 'redesign', headline: 'Website Redesigns', subhead: "Already have a site? We'll modernize it without starting from zero." },
  { slug: 'ongoing-management', headline: 'Ongoing Website Management', subhead: 'Updates, hosting, and support handled for you — so the site keeps working long after launch.' },
];

export function getInboundCampaign(slug: string): InboundCampaign | null {
  return INBOUND_CAMPAIGNS.find((c) => c.slug === slug) ?? null;
}

export interface InboundLeadSubmission {
  landingPageSlug: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  businessName?: string;
  message?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
  website?: string; // honeypot — must stay empty
}
