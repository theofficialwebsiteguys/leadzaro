# ADR 0008: A manual client hub, with clients that own several projects

## Status

Accepted (post-roadmap client management redesign).

## Context

Client management had to become a permanent, manual part of Leadzaro: staff must always be able to create a client by hand, edit every detail, attach projects and files, and see one complete profile — independent of the CRM/Stripe conversion flow, which remains one automated way in, not the only one.

Before this change:

- A client was already an `Organization` of type `client`, but the database enforced **exactly one `Project` per client** (`projects_organization_unique`), and `Project` had no name, type or description — the UI used the client's name as the project's name.
- Projects could only be created by `ensureProjectForConversion` (CRM → Stripe/manual conversion).
- There was nowhere to record a client's website/domain/hosting facts, what they pay us, or what they cost us, other than Stripe-synced `Subscription` rows and the per-project `ProjectFinancials`.
- Development file storage was an in-memory mock whose signed URLs were fake, so uploaded files could never be previewed or downloaded.

The master architecture (`02_MASTER_PRODUCT_SYSTEM_ARCHITECTURE.md` § 7) already describes a client `Organization` that owns shared files, websites, domains, subscriptions **and multiple projects**, so this change moves the implementation toward the specification rather than away from it.

## Decision

1. **Client stays `Organization` (type `client`); a client may own several projects.** The per-organization unique index is dropped. Conversion idempotency — the only thing that relied on it — moves to a partial unique index on `Projects.sourceConversionAttemptId`, and `ensureProjectForConversion` looks projects up by conversion attempt. Every project, however created, goes through one `createProjectRecord` so it always gets the default channel set in the same transaction.
2. **Projects gain descriptive fields** (`name`, `projectType`, `description`, `liveUrl`, `previewUrl`, `previewFileId`, `outstandingNeeds`). `name` is nullable and not backfilled: existing projects display under the client's name rather than receiving invented values. `outstandingNeeds` is a small JSONB checklist ("still needed" client inputs), deliberately not `Task` rows — the hub is not a task manager.
3. **One agency-only `ClientProfile` row per client** holds identity (description, logo, featured image, address, internal notes), website/hosting (URL, domain, registrar, hosting, renewal dates, admin links, access notes) and billing (setup price, recurring price/frequency, payment status, billing links, billing notes, our internal monthly cost and cost notes). Every field is nullable and individually typed, and the API accepts partial updates, so future onboarding forms or a Stripe sync can fill exactly the fields they know — automation is an additional way in, not a replacement for the manual forms. Profiles are created lazily on first edit.
4. **No secrets in the hub.** There are no password, card or bank-number fields; free-text fields reject text that looks like a password assignment or a Luhn-valid card number.
5. **`ClientNote`** replaces the short-lived, never-committed `ProjectNote`: one team notes feed per client, each note optionally pinned to one of its projects.
6. **Agency-only by construction.** `ClientProfile` and `ClientNote` are visibility-guarded and their accessors throw on a client-membership context; the `/api/v1/clients` router and project-notes route additionally require an employee membership, because client roles hold `projects.view` for their own project. Within the agency, our internal monthly cost, cost notes, access notes and the Stripe customer id are only returned to people holding `projects.manage` — the same bar as a project's internal financials — and the response's `canSeeInternals` flag tells the UI which view it received.
7. **Real local file storage for development.** `STORAGE_PROVIDER=local` (the new development default; tests keep `mock`, production stays `disabled` unless `live`) stores files on disk under a hash of their key and serves them only through short-lived HMAC-signed links — the same private-object + signed-URL model as the GCS provider. Only image/PDF types render inline; everything else downloads, sandboxed.

## Consequences

- Existing clients and project IDs are unchanged, so Messaging, Tasks, Media, Meetings, Requests and Project Settings keep working; the client hub links into each project's existing workspace.
- The migration runs in one transaction in each direction, and its `down()` refuses to restore the one-project-per-client constraint once any client actually has several projects, rather than silently deleting data.
- Two concurrent deliveries of the same conversion can both miss the "already has a project" lookup; the loser hits the partial unique index and returns the winner's project, so a conversion still yields exactly one.
- `ProjectFinancials` (per-project internal cost notes in Project Settings) and the client-level internal cost on `ClientProfile` now coexist; the client-level figure is the one used for the hub's margin summary.
- Deleting a project from the hub is not supported yet; projects can be created and edited.
- The signed-file route is unauthenticated by design and mounted before the general API rate limiter (it has its own). Its links are relative (`/api/v1/files/...`), which assumes the frontend and API share an origin, as they do today; a split-origin deployment should use the `live` (GCS) provider.
