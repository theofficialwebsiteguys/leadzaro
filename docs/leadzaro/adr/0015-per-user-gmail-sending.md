# ADR 0015 — Sales email from each person's own Gmail

Status: Accepted (2026-10-14)

## Context

Sales email went out through one shared Gmail SMTP account, configured with
`SMTP_*` and `SALES_EMAIL_FROM`. We want each employee's email to come from
their own business address, for example Matt's from Matt's mailbox and
Jared's from Jared's. Logging in to Leadzaro doesn't give permission to send
as someone, so each person has to grant it.

## Decision

1. **One OAuth client, one connection per person.** Leadzaro has a single
   Google OAuth web client (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, Internal
   audience). Each employee connects their own mailbox under Settings → My
   account → Email sending. Connections are stored in `UserMailboxConnections`
   with:
   - the user and agency;
   - the verified address, taken from Google's signed ID token;
   - the granted scopes;
   - a status;
   - the refresh token, encrypted with `secretBox` and bound to the
     `<userId>:<agencyId>:gmail` context.

   The token is never returned to the browser.
2. **Narrow scope, Gmail API delivery.** We request only `gmail.send`, plus
   `openid email` to learn which address was connected, so Leadzaro can send
   but not read mail. `gmail.send` doesn't work with Gmail SMTP, so messages
   are composed with Nodemailer's MailComposer and sent through the Gmail
   API (`users.messages.send`). They then appear in the person's Sent
   folder, and replies go to them.
3. **Connect flow.** `POST /api/v1/integrations/gmail/connect` returns
   Google's consent URL, requested with `access_type=offline` and
   `prompt=consent`. The `state` parameter is a 10-minute signed token naming
   the user and agency, carrying a random nonce. The same nonce is set as an
   httpOnly, SameSite=Lax cookie scoped to the callback path. The callback
   (`GET /api/v1/integrations/gmail/callback`) requires the state and cookie
   to match. This stops a consent link made by someone else from attaching a
   mailbox to their account. The callback also requires that the send
   scope was granted and that a refresh token was returned. These routes
   are mounted before the admin-only integrations router because
   connecting your own mailbox is a personal setting (`profile.manage`).
4. **The sender is always the signed-in person.** When the OAuth client is
   configured:
   - `outreachService.send` checks the person's own connection before it
     records anything.
   - If they aren't connected, sending is refused (503,
     `email_not_connected`) and the composer links to Settings.
   - There is no fallback to a shared account.
   - A revoked or expired grant marks the connection `error` ("Reconnect
     Gmail").
   - Activities record `provider: gmail` and the actual From address.
   - Disconnecting revokes the token with Google and deletes our copy.
5. **SMTP stays for notifications** (password resets, invitations, alerts).
   It is also the sales-email fallback, but only when no OAuth client is
   configured, for example in tests and other environments. If
   `SALES_EMAIL_TEST_REDIRECT` is set, Gmail sends also go to that test
   address.

## Consequences

- Each employee must connect once. Anyone not connected can still use
  "Open in my email app" and log what they sent.
- If the Workspace admin restricts third-party apps, Leadzaro's client ID
  must be allowed in Google Admin → Security → API controls.
- Scheduled or queued sends don't exist yet. If they're added, each queued
  message must store its sender's user id so it goes out from the right
  mailbox.
