'use strict';

/**
 * Fire-and-forget work that must not hold up an HTTP response (a manual
 * "Sync now", filling in nameservers after a domain is linked). Errors
 * are logged by name only — never with request URLs or credentials —
 * and tests can wait for everything started to finish.
 */

const pending = new Set();

function runInBackground(label, work) {
  const promise = Promise.resolve()
    .then(work)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[background] ${label} failed: ${err?.name || 'Error'}${err?.kind ? ` (${err.kind})` : ''}`);
    })
    .finally(() => pending.delete(promise));
  pending.add(promise);
  return promise;
}

async function flushBackgroundWork() {
  while (pending.size) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled([...pending]);
  }
}

/** Resolves with the work's result, or with `fallback` if it takes longer than `ms` (the work keeps running). */
function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
}

module.exports = { runInBackground, flushBackgroundWork, withTimeout };
