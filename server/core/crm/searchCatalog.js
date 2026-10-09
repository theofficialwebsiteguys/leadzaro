'use strict';

/**
 * Guided lead search (ADR 0014): business categories and the Google
 * Places text queries each one runs, plus the starting territories and
 * preset searches. Territories and presets are editable per workspace
 * (Settings → Workspace); these are only the defaults.
 */

const CATEGORIES = [
  {
    key: 'home_services',
    label: 'Contractors & home services',
    queries: ['general contractor', 'home improvement contractor'],
    subcategories: [
      { key: 'roofers', label: 'Roofers', query: 'roofing contractor' },
      { key: 'landscapers', label: 'Landscapers', query: 'landscaper' },
      { key: 'electricians', label: 'Electricians', query: 'electrician' },
      { key: 'plumbers', label: 'Plumbers', query: 'plumber' },
      { key: 'hvac', label: 'HVAC', query: 'HVAC contractor' },
      { key: 'painters', label: 'Painters', query: 'house painter' },
      { key: 'cleaning', label: 'Cleaning services', query: 'house cleaning service' },
      { key: 'handyman', label: 'Handymen', query: 'handyman' },
    ],
  },
  {
    key: 'restaurants',
    label: 'Restaurants & cafés',
    queries: ['restaurant'],
    subcategories: [
      { key: 'pizza', label: 'Pizzerias', query: 'pizza restaurant' },
      { key: 'cafes', label: 'Cafés', query: 'cafe' },
      { key: 'bakeries', label: 'Bakeries', query: 'bakery' },
      { key: 'delis', label: 'Delis', query: 'deli' },
      { key: 'caterers', label: 'Caterers', query: 'catering service' },
    ],
  },
  {
    key: 'salons',
    label: 'Salons & barbers',
    queries: ['hair salon', 'barber shop'],
    subcategories: [
      { key: 'hair_salons', label: 'Hair salons', query: 'hair salon' },
      { key: 'barbers', label: 'Barbers', query: 'barber shop' },
      { key: 'nail_salons', label: 'Nail salons', query: 'nail salon' },
      { key: 'spas', label: 'Day spas', query: 'day spa' },
    ],
  },
  {
    key: 'fitness',
    label: 'Fitness & wellness',
    queries: ['gym', 'fitness studio'],
    subcategories: [
      { key: 'gyms', label: 'Gyms', query: 'gym' },
      { key: 'yoga', label: 'Yoga & pilates', query: 'yoga studio' },
      { key: 'trainers', label: 'Personal trainers', query: 'personal trainer' },
      { key: 'martial_arts', label: 'Martial arts', query: 'martial arts school' },
      { key: 'chiropractors', label: 'Chiropractors', query: 'chiropractor' },
      { key: 'massage', label: 'Massage', query: 'massage therapist' },
    ],
  },
  {
    key: 'auto',
    label: 'Auto services',
    queries: ['auto repair shop'],
    subcategories: [
      { key: 'auto_repair', label: 'Auto repair', query: 'auto repair shop' },
      { key: 'body_shops', label: 'Body shops', query: 'auto body shop' },
      { key: 'detailing', label: 'Detailing', query: 'car detailing' },
      { key: 'towing', label: 'Towing', query: 'towing service' },
      { key: 'tires', label: 'Tire shops', query: 'tire shop' },
    ],
  },
  {
    key: 'retail',
    label: 'Retail',
    queries: ['boutique', 'gift shop'],
    subcategories: [
      { key: 'boutiques', label: 'Boutiques', query: 'clothing boutique' },
      { key: 'florists', label: 'Florists', query: 'florist' },
      { key: 'gift_shops', label: 'Gift shops', query: 'gift shop' },
      { key: 'jewelry', label: 'Jewelers', query: 'jewelry store' },
      { key: 'pet_stores', label: 'Pet stores', query: 'pet store' },
    ],
  },
  {
    key: 'professional',
    label: 'Professional services',
    queries: ['accounting firm', 'insurance agency'],
    subcategories: [
      { key: 'accountants', label: 'Accountants', query: 'accountant' },
      { key: 'insurance', label: 'Insurance agents', query: 'insurance agency' },
      { key: 'lawyers', label: 'Law firms', query: 'law firm' },
      { key: 'real_estate', label: 'Real estate', query: 'real estate agency' },
      { key: 'photographers', label: 'Photographers', query: 'photographer' },
    ],
  },
];

const DEFAULT_TERRITORIES = [
  { key: 'rockland', name: 'Rockland County', areas: ['Rockland County, NY'] },
  { key: 'westchester', name: 'Westchester', areas: ['Westchester County, NY'] },
  { key: 'hudson_valley', name: 'Hudson Valley', areas: ['Orange County, NY', 'Dutchess County, NY', 'Ulster County, NY', 'Putnam County, NY'] },
  { key: 'north_jersey', name: 'North Jersey', areas: ['Bergen County, NJ', 'Passaic County, NJ', 'Morris County, NJ', 'Essex County, NJ'] },
];

const DEFAULT_PRESETS = [
  { key: 'contractors_rockland', name: 'Contractors in Rockland County', categories: ['home_services'], subcategories: ['roofers', 'landscapers', 'electricians', 'plumbers'], territory: 'rockland' },
  { key: 'restaurants_westchester', name: 'Restaurants in Westchester', categories: ['restaurants'], subcategories: [], territory: 'westchester' },
  { key: 'salons_north_jersey', name: 'Salons and barbers in North Jersey', categories: ['salons'], subcategories: ['hair_salons', 'barbers'], territory: 'north_jersey' },
];

// Each query is a paid Google Text Search call, so one click is capped.
const MAX_QUERIES = 8;

/**
 * Turns selections into the text queries to run: chosen subcategories,
 * else the category's own queries, plus custom keywords.
 */
function queriesFor({ categories = [], subcategories = [], keywords = '' }) {
  const out = [];
  const add = (query, label) => {
    if (query && !out.some((q) => q.query.toLowerCase() === query.toLowerCase())) out.push({ query, label });
  };
  for (const category of CATEGORIES) {
    if (!categories.includes(category.key)) continue; // eslint-disable-line no-continue
    const chosen = category.subcategories.filter((s) => subcategories.includes(s.key));
    if (chosen.length) chosen.forEach((s) => add(s.query, s.label));
    else category.queries.forEach((q) => add(q, category.label));
  }
  // Subcategories picked without their parent still count.
  for (const category of CATEGORIES) {
    if (categories.includes(category.key)) continue; // eslint-disable-line no-continue
    category.subcategories.filter((s) => subcategories.includes(s.key)).forEach((s) => add(s.query, s.label));
  }
  String(keywords || '').split(/[,\n]/).map((k) => k.trim().slice(0, 80)).filter(Boolean).slice(0, 5).forEach((k) => add(k, k));
  return out;
}

function cleanAreaList(value) {
  return (Array.isArray(value) ? value : []).map((a) => String(a || '').trim().slice(0, 120)).filter(Boolean).slice(0, 8);
}

/** The workspace's territories and presets, falling back to the defaults. */
function searchSettingsOf(org) {
  const s = org?.settings?.leadSearch || {};
  return {
    territories: Array.isArray(s.territories) ? s.territories : DEFAULT_TERRITORIES,
    presets: Array.isArray(s.presets) ? s.presets : DEFAULT_PRESETS,
    customized: Array.isArray(s.territories) || Array.isArray(s.presets),
  };
}

module.exports = {
  CATEGORIES, DEFAULT_TERRITORIES, DEFAULT_PRESETS, MAX_QUERIES, queriesFor, cleanAreaList, searchSettingsOf,
};
