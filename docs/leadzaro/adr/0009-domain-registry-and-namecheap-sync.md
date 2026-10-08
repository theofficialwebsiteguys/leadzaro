# ADR 0009: Domain registry and Namecheap sync

## Status

Accepted. Extended by ADR 0010 (management actions).

## Context

Client profiles needed each domain's registrar, expiration, auto-renew, DNS, SSL, hosting and costs — synced from the agency's Namecheap account where possible, always editable by hand. The Phase 7 `namecheapAdapter`/`WebsiteDomain` belong to the hidden website builder (mock, write-oriented) and were left untouched.

## Decision

1. **Per-workspace connection** (`IntegrationConnections`): API user, username and whitelisted IPv4 in plain columns; the API key encrypted with AES-256-GCM (`INTEGRATION_SECRETS_KEY`; development derives a key from `JWT_SECRET`, production refuses to store credentials without a dedicated key). `status` is `connected` only after a real API call succeeds. Admin-only (`integrations.manage`).
2. **Registry**: `DomainRecords` (one per registrable domain per workspace; provider*, estimated* and manual columns kept separate so syncs never overwrite manual entries) and `ClientDomainLinks` (which client/project uses it; URL-derived links follow their URL; explicit confirm/reject decisions win). Registrable domains use the Public Suffix List (`tldts`); hosts keep meaningful subdomains; `www` is ignored for matching.
3. **Ownership**: a registration shows its details and costs only on the client that owns it — one client with an apex link, or the client a person confirmed. Links from several clients are a conflict; subdomain-only matches need review.
4. **Sync**: all `getList` pages; a domain is marked "not found in connected account" only after a complete listing omits it; nothing is deleted; failures keep last-known data and report partial/failed. Renewal estimates come from `users.getPricing` (never for premium names, never recorded as payments). Namecheap SSL certificates attach to their domain.
5. **Hosting and payments** are manual (`HostingPlans`, `HostingPlanClients` with equal/manual/none allocation, `ServiceExpenses`); shared plans are counted once.
6. **Scheduling**: a small in-process hourly check runs due daily syncs under a DB lock; `npm run jobs:run` for deployments without a long-running process.

## Consequences

- The retired `ClientProfiles` domain/hosting columns were copied into the registry and are kept only for rollback.
- The call budget (3 s spacing, hourly/daily caps) is per process.
