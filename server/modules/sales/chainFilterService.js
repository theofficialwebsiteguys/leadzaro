'use strict';

const { sequelize, Organization } = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { invalid, registrableDomain, assertNoSecrets } = require('./salesCommon');

/**
 * A free filter for obvious chains before qualification (ADR 0017).
 *
 * It uses only what a search already returns — the business name, its
 * website and the other results — against a curated, editable list of
 * brands and their corporate domains. No paid enrichment, no extra
 * requests, no per-result AI. Two levels:
 *   excluded — the name is a listed brand (allowing for location suffixes
 *              and punctuation), or the website is a listed corporate
 *              domain. Hidden from the research queue, with the reason, and
 *              one click to show or allow.
 *   possible — a hint only: several results share the name or a website,
 *              or the website is a location page on a larger site. Never
 *              hidden — a person decides.
 * Limits: brands not on the list get through; a local business that shares
 * a word with a brand is only caught when its name is exactly that brand;
 * Google's results don't say whether a business is part of a chain. Rule
 * changes never touch existing leads or opportunities — the filter only
 * applies to search results that aren't in Leadzaro yet.
 */

// [name, corporate domains, other names it goes by]
const DEFAULT_BRANDS = [
  // Fitness and wellness
  ['Planet Fitness', ['planetfitness.com']], ['Crunch Fitness', ['crunch.com'], ['Crunch Gym']], ['Anytime Fitness', ['anytimefitness.com']],
  ['LA Fitness', ['lafitness.com']], ['Gold’s Gym', ['goldsgym.com']], ['Orangetheory Fitness', ['orangetheory.com'], ['Orangetheory', 'Orange Theory Fitness']],
  ['F45 Training', ['f45training.com'], ['F45']], ['Snap Fitness', ['snapfitness.com']], ['Life Time', ['lifetime.life'], ['Life Time Fitness', 'Lifetime Fitness']],
  ['Equinox', ['equinox.com']], ['24 Hour Fitness', ['24hourfitness.com']], ['Blink Fitness', ['blinkfitness.com']], ['Retro Fitness', ['retrofitness.com']],
  ['Club Pilates', ['clubpilates.com']], ['Pure Barre', ['purebarre.com']], ['YogaSix', ['yogasix.com'], ['Yoga Six']], ['CycleBar', ['cyclebar.com']],
  ['StretchLab', ['stretchlab.com'], ['Stretch Lab']], ['Burn Boot Camp', ['burnbootcamp.com']], ['Title Boxing Club', ['titleboxingclub.com']],
  ['Workout Anytime', ['workoutanytime.com']], ['Chuze Fitness', ['chuzefitness.com']], ['EoS Fitness', ['eosfitness.com']], ['YouFit', ['youfit.com'], ['YouFit Gyms']],
  ['Massage Envy', ['massageenvy.com']], ['Hand & Stone Massage and Facial Spa', ['handandstone.com'], ['Hand and Stone', 'Hand & Stone']],
  ['European Wax Center', ['waxcenter.com']], ['The Joint Chiropractic', ['thejoint.com']], ['Restore Hyper Wellness', ['restore.com']],
  ['Great Clips', ['greatclips.com']], ['Supercuts', ['supercuts.com']], ['Sport Clips', ['sportclips.com'], ['Sport Clips Haircuts']], ['Fantastic Sams', ['fantasticsams.com']],
  ['Ulta Beauty', ['ulta.com'], ['Ulta']], ['Sephora', ['sephora.com']], ['Sola Salon Studios', ['solasalonstudios.com'], ['Sola Salons']],
  // Food and drink
  ['McDonald’s', ['mcdonalds.com']], ['Starbucks', ['starbucks.com']], ['Dunkin’', ['dunkindonuts.com', 'dunkin.com'], ['Dunkin Donuts']], ['Subway', ['subway.com']],
  ['Chipotle', ['chipotle.com'], ['Chipotle Mexican Grill']], ['Domino’s', ['dominos.com'], ['Dominos Pizza']], ['Pizza Hut', ['pizzahut.com']], ['Papa John’s', ['papajohns.com'], ['Papa Johns Pizza']],
  ['Burger King', ['bk.com', 'burgerking.com']], ['Wendy’s', ['wendys.com']], ['Taco Bell', ['tacobell.com']], ['KFC', ['kfc.com']], ['Chick-fil-A', ['chick-fil-a.com']],
  ['Panera Bread', ['panerabread.com']], ['Jersey Mike’s Subs', ['jerseymikes.com'], ['Jersey Mikes']], ['Jimmy John’s', ['jimmyjohns.com']], ['Dairy Queen', ['dairyqueen.com']],
  ['Applebee’s', ['applebees.com']], ['Olive Garden', ['olivegarden.com']], ['Panda Express', ['pandaexpress.com']], ['Five Guys', ['fiveguys.com']], ['Shake Shack', ['shakeshack.com']],
  ['Popeyes', ['popeyes.com'], ['Popeyes Louisiana Kitchen']], ['Arby’s', ['arbys.com']], ['Sonic Drive-In', ['sonicdrivein.com']], ['Little Caesars', ['littlecaesars.com']], ['Wingstop', ['wingstop.com']],
  ['Buffalo Wild Wings', ['buffalowildwings.com']], ['IHOP', ['ihop.com']], ['Denny’s', ['dennys.com']], ['Chili’s', ['chilis.com'], ['Chilis Grill & Bar']], ['Red Lobster', ['redlobster.com']],
  ['Outback Steakhouse', ['outback.com']], ['Texas Roadhouse', ['texasroadhouse.com']], ['The Cheesecake Factory', ['thecheesecakefactory.com']], ['Tim Hortons', ['timhortons.com']],
  ['Krispy Kreme', ['krispykreme.com']], ['Baskin-Robbins', ['baskinrobbins.com']], ['Cold Stone Creamery', ['coldstonecreamery.com']], ['Jamba', ['jamba.com'], ['Jamba Juice']],
  ['Smoothie King', ['smoothieking.com']], ['Tropical Smoothie Cafe', ['tropicalsmoothiecafe.com']], ['Qdoba', ['qdoba.com']], ['Moe’s Southwest Grill', ['moes.com']],
  ['Sweetgreen', ['sweetgreen.com']], ['CAVA', ['cava.com']], ['Wawa', ['wawa.com']], ['7-Eleven', ['7-eleven.com']], ['Sheetz', ['sheetz.com']], ['QuickChek', ['quickchek.com']],
  // Retail, grocery and pharmacy
  ['Walmart', ['walmart.com']], ['Target', ['target.com']], ['Costco', ['costco.com']], ['BJ’s Wholesale Club', ['bjs.com']], ['CVS Pharmacy', ['cvs.com'], ['CVS']],
  ['Walgreens', ['walgreens.com']], ['Rite Aid', ['riteaid.com']], ['The Home Depot', ['homedepot.com'], ['Home Depot']], ['Lowe’s', ['lowes.com'], ['Lowes Home Improvement']],
  ['Best Buy', ['bestbuy.com']], ['Staples', ['staples.com']], ['Dollar General', ['dollargeneral.com']], ['Dollar Tree', ['dollartree.com']], ['Family Dollar', ['familydollar.com']],
  ['Five Below', ['fivebelow.com']], ['TJ Maxx', ['tjmaxx.tjx.com', 'tjmaxx.com'], ['T.J. Maxx']], ['Marshalls', ['marshalls.com']], ['HomeGoods', ['homegoods.com']], ['Kohl’s', ['kohls.com']],
  ['Macy’s', ['macys.com']], ['PetSmart', ['petsmart.com']], ['Petco', ['petco.com']], ['GameStop', ['gamestop.com']], ['Michaels', ['michaels.com']], ['JOANN', ['joann.com'], ['Joann Fabrics']],
  ['Hobby Lobby', ['hobbylobby.com']], ['AutoZone', ['autozone.com']], ['Advance Auto Parts', ['advanceautoparts.com']], ['O’Reilly Auto Parts', ['oreillyauto.com']],
  ['Mattress Firm', ['mattressfirm.com']], ['ShopRite', ['shoprite.com']], ['Stop & Shop', ['stopandshop.com']], ['Whole Foods Market', ['wholefoodsmarket.com']],
  ['Trader Joe’s', ['traderjoes.com']], ['ALDI', ['aldi.us', 'aldi.com']], ['Kroger', ['kroger.com']], ['Safeway', ['safeway.com']], ['Publix', ['publix.com']], ['Wegmans', ['wegmans.com']],
  ['ACME Markets', ['acmemarkets.com']], ['Hannaford', ['hannaford.com']], ['Giant Food', ['giantfood.com'], ['Giant Food Stores']],
  // Auto service
  ['Jiffy Lube', ['jiffylube.com']], ['Valvoline Instant Oil Change', ['vioc.com'], ['Valvoline']], ['Midas', ['midas.com']], ['Meineke', ['meineke.com'], ['Meineke Car Care Center']],
  ['Firestone Complete Auto Care', ['firestonecompleteautocare.com'], ['Firestone']], ['Goodyear Auto Service', ['goodyear.com']], ['Monro Auto Service and Tire Centers', ['monro.com'], ['Monro']],
  ['Mavis Discount Tire', ['mavis.com'], ['Mavis Tires & Brakes']], ['Take 5 Oil Change', ['take5.com']], ['Safelite AutoGlass', ['safelite.com'], ['Safelite']],
  ['Caliber Collision', ['caliber.com']], ['Maaco', ['maaco.com']], ['Pep Boys', ['pepboys.com']], ['U-Haul', ['uhaul.com']],
  // Phone, banking, shipping and tax
  ['Verizon', ['verizon.com']], ['AT&T', ['att.com']], ['T-Mobile', ['t-mobile.com']], ['Metro by T-Mobile', ['metrobyt-mobile.com']], ['Cricket Wireless', ['cricketwireless.com']],
  ['Boost Mobile', ['boostmobile.com']], ['The UPS Store', ['theupsstore.com']], ['FedEx Office', ['fedex.com']], ['H&R Block', ['hrblock.com']], ['Jackson Hewitt', ['jacksonhewitt.com']],
  ['Chase Bank', ['chase.com'], ['Chase']], ['Bank of America', ['bankofamerica.com']], ['Wells Fargo', ['wellsfargo.com']], ['TD Bank', ['td.com', 'tdbank.com']], ['Citibank', ['citi.com']],
  ['PNC Bank', ['pnc.com']], ['Capital One', ['capitalone.com']], ['KeyBank', ['key.com']], ['M&T Bank', ['mtb.com']], ['Santander Bank', ['santanderbank.com']],
  // Health
  ['CityMD', ['citymd.com']], ['Aspen Dental', ['aspendental.com']], ['Pearle Vision', ['pearlevision.com']], ['LensCrafters', ['lenscrafters.com']],
  ['America’s Best Contacts & Eyeglasses', ['americasbest.com'], ['Americas Best']], ['Visionworks', ['visionworks.com']], ['MyEyeDr', ['myeyedr.com']],
  ['Banfield Pet Hospital', ['banfield.com']], ['VCA Animal Hospital', ['vcahospitals.com']], ['Quest Diagnostics', ['questdiagnostics.com']], ['Labcorp', ['labcorp.com']],
  // Hotels and storage
  ['Marriott', ['marriott.com']], ['Hilton', ['hilton.com']], ['Hampton Inn', ['hilton.com']], ['Holiday Inn', ['ihg.com']], ['Best Western', ['bestwestern.com']],
  ['Courtyard by Marriott', ['marriott.com']], ['Residence Inn', ['marriott.com']], ['Comfort Inn', ['choicehotels.com']], ['Days Inn', ['wyndhamhotels.com']], ['Super 8', ['wyndhamhotels.com']],
  ['Motel 6', ['motel6.com']], ['La Quinta Inn & Suites', ['wyndhamhotels.com'], ['La Quinta']], ['Public Storage', ['publicstorage.com']], ['Extra Space Storage', ['extraspace.com']],
  ['CubeSmart', ['cubesmart.com']],
  // Learning and childcare
  ['Mathnasium', ['mathnasium.com']], ['Kumon', ['kumon.com']], ['Sylvan Learning', ['sylvanlearning.com']], ['Huntington Learning Center', ['huntingtonhelps.com']],
  ['KinderCare', ['kindercare.com']], ['The Goddard School', ['goddardschool.com']], ['Primrose School', ['primroseschools.com']], ['Bright Horizons', ['brighthorizons.com']],
  ['The Learning Experience', ['thelearningexperience.com']], ['Code Ninjas', ['codeninjas.com']], ['Goldfish Swim School', ['goldfishswimschool.com']], ['School of Rock', ['schoolofrock.com']],
  ['The Little Gym', ['thelittlegym.com']],
  // Home services franchises
  ['Stanley Steemer', ['stanleysteemer.com']], ['SERVPRO', ['servpro.com']], ['ServiceMaster', ['servicemaster.com']], ['Molly Maid', ['mollymaid.com']], ['Merry Maids', ['merrymaids.com']],
  ['Two Men and a Truck', ['twomenandatruck.com']], ['Mr. Rooter Plumbing', ['mrrooter.com']], ['Roto-Rooter', ['rotorooter.com']], ['Mr. Handyman', ['mrhandyman.com']],
  ['Terminix', ['terminix.com']], ['Orkin', ['orkin.com']], ['TruGreen', ['trugreen.com']], ['Sherwin-Williams', ['sherwin-williams.com']],
];

// A name matches a brand when, without its location suffix, it IS the brand
// ("Planet Fitness - Tarrytown" is Planet Fitness). Starting with the brand
// ("Starbucks Reserve") also counts for distinctive names only: these
// one-word brands, and multi-word ones that aren't everyday phrases.
const DISTINCT_SINGLE = new Set(['starbucks', 'mcdonalds', 'walgreens', 'walmart', 'supercuts', 'orangetheory', 'chipotle', 'petsmart', 'petco', 'gamestop', 'autozone', 'cubesmart', 'mathnasium', 'kumon', 'kindercare', 'citymd', 'lenscrafters', 'visionworks', 'myeyedr', 'labcorp', 'wingstop', 'sheetz', 'wawa', 'quickchek', 'servpro', 'terminix', 'orkin', 'trugreen', 'stretchlab', 'cyclebar', 'yogasix', 'popeyes', 'qdoba', 'sweetgreen', 'ihop', 'kfc', 'maaco', 'meineke', 'sephora', 'ulta', 'costco', 'wegmans', 'publix', 'kroger', 'shoprite', 'homegoods']);
const COMMON_PHRASES = new Set(['life time', 'five guys', 'best buy', 'five below', 'bright horizons', 'learning experience', 'capital one', 'best western', 'little gym', 'giant food']);

const SEPARATORS = /\s+[-–—|@]\s+|\s*[|(#,]\s*|\s+at\s+/i;
const LOCATION_WORDS = new Set(['store', 'location', 'branch', 'gym', 'club', 'studio', 'center', 'centre', 'shop', 'clinic', 'office', 'restaurant', 'cafe', 'pharmacy', 'market', 'outlet', 'express', 'north', 'south', 'east', 'west', 'downtown', 'uptown', 'plaza', 'mall', 'square', 'village', 'ny', 'nj', 'ct', 'pa', 'ma', 'usa', 'of', 'in', 'and', 'by', 'near']);
const LOCATION_PATH = /\/(locations?|gyms?|clubs?|stores?|studios?|branch(es)?|offices?|centers?|restaurants?|near-?me|find-a-[a-z-]+|store-locator|local)(\/|\?|$)|[?&](location|store|club)(_?id)?=/i;
// Hosts many unrelated businesses share; a shared one proves nothing.
const SHARED_HOSTS = new Set(['facebook.com', 'instagram.com', 'google.com', 'business.site', 'wixsite.com', 'squarespace.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'blogspot.com', 'square.site', 'linktr.ee', 'yelp.com', 'vagaro.com', 'mindbodyonline.com', 'booksy.com', 'schedulicity.com', 'toasttab.com', 'doordash.com', 'grubhub.com', 'ubereats.com']);

function normalize(value) {
  return String(value || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function brandKey(name) {
  return normalize(name).replace(/\s+/g, '_').slice(0, 60) || null;
}

/** "Planet Fitness - Tarrytown, NY #1234" → "planet fitness": the name without its location suffix. */
function coreName(item) {
  const first = String(item.name || '').split(SEPARATORS)[0] || '';
  const placeWords = new Set(normalize([item.city, item.state].filter(Boolean).join(' ')).split(' ').filter(Boolean));
  const words = normalize(first).split(' ').filter(Boolean);
  while (words.length > 1 && (placeWords.has(words[words.length - 1]) || LOCATION_WORDS.has(words[words.length - 1]) || /^\d+$/.test(words[words.length - 1]))) words.pop();
  return words.join(' ');
}

function buildBrand([name, domains = [], aliases = []], source = 'default') {
  const names = [name, ...aliases].map(normalize).filter(Boolean);
  const key = brandKey(name);
  return {
    key, name, domains: domains.map((d) => String(d).toLowerCase()), aliases, names, source,
    // "Target", "Subway" or "Life Time" are also ordinary words: those match only exactly.
    prefixNames: names.filter((n) => (n.includes(' ') ? !COMMON_PHRASES.has(n) : DISTINCT_SINGLE.has(n))),
  };
}

const DEFAULTS = DEFAULT_BRANDS.map((b) => buildBrand(b));

function settingsOf(organization) {
  const s = organization?.settings?.chainFilter || {};
  return {
    addedBrands: Array.isArray(s.addedBrands) ? s.addedBrands : [],
    disabledBrands: Array.isArray(s.disabledBrands) ? s.disabledBrands : [],
    allowedPlaces: Array.isArray(s.allowedPlaces) ? s.allowedPlaces : [],
  };
}

function rulesFrom(settings) {
  const disabled = new Set(settings.disabledBrands);
  const custom = settings.addedBrands.map((b) => buildBrand([b.name, b.domains || [], b.aliases || []], 'custom'));
  return [...DEFAULTS, ...custom].filter((b) => !disabled.has(b.key));
}

function matchBrand(brands, item) {
  const core = coreName(item);
  const full = normalize(item.name);
  const domain = registrableDomain(item.website);
  for (const brand of brands) {
    const exact = brand.names.some((n) => core === n || full === n);
    const prefix = brand.prefixNames.some((n) => core.startsWith(`${n} `) || full.startsWith(`${n} `));
    if (exact || prefix) return { brand, reason: `${brand.name} is on the excluded brands list` };
  }
  if (domain && !SHARED_HOSTS.has(domain)) {
    const brand = brands.find((b) => b.domains.some((d) => d === domain || registrableDomain(d) === domain));
    if (brand) return { brand, reason: `Its website is on ${domain} (${brand.name})` };
  }
  return null;
}

/**
 * Chain status for each search result, in result order: { status, reasons,
 * brandKey, brandName } where status is 'excluded', 'possible', 'allowed'
 * (an exception someone saved) or null.
 */
function classify(items, settings) {
  const brands = rulesFrom(settings);
  const allowed = new Map(settings.allowedPlaces.map((p) => [p.googlePlaceId, p]));
  const cores = new Map();
  const domains = new Map();
  for (const item of items) {
    const core = coreName(item);
    if (core.length >= 4) cores.set(core, (cores.get(core) || 0) + 1);
    const domain = registrableDomain(item.website);
    if (domain && !SHARED_HOSTS.has(domain)) {
      if (!domains.has(domain)) domains.set(domain, new Set());
      domains.get(domain).add(core);
    }
  }
  return items.map((item) => {
    const placeId = item.googlePlaceId || item.id;
    const match = matchBrand(brands, item);
    const hints = [];
    const core = coreName(item);
    const sameName = cores.get(core) || 0;
    if (sameName >= 3) hints.push(`${sameName} results share this name — it may be a chain`);
    if (item.website && LOCATION_PATH.test(String(item.website))) hints.push('Its website is a location page on a larger site');
    const domain = registrableDomain(item.website);
    const sharers = domain && domains.get(domain) ? domains.get(domain).size - 1 : 0;
    if (sharers >= 2) hints.push(`Shares its website with ${sharers} other businesses in these results`);
    const exception = allowed.get(placeId);
    if (exception) {
      return {
        status: 'allowed', reasons: [`Allowed${exception.byName ? ` by ${exception.byName}` : ''} — ${match ? match.reason : 'an exception'}`], brandKey: match?.brand.key || null, brandName: match?.brand.name || null,
      };
    }
    if (match) return { status: 'excluded', reasons: [match.reason, ...hints], brandKey: match.brand.key, brandName: match.brand.name };
    if (hints.length) return { status: 'possible', reasons: hints, brandKey: null, brandName: null };
    return { status: null, reasons: [], brandKey: null, brandName: null };
  });
}

async function agencySettings(agencyId, transaction = null) {
  const organization = await Organization.findByPk(agencyId, { attributes: ['id', 'settings'], ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) });
  return { organization, settings: settingsOf(organization) };
}

/** Adds chain status to search results that aren't in Leadzaro yet; leads already saved are never touched. */
async function annotate(agencyId, items) {
  const pending = items.filter((i) => !i.pipeline);
  if (!pending.length) return items;
  const { settings } = await agencySettings(agencyId);
  const results = classify(pending, settings);
  const byItem = new Map(pending.map((item, i) => [item, results[i]]));
  return items.map((item) => (byItem.has(item) ? { ...item, chain: byItem.get(item) } : item));
}

const LIMITS = 'Matches names and corporate websites against the list below, using only what the search already returned. Brands that aren’t listed get through; a local business sharing a word with a brand is only caught when its name is exactly that brand; “Possible chain” is a hint for you to check, never a decision. Changing the list never changes leads already in Leadzaro.';

function canEditBrands(ctx) { return ctx.can('workspace.manage') || ctx.can('leads.assign'); }
function canAllowPlaces(ctx) { return ctx.can('qualification.work') || canEditBrands(ctx); }

async function getSettings(ctx) {
  const { settings } = await agencySettings(ctx.agencyId);
  const disabled = new Set(settings.disabledBrands);
  return {
    brands: [...DEFAULTS, ...settings.addedBrands.map((b) => buildBrand([b.name, b.domains || [], b.aliases || []], 'custom'))].map((b) => ({
      key: b.key, name: b.name, domains: b.domains, aliases: b.aliases, source: b.source, enabled: !disabled.has(b.key),
    })),
    allowedPlaces: settings.allowedPlaces,
    canEditBrands: canEditBrands(ctx),
    canAllowPlaces: canAllowPlaces(ctx),
    limits: LIMITS,
  };
}

async function mutate(ctx, change, audit) {
  await sequelize.transaction(async (transaction) => {
    const { organization, settings } = await agencySettings(ctx.agencyId, transaction);
    const next = change({ ...settings });
    await organization.update({ settings: { ...(organization.settings || {}), chainFilter: next } }, { transaction });
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.chain_filter_updated', targetType: 'Organization', targetId: ctx.agencyId, metadata: audit, req: ctx.req,
  });
  return getSettings(ctx);
}

/** Managers edit the list: add a brand, remove one they added, or switch a listed brand off (or back on). */
async function updateBrands(ctx, { action, name, domains, aliases, key } = {}) {
  if (!canEditBrands(ctx)) throw invalid('Only a manager can change the excluded brands.', 403);
  if (action === 'add') {
    const clean = String(name || '').trim().slice(0, 80);
    if (normalize(clean).length < 3) throw invalid('Enter the brand name.', 422, { field: 'name' });
    assertNoSecrets(clean, 'Brand');
    const list = (Array.isArray(domains) ? domains : String(domains || '').split(/[\s,]+/)).map((d) => registrableDomain(String(d).trim())).filter(Boolean).slice(0, 5);
    const alt = (Array.isArray(aliases) ? aliases : String(aliases || '').split(',')).map((a) => String(a).trim().slice(0, 80)).filter(Boolean).slice(0, 5);
    const newKey = brandKey(clean);
    return mutate(ctx, (s) => ({
      ...s,
      addedBrands: [...s.addedBrands.filter((b) => brandKey(b.name) !== newKey), { name: clean, domains: list, aliases: alt, by: ctx.userId, at: new Date().toISOString() }],
      disabledBrands: s.disabledBrands.filter((k) => k !== newKey),
    }), { action, brand: clean });
  }
  if (!key) throw invalid('Choose a brand.');
  if (action === 'remove') return mutate(ctx, (s) => ({ ...s, addedBrands: s.addedBrands.filter((b) => brandKey(b.name) !== key) }), { action, key });
  if (action === 'disable') return mutate(ctx, (s) => ({ ...s, disabledBrands: [...new Set([...s.disabledBrands, key])] }), { action, key });
  if (action === 'enable') return mutate(ctx, (s) => ({ ...s, disabledBrands: s.disabledBrands.filter((k) => k !== key) }), { action, key });
  throw invalid('Unknown change');
}

/** An exception for one location: it shows up in searches even though it matches the list. */
async function allowPlace(ctx, { googlePlaceId, name } = {}) {
  if (!canAllowPlaces(ctx)) throw invalid('You can’t change the search filters.', 403);
  const placeId = String(googlePlaceId || '').trim().slice(0, 255);
  if (!placeId) throw invalid('Missing listing id');
  return mutate(ctx, (s) => ({
    ...s,
    allowedPlaces: [...s.allowedPlaces.filter((p) => p.googlePlaceId !== placeId), {
      googlePlaceId: placeId, name: String(name || '').trim().slice(0, 255) || null, by: ctx.userId, byName: ctx.user?.name || null, at: new Date().toISOString(),
    }].slice(-500),
  }), { action: 'allow_place', googlePlaceId: placeId });
}

async function removeAllowedPlace(ctx, googlePlaceId) {
  if (!canAllowPlaces(ctx)) throw invalid('You can’t change the search filters.', 403);
  const placeId = String(googlePlaceId || '');
  return mutate(ctx, (s) => ({ ...s, allowedPlaces: s.allowedPlaces.filter((p) => p.googlePlaceId !== placeId) }), { action: 'remove_place', googlePlaceId: placeId });
}

module.exports = {
  DEFAULT_BRANDS, classify, annotate, getSettings, updateBrands, allowPlace, removeAllowedPlace, coreName, normalize, settingsOf,
};
