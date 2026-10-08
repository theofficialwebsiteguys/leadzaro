# ADR 0010: Domains list — read-only Namecheap, linking in Leadzaro

## Status

Accepted. A short-lived version that let Leadzaro change DNS, nameservers, forwarding, contacts, lock and renewals at Namecheap was withdrawn before release: the team only needs to see domains and connect them to projects.

## Decision

1. **Domains list** (`/app/domains`): every domain in the workspace — linked or not, expiring or not — with client/project, status, nameservers, expiry and auto-renew; search and filters. Each opens a read-only domain page (`/app/domains/:id`), the same record reached from a client's Domains tab.
2. **Read-only toward Namecheap.** The client only sends `domains.getList`, `domains.dns.getList`, `users.getPricing`, `users.getBalances` and `ssl.getList`; everything else is refused in code. All changes are made in Namecheap.
3. **Linking stays in Leadzaro**: link a domain to a client/project from the domain page, or automatically from a website/live URL (ADR 0009); unlinking never touches Namecheap.
4. **Permission** `domains.view` (every employee role) for the list and domain pages; linking needs `projects.manage`; connecting the account needs `integrations.manage`.

## Consequences

- Hosting-plan, payment and cost screens were removed from the domain views; their tables and data (ADR 0009) remain and can be surfaced again if needed.
