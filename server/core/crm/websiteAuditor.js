'use strict';

/**
 * Rule-based website audit — a v1, adapter-boundary implementation.
 * Deliberately does not fetch the prospect's actual website: making the
 * server issue outbound requests to an arbitrary caller/lead-supplied
 * URL is a real SSRF surface (internal network/cloud-metadata access),
 * and doing that safely (hostname/IP allowlisting, redirect validation
 * at every hop, timeouts) is substantial, security-critical work of its
 * own. Per the standing external-services rule ("build the adapter
 * interface + a real, useful mock/rule-based mode first, don't block on
 * a live integration"), this generates a genuinely useful report from
 * data already on file — has-a-website, URL scheme, and Google review
 * signals — with the same shape (checks + score + summary) a future
 * live-fetch or third-party-API-backed implementation would return, so
 * callers never need to change when that lands.
 */
function runRuleBasedAudit({
  hasWebsite, website, rating, reviewCount, category,
}) {
  const checks = [];

  checks.push({
    key: 'has_website',
    label: 'Has a website',
    passed: !!hasWebsite,
    detail: hasWebsite ? (website || 'A website is on file.') : 'No website found for this business.',
  });

  if (hasWebsite && website) {
    const isHttps = website.trim().toLowerCase().startsWith('https://');
    checks.push({
      key: 'uses_https',
      label: 'Website uses HTTPS',
      passed: isHttps,
      detail: isHttps ? 'Served securely over HTTPS.' : 'Not served over HTTPS — browsers flag this as "Not Secure."',
    });
  }

  const numericReviewCount = typeof reviewCount === 'number' ? reviewCount : 0;
  checks.push({
    key: 'has_google_reviews',
    label: 'Has Google reviews',
    passed: numericReviewCount > 0,
    detail: numericReviewCount > 0 ? `${numericReviewCount} Google review(s) on file.` : 'No Google reviews found yet.',
  });

  const numericRating = rating === null || rating === undefined ? null : Number(rating);
  if (numericRating !== null) {
    checks.push({
      key: 'strong_rating',
      label: 'Strong average rating',
      passed: numericRating >= 4.0,
      detail: `${numericRating}★ average rating.`,
    });
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 0;

  const summaryParts = [];
  if (!hasWebsite) {
    summaryParts.push('This business has no website on file — a strong opportunity to build one from scratch.');
  } else {
    const httpsCheck = checks.find((c) => c.key === 'uses_https');
    summaryParts.push(httpsCheck?.passed
      ? 'This business has a website served securely over HTTPS.'
      : 'This business has a website, but it is not served over HTTPS — a rebuild could improve trust and search rankings.');
  }
  if (numericReviewCount > 0) {
    summaryParts.push(numericRating !== null
      ? `It has ${numericReviewCount} Google review(s) with a ${numericRating}★ average, indicating an established customer base${category ? ` in the ${category} category` : ''}.`
      : `It has ${numericReviewCount} Google review(s) on file.`);
  } else {
    summaryParts.push('It does not yet have any Google reviews, suggesting limited online visibility.');
  }

  return { score, summary: summaryParts.join(' '), checks };
}

module.exports = { runRuleBasedAudit };
