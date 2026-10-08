'use strict';

/**
 * Guard rails for free-text client fields. The client hub deliberately
 * has no place for secrets: access notes say *where* credentials live
 * (a password manager), and billing notes never hold card numbers.
 * These are heuristics — they catch the common "password: hunter2" and
 * pasted-card-number mistakes, not every possible secret.
 */
const PASSWORD_PATTERN = /\b(?:pass(?:word)?|passwd|pwd)\s*[:=]\s*\S+/i;
const DIGIT_RUN_PATTERN = /(?:\d[ -]?){13,19}/g;

function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsCardNumber(text) {
  const runs = text.match(DIGIT_RUN_PATTERN) || [];
  return runs.some((run) => luhnValid(run.replaceAll(/\D/g, '')));
}

/** Returns a user-facing reason if `text` looks like it holds a secret. */
function sensitiveDataProblem(text) {
  if (typeof text !== 'string' || !text) return null;
  if (PASSWORD_PATTERN.test(text)) {
    return 'Passwords can’t be stored here. Note where the credentials are kept instead (for example, your password manager).';
  }
  if (containsCardNumber(text)) {
    return 'Card or account numbers can’t be stored here. Link to the billing record in Stripe instead.';
  }
  return null;
}

module.exports = { sensitiveDataProblem };
