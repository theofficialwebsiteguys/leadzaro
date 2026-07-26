'use strict';

// A fixed, well-known, non-loginable User row (isActive: false, a random
// unusable password hash) used as the `invitedByUserId` actor for
// system-initiated actions that have no human requester — currently only
// the client-user invitation Stripe webhooks trigger automatically on
// conversion (see docs/leadzaro/current-phase-plan.md § 7b). Seeded by
// server/migrations/20260726120002-seed-system-user.js.
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

module.exports = { SYSTEM_USER_ID };
