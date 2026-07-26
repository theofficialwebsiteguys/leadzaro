'use strict';

const { STAGES, CLOSED_STAGES } = require('./pipelineCatalog');

const OPEN_STAGES = STAGES.filter((s) => !CLOSED_STAGES.has(s));

/**
 * A first-pass, rule-based engagement score (0-100) — not machine
 * learning, just a transparent, explainable heuristic combining signals
 * already available on the source Lead and the Opportunity itself:
 * product-fit (no website = the core thing Website Guys sells),
 * business establishment (reviews/rating as a rough budget proxy),
 * pipeline progress, and recency of activity. Deliberately simple and
 * easy to retune; every contributing factor is named in the returned
 * reason so a human can see why a score is what it is and override it
 * with their own judgment at any time (see `updateStage`).
 */
function computeAutoScore({
  hasWebsite, rating, reviewCount, stage, lastActivityAt,
}) {
  const parts = [];
  let score = 0;

  if (hasWebsite) {
    score += 10;
    parts.push('has a website (+10)');
  } else {
    score += 30;
    parts.push('no website (+30)');
  }

  if (typeof reviewCount === 'number' && reviewCount > 0) {
    const points = Math.min(20, Math.round(reviewCount / 5));
    score += points;
    parts.push(`${reviewCount} reviews (+${points})`);
  }

  const numericRating = rating === null || rating === undefined ? null : Number(rating);
  if (numericRating) {
    const points = Math.round((numericRating / 5) * 20);
    score += points;
    parts.push(`${numericRating}★ rating (+${points})`);
  }

  const stageIndex = OPEN_STAGES.indexOf(stage);
  if (stageIndex > 0) {
    const points = Math.round((stageIndex / (OPEN_STAGES.length - 1)) * 20);
    score += points;
    parts.push(`pipeline progress: ${stage} (+${points})`);
  }

  if (lastActivityAt) {
    const daysSince = (Date.now() - new Date(lastActivityAt).getTime()) / 86400000;
    if (daysSince <= 7) {
      score += 10;
      parts.push('active in the last 7 days (+10)');
    } else if (daysSince <= 30) {
      score += 5;
      parts.push('active in the last 30 days (+5)');
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reason: `Auto-calculated (${score}/100): ${parts.join(', ')}` };
}

module.exports = { computeAutoScore };
