'use strict';

/**
 * Lead Search Service
 *
 * Uses Google Places API (New) v1 for production results.
 * Falls back to demo/mock data when:
 *   - DEMO_MODE=true is set in .env
 *   - No valid GOOGLE_PLACES_API_KEY is configured
 *   - The request includes demo=true
 *
 * Cost optimisations:
 *   1. Geocode cache  – location strings cached 24 h; avoids repeat Geocoding API calls
 *   2. Search cache   – full search results cached 15 min; avoids repeat Text Search calls
 *   3. Contact split  – nationalPhoneNumber removed from Text Search mask; fetched on demand
 *                       via Place Details so you only pay for leads users actually reveal
 */

const https = require('node:https');

const API_KEY   = process.env.GOOGLE_PLACES_API_KEY;
const GLOBAL_DEMO = process.env.DEMO_MODE === 'true';

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_DETAILS_BASE    = 'https://places.googleapis.com/v1/places/';
const GEOCODE_URL            = 'https://maps.googleapis.com/maps/api/geocode/json';

// Fields fetched for every search result (no contact fields → smaller payload,
// potential SKU benefit if Google introduces a Basic tier below Pro)
const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.websiteUri',         // kept: drives the "no website" badge (core feature)
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

// Only fetched on demand when the user clicks "Reveal phone"
const CONTACT_FIELD_MASK = 'nationalPhoneNumber';

// ── In-memory caches ───────────────────────────────────────────────────────────
const GEOCODE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SEARCH_TTL  = 15 * 60 * 1000;      // 15 minutes
const CONTACT_TTL = 60 * 60 * 1000;      // 1 hour

const geocodeCache = new Map(); // key: normalised location string
const searchCache  = new Map(); // key: JSON-serialised search params  OR  'details:<placeId>'

// ── HTTP helper ────────────────────────────────────────────────────────────────
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: { 'Accept': 'application/json', ...options.headers },
    };

    const req = https.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            const msg = json.error?.message || json.status || `HTTP ${res.statusCode}`;
            reject(new Error(`Places API error: ${msg}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Failed to parse API response (status ${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Request timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Geocode a free-text location string to lat/lng ─────────────────────────────
// Results are cached for 24 h — city coordinates never change, so repeat
// searches for the same location cost nothing after the first call.
async function geocodeLocation(location) {
  if (!location || !API_KEY) return null;

  const key = location.toLowerCase().trim();
  const hit  = geocodeCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return { lat: hit.lat, lng: hit.lng };

  try {
    const url  = `${GEOCODE_URL}?address=${encodeURIComponent(location)}&key=${API_KEY}`;
    const data = await httpRequest(url);
    const loc  = data.results?.[0]?.geometry?.location;
    if (loc) {
      geocodeCache.set(key, { lat: loc.lat, lng: loc.lng, expiresAt: Date.now() + GEOCODE_TTL });
      return { lat: loc.lat, lng: loc.lng };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Fetch phone number for a single place on demand ────────────────────────────
// Uses its own 1-hour cache keyed by placeId so the same business never costs
// more than one Place Details call regardless of how many times it is viewed.
async function getPlaceDetails(placeId) {
  if (!placeId || !API_KEY) return { phone: null };

  const cacheKey = `details:${placeId}`;
  const hit = searchCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.data;

  try {
    const url  = `${PLACES_DETAILS_BASE}${encodeURIComponent(placeId)}`;
    const data = await httpRequest(url, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': CONTACT_FIELD_MASK,
      },
    });

    const result = { phone: data.nationalPhoneNumber || null };
    searchCache.set(cacheKey, { data: result, expiresAt: Date.now() + CONTACT_TTL });
    return result;
  } catch {
    return { phone: null };
  }
}

// ── Map a Google Place object → our Lead schema ────────────────────────────────
function mapPlaceToLead(place) {
  const comps = place.addressComponents || [];

  const getComp = (...types) => {
    for (const type of types) {
      const c = comps.find((x) => Array.isArray(x.types) && x.types.includes(type));
      if (c) return c.longText || c.shortText || '';
    }
    return '';
  };

  const streetNumber = getComp('street_number');
  const route        = getComp('route');
  const street       = streetNumber && route
    ? `${streetNumber} ${route}`
    : (place.formattedAddress?.split(',')[0]?.trim() || null);

  const city  = getComp('locality', 'sublocality_level_1', 'administrative_area_level_2')
    || place.formattedAddress?.split(',')?.[1]?.trim()
    || null;
  const state = getComp('administrative_area_level_1');
  const zip   = getComp('postal_code');

  return {
    id:            place.id,
    googlePlaceId: place.id,
    name:          place.displayName?.text || 'Unknown Business',
    category:      place.primaryTypeDisplayName?.text || null,
    phone:         null,  // fetched on demand via getPlaceDetails()
    address:       street,
    city,
    state,
    zip,
    latitude:      place.location?.latitude  ?? null,
    longitude:     place.location?.longitude ?? null,
    website:       place.websiteUri || null,
    hasWebsite:    !!place.websiteUri,
    googleMapsUrl: place.googleMapsUri || `https://maps.google.com/?place_id=${place.id}`,
    rating:        place.rating ?? null,
    reviewCount:   place.userRatingCount ?? 0,
    source:        'google',
  };
}

// ── Real Google Places API (New) search ────────────────────────────────────────
// Full results are cached for 15 min so duplicate searches within that window
// (common when users refine filters or paginate) cost nothing.
async function searchGoogle({ keyword, location, radius, minRating, minReviews, limit }) {
  // Build a stable cache key from all search parameters
  const cacheKey = JSON.stringify({
    k:  (keyword   || '').toLowerCase().trim(),
    l:  (location  || '').toLowerCase().trim(),
    r:  Number(radius)    || 10,
    mr: Number(minRating) || null,
    mv: Number(minReviews)|| null,
    lm: Math.min(Number(limit) || 20, 20),
  });

  const hit = searchCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.data;

  const parts     = [keyword, location].filter(Boolean);
  if (!parts.length) throw new Error('A keyword or location is required');

  const textQuery   = keyword && location ? `${keyword} near ${location}` : parts[0];
  const pageSize    = Math.min(Number(limit) || 20, 20);
  const radiusMeters = Math.min(Math.round((Number(radius) || 10) * 1609.34), 50000);

  const body = { textQuery, pageSize, languageCode: 'en' };

  const coords = await geocodeLocation(location);
  if (coords) {
    body.locationBias = {
      circle: {
        center: { latitude: coords.lat, longitude: coords.lng },
        radius: radiusMeters,
      },
    };
  }

  const data = await httpRequest(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Goog-Api-Key':  API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  let items = (data.places || [])
    .filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map(mapPlaceToLead);

  if (minRating)  items = items.filter((l) => l.rating       >= Number.parseFloat(minRating));
  if (minReviews) items = items.filter((l) => (l.reviewCount ?? 0) >= Number.parseInt(minReviews));

  const result = {
    items,
    pagination: {
      total:      items.length,
      page:       1,
      limit:      items.length,
      totalPages: 1,
      hasNext:    false,
      hasPrev:    false,
    },
    source: 'google',
  };

  searchCache.set(cacheKey, { data: result, expiresAt: Date.now() + SEARCH_TTL });
  return result;
}

// ── Demo / mock data ───────────────────────────────────────────────────────────
const FIRST_NAMES    = ['Smith', 'Johnson', 'Williams', 'Brown', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Anderson'];
const STREET_NAMES   = ['Main St', 'Oak Ave', 'Maple Blvd', 'Park Dr', 'Pine Rd', 'Cedar Ln', 'Elm St', 'Washington Blvd'];
const STATES         = ['FL', 'TX', 'CA', 'NY', 'OH', 'GA', 'AZ', 'IL', 'PA', 'NC'];

const BUSINESS_CATEGORIES = [
  'Restaurant', 'Auto Repair Shop', 'Hair Salon', 'Law Office', 'Dental Clinic',
  'Plumbing Service', 'HVAC Contractor', 'Landscaping Company', 'Real Estate Agency',
  'Insurance Agency', 'Accounting Firm', 'Fitness Center', 'Bakery', 'Coffee Shop',
  'Roofing Contractor', 'Electrical Service', 'Painting Contractor', 'Cleaning Service',
  'Pet Grooming Salon', 'Flooring Company', 'Photography Studio', 'Catering Company',
  'Chiropractic Office', 'Veterinary Clinic', 'Pharmacy',
];

function generateDemoBusinesses(keyword, location, count) {
  const city = location?.split(',')[0]?.trim() || 'Springfield';

  return Array.from({ length: count }, (_, i) => {
    const category = keyword
      ? keyword.trim()
      : BUSINESS_CATEGORIES[i % BUSINESS_CATEGORIES.length];
    const last = FIRST_NAMES[i % FIRST_NAMES.length];

    const nameFormats = [
      `${last}'s ${category}`,
      `${city} ${category}`,
      `${last} & Associates ${category}`,
      `Premier ${category}`,
      `${last} ${category} Co.`,
    ];
    const name = nameFormats[i % nameFormats.length];

    const hasWebsite  = (i % 10) > 3;
    const rating      = Number.parseFloat((2.5 + Math.random() * 2.5).toFixed(1));
    const reviewCount = Math.floor(Math.random() * 350) + 5;
    const lat         = 25.7617 + (((i * 137.5) % 100) / 1000 - 0.05);
    const lng         = -80.1918 + (((i * 97.3) % 100) / 1000 - 0.05);
    const streetNum   = 100 + (i * 73) % 9800;
    const street      = STREET_NAMES[i % STREET_NAMES.length];
    const state       = STATES[i % STATES.length];
    const zip         = String(10000 + ((i * 1337) % 89999)).padStart(5, '0');
    const phone       = `(${300 + (i % 600)}) ${200 + (i % 700)}-${1000 + (i % 8999)}`;
    const placeId     = `demo_place_${i}_${Date.now().toString(36)}`;

    return {
      id:            placeId,
      googlePlaceId: placeId,
      name,
      category,
      phone,          // demo data always includes phone inline
      address:       `${streetNum} ${street}`,
      city,
      state,
      zip,
      latitude:      lat,
      longitude:     lng,
      website:       hasWebsite ? `https://www.${last.toLowerCase()}${category.toLowerCase().replace(/[^a-z]/g, '')}.com` : null,
      hasWebsite,
      googleMapsUrl: `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + city)}`,
      rating,
      reviewCount,
      source: 'demo',
    };
  });
}

function searchDemo({ keyword, location, minRating, minReviews, page = 1, limit = 20 }) {
  let items = generateDemoBusinesses(keyword, location, 80);

  if (minRating)  items = items.filter((b) => b.rating      >= Number.parseFloat(minRating));
  if (minReviews) items = items.filter((b) => b.reviewCount >= Number.parseInt(minReviews));

  const total  = items.length;
  const offset = (Number(page) - 1) * Number(limit);
  const paged  = items.slice(offset, offset + Number(limit));

  return {
    items: paged,
    pagination: {
      total,
      page:       Number(page),
      limit:      Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      hasNext:    offset + Number(limit) < total,
      hasPrev:    Number(page) > 1,
    },
    source: 'demo',
  };
}

// ── Public entry point ─────────────────────────────────────────────────────────
async function searchLeads(params) {
  const { demo } = params;
  const useDemo  = GLOBAL_DEMO || demo === true || demo === 'true';

  if (!useDemo && API_KEY && API_KEY !== 'your_google_places_api_key_here') {
    return searchGoogle(params);
  }

  return searchDemo(params);
}

module.exports = { searchLeads, getPlaceDetails };
