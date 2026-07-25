# Leadzaro Master Product and System Architecture

## 1. Product definition

Leadzaro is the internal operating system for The Website Guys and the technical foundation of The Website Guys Client Portal.

It connects the complete lifecycle:

```text
Public inbound acquisition / Lead search
                 ↓
Prospect organization and CRM opportunity
                 ↓
Proposal, agreement, Stripe link and payment
                 ↓
Client conversion and workspace creation
                 ↓
Project management and content collection
                 ↓
Visual website design
                 ↓
Angular code and GitHub development
                 ↓
Preview, review and production deployment
                 ↓
Ongoing subscription support and analytics
```

## 2. Primary business objective

Reduce key-person risk by encoding The Website Guys’ methods into:

- repeatable workflows;
- reusable components and templates;
- permissions and assignments;
- standardized project stages;
- shared client communication;
- automated billing and conversion;
- developer-quality generated code;
- deployment and domain operations;
- persistent data and reporting.

The company should be operable by trained employees without requiring Jared to personally understand or perform every action.

## 3. Product boundaries

### In scope

- Website Guys employees with multiple roles
- Multiple users per client organization
- Public inbound Website Guys landing pages
- Google-based lead generation and CRM
- Project, task, workload, request, meeting, file, and communication management
- Stripe subscriptions, Payment Links, and client billing
- Visual website builder
- Angular generation and developer extensions
- GitHub/GitHub Pages previews
- Namecheap/cPanel production operations
- Google Cloud Storage
- Analytics
- Ongoing subscription support
- Paid SEO module

### Out of initial scope

- Multi-agency SaaS launch
- Cannabis-specific website or POS functionality
- Full Slack/Discord replacement
- Full email hosting/provider functionality
- Mandatory AI
- Two-factor authentication in the initial release
- Fully live Figma-style simultaneous editing
- Microservices

## 4. Architecture style

Use a **modular monolith**.

Reasons:

- one current engineering owner;
- easier local development and deployment;
- transactional workflows across sales, billing, clients, and projects;
- fewer operational failure modes;
- clear module boundaries can still be extracted later.

### Target backend structure

```text
server/
  app.js
  server.js
  core/
    config/
    database/
    authentication/
    authorization/
    events/
    jobs/
    audit/
    notifications/
    storage/
    errors/
    validation/
    observability/
  modules/
    organizations/
    users/
    invitations/
    leads/
    prospecting/
    crm/
    outreach/
    inbound/
    clients/
    billing/
    projects/
    tasks/
    requests/
    messaging/
    meetings/
    files/
    content/
    websites/
    builder/
    source-control/
    deployments/
    domains/
    hosting/
    analytics/
    seo/
    support/
  migrations/
  seeders/
  tests/
```

Migration must be incremental. Existing controllers and routes may temporarily delegate to new module services rather than being moved all at once.

### Target frontend structure

```text
src/app/
  core/
    auth/
    authorization/
    api/
    state/
    errors/
    notifications/
  shell/
    layouts/
    navigation/
    context-switcher/
  features/
    public-site/
    sales/
    crm/
    clients/
    projects/
    requests/
    messages/
    files/
    builder/
    development/
    deployments/
    billing/
    analytics/
    seo/
    settings/
  shared/
    components/
    forms/
    utilities/
    models/
```

Continue using Angular standalone components, lazy routes, strict TypeScript, signals, typed reactive forms, and focused services/stores.

## 5. Identity, organizations, and access

### User

A User is a global login identity. A user does not directly own agency data.

### Organization

An Organization represents one of:

- The Website Guys agency
- A client business
- A prospect business

An organization may transition from prospect to client without losing activity history.

### OrganizationMembership

Connects a User to an Organization with status and access metadata.

### Roles and permissions

Employees may hold multiple roles. Start with predefined roles and individual overrides.

Employee roles:

- Administrator
- Sales Representative
- Sales Manager
- Project Manager
- Designer
- Advanced Designer
- Developer
- Support
- Billing

Client roles:

- Client Owner
- Project Contact
- Marketing
- Billing Contact
- Content Editor
- Viewer

Permission examples:

```text
leads.search
leads.save
leads.merge
leads.assign
crm.manage_pipeline
billing.create_payment_link
billing.view_financials
clients.invite_users
projects.manage
projects.change_stage
builder.edit_basic
builder.edit_professional
builder.edit_advanced
builder.components.publish
code.promote_to_development
deployments.publish_production
domains.manage_dns
support.manage_queue
```

Authorization result combines:

```text
membership role permissions
+ individual grants
- individual restrictions
+ organization scope
+ project/client assignments
```

All important authorization must be enforced server-side.

## 6. Authentication and sessions

Initial supported behavior:

- email/password login;
- email verification;
- password reset;
- employee and client invitations;
- revocable sessions;
- administrator session revocation;
- optional Google login later;
- no required 2FA initially.

Target secure design:

- short-lived access credentials;
- revocable server-side session records;
- secure HttpOnly cookie for refresh/session continuity where deployment topology permits;
- compatibility support for existing bearer tokens only during migration;
- no long-lived privileged token stored permanently in browser local storage;
- audit login, logout, failed login, password change, invite acceptance, and impersonation.

## 7. Core domain model

### Sales domain

```text
Organization (prospect)
├── Locations
├── Contacts
├── Opportunities
├── Search Campaign Memberships
├── Activities
├── Notes
├── Website Audits
├── Scores
├── Assignments
└── Conversion History
```

Search results remain temporary until saved, claimed, contacted, imported, or used to create an opportunity.

### Client and project domain

```text
Client Organization
├── Users and Roles
├── Billing Account
├── Shared Files
├── Locations
├── Websites
├── Domains
├── Subscriptions
└── Projects
    ├── Owner and Team Roles
    ├── Milestones and Stages
    ├── Tasks and Subtasks
    ├── Requests
    ├── Channels and Messages
    ├── Meetings
    ├── Files
    ├── Content Requests
    ├── Approvals/Acknowledgments
    ├── Deliverables
    ├── Time Entries
    └── Activity History
```

### Project lifecycle

```text
Lead
Qualified
Proposal
Closed Won
Client Onboarding
Content Collection
Design
Client Review
Development
QA
Client Approval
Launch
Ongoing Support
```

Transitions use soft gates. The interface warns about missing items, but authorized users may proceed with an override reason. Launch has the strongest checklist.

## 8. CRM behavior

Default pipeline:

```text
Discovered
New Lead
Researching
Attempting Contact
Contacted
Engaged
Qualified
Proposal or Offer Prepared
Payment Link Sent
Closed Won
Closed Lost
Nurture
Do Not Contact
```

Support:

- private and shared saved search campaigns;
- optional territories;
- manual claim, manager assignment, and round-robin assignment;
- opportunity and engagement scores;
- manual score adjustments with reasons;
- contact discovery and optional enrichment adapters;
- employee merge with warning, preview, audit, and undo/restore capability;
- email integration;
- call, visit, voicemail, website-form, and manual social activity logging;
- assisted outreach sequences requiring employee approval;
- lead finder, owner, closer, support, source, commission, and revenue attribution.

## 9. Payment and client conversion

An employee creates a Stripe Payment Link from a lead/opportunity using an internal service catalog.

Expected flow:

```text
Opportunity
  ↓
Select plan/package/add-ons
  ↓
Generate Stripe Payment Link with internal metadata
  ↓
Payment completed
  ↓
Verified idempotent webhook
  ↓
Create/match Stripe customer and subscription
  ↓
Mark opportunity Closed Won
  ↓
Convert organization to client
  ↓
Create client users/workspace/project/template
  ↓
Send portal invitation
```

Manual conversion remains available for checks, cash, imported clients, custom agreements, or webhook recovery.

Billing authority eventually belongs to the client organization/billing account, not an individual User.

## 10. Project operations

Projects support:

- one primary owner;
- required roles plus assigned people;
- one employee filling several roles;
- consistent tabs with irrelevant modules hidden;
- list, board, calendar, and timeline task views;
- dependencies, subtasks, tags, priority, estimates, time tracking, files, internal notes, and client visibility;
- employee workload and basic capacity view;
- suggested project health with manual override;
- meeting requests that require team confirmation;
- project-focused internal notes while company chat remains in Discord;
- immutable audit events for important changes.

## 11. Communication

No unrestricted client-to-employee direct messaging.

Communication is project and role based:

- General Project
- Content and Assets
- Design Feedback
- Development Questions
- Billing
- Launch and Domains
- Ongoing Support

Messages support attachments, mentions, threads, read state, links to tasks/pages/sections/invoices, and conversion to tasks.

Employees also have client-hidden project channels and notes.

## 12. Requests and ongoing service

The client workspace persists after launch.

Client requests are included in monthly subscriptions and route through a service queue. Plans may define different request rules. The default can allow unlimited submissions with limited simultaneous active work.

Request categories include content, image, hours, page/section, design, form, bug, domain, analytics, functionality, and emergency issues.

Track estimated effort, actual time, waiting time, completion time, client volume, employee workload, and subscription profitability even when no extra invoice is created.

## 13. Files and content

Use Google Cloud Storage behind a `StorageProvider` interface.

Files are private by default and accessed through short-lived signed URLs.

Scopes:

- organization files;
- project files;
- website assets;
- task/message/request/meeting attachments.

Image processing should preserve originals and create optimized responsive variants without requiring a paid image-transformation service.

Content scopes:

- organization content;
- website-global content;
- page/section content.

Client publishing behavior is configurable by role and content type. Some fields publish immediately; design, navigation, pages, legal copy, and other sensitive changes require employee review.

## 14. Website builder

### Starting modes

- Guided generation
- Complete template
- Page kit
- Blank website

### Editing levels

Basic:

- content, images, section variants, colors, fonts, reorder.

Professional:

- grids, columns, spacing, alignment, backgrounds, borders, shadows, animations, responsive visibility and variants.

Advanced:

- approved custom properties, advanced positioning, registered components, custom animations, controlled developer functionality.

### Schema-first rule

The primary source of truth is a structured versioned website definition, not arbitrary Angular source files.

Example:

```json
{
  "siteId": "site_123",
  "designSystemId": "ds_123",
  "pages": [
    {
      "id": "page_home",
      "route": "/",
      "sections": [
        {
          "id": "section_hero",
          "componentKey": "hero",
          "variant": "split-image",
          "settings": {},
          "content": {}
        }
      ]
    }
  ]
}
```

### Component states

- Managed
- Extended
- Registered Custom Component
- Detached

Developer-created components can expose an editor schema so designers can continue using them. Fully custom code may remain detached while still being movable, visible, versioned, and configurable through explicitly exposed properties.

### Collaboration

Use section-level locks, presence indicators, autosave, comments, named versions, comparisons, and restore points. Do not implement full operational-transform live editing initially.

## 15. Angular code generation

Generated output must be developer-quality and typed.

Standard sections use reusable components plus configuration. A dedicated component is created when a section is detached or materially customized.

Separate generated and custom areas:

```text
src/app/
  generated/
    pages/
    configuration/
  components/
    standard/
  custom/
    components/
    features/
    integrations/
styles/
  design-tokens.scss
  global.scss
site.schema.json
leadzaro.config.json
```

Builder regeneration must never overwrite developer-owned custom code.

## 16. Source control and deployment

Repository creation occurs when design work begins.

Designer promotion to development may be initiated independently and should:

- create a named design checkpoint;
- activate development branches;
- create technical handoff documentation;
- create tasks for custom requirements;
- deploy a preview;
- notify assigned roles;
- preserve the builder version.

Preview branches deploy automatically to GitHub Pages.

Production deployment is manual:

```text
Merge/selected commit
  ↓
Employee clicks Deploy to Production
  ↓
Production Angular build
  ↓
Validation
  ↓
Backup current cPanel folder
  ↓
Upload new build
  ↓
Health checks
  ↓
Success or rollback
```

Namecheap/cPanel/GitHub/GCS integrations must use adapter interfaces.

## 17. Shared website services

Platform-built websites can use a managed website-services API for:

- contact forms;
- notifications;
- lead capture;
- appointment requests;
- newsletter signup;
- file uploads;
- structured dynamic content;
- blog/events;
- analytics events;
- spam protection;
- webhooks.

Custom application backends remain separate developer projects.

## 18. Forms

The builder includes a client-editable form builder with normal field addition, deletion, labels, options, order, required settings, files, conditional behavior, multi-step flow, and confirmation messages.

Employees control sensitive routing, webhook, spam, retention, and hidden tracking settings by default.

Every change is versioned and restorable.

## 19. Analytics and SEO

Use hybrid analytics:

- Leadzaro records high-value actions itself;
- Google Analytics can be connected through guided instructions;
- client dashboards show business-focused summaries.

SEO is a paid entitlement.

Start with a staged approach:

1. dashboard and technical checks;
2. recurring SEO tasks and reports;
3. later full campaign workspace.

Non-SEO clients still receive technically functional pages, but ongoing SEO management, Search Console, reports, recommendations, and employee workflows remain paywalled.

## 20. Public acquisition

Create multiple Website Guys landing pages feeding the same inbound CRM, including:

- $99/month websites;
- custom websites;
- free audit;
- local services;
- restaurants;
- automotive;
- professional services;
- redesigns;
- ongoing management.

Record landing page, UTM parameters, ad campaign, requested service, form progress, submission, payment link, conversion, and recurring revenue.

## 21. Notifications

Support:

- in-app center;
- email;
- mentions;
- role-channel activity;
- task assignment;
- meeting requests;
- client submissions;
- payment/deployment/domain events;
- daily and weekly summaries.

Critical production, billing, domain, and security alerts cannot be completely hidden from responsible roles.

## 22. Audit, deletion, and recovery

Important actions create immutable audit events.

Normal lifecycle:

```text
Active → Archived → Trash → Administrator permanent deletion
```

Backups cover database, website schemas, client content metadata, deployment packages, DNS snapshots, and audit records.

Normal employees may restore authorized design versions. Full database, production, domain, or client-wide restoration is administrator-only.

## 23. Mobile behavior

Mobile supports lead lookup, activity logging, tasks, requests, messages, uploads, meetings, billing review, notifications, project progress, simple content edits, and analytics.

Advanced builder work, source control, and production deployment are desktop-focused.

## 24. Integration priority

1. Stripe
2. Google Maps and Places
3. Google Cloud Storage
4. GitHub and GitHub Pages
5. Namecheap and cPanel
6. Google Calendar
7. Email
8. Google Analytics and Search Console
9. Calendly, Discord notifications, and generic webhooks

AI is optional and never a core dependency.

## 25. Engineering quality requirements

- explicit reversible migrations;
- no `sync({ alter: true })` outside disposable tests;
- backend authorization tests;
- transactions for multi-record workflows;
- idempotent external webhooks and jobs;
- consistent validation;
- typed frontend API contracts;
- accessible and responsive UI;
- structured logging without secrets;
- no silent failures;
- feature flags for incomplete modules;
- compatibility adapters during migration;
- architecture decisions documented;
- every phase includes regression tests for previous phases.
