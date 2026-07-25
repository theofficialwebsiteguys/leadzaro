# ADR 0003: Short-lived in-memory access token + HttpOnly refresh cookie

## Status

Accepted (Phase 1).

## Context

The pre-Phase-1 system signed a 7-day JWT on login and stored both the token and the serialized user in `localStorage`, read by every request via an Angular interceptor. Any XSS anywhere in the app has full, long-lived account takeover of every logged-in user, with no way to revoke a single session. The architecture requires revocable sessions and no long-lived privileged token in browser storage.

## Decision

- **Access token:** a short-lived (15 minutes default, `ACCESS_TOKEN_TTL`) JWT, returned in the response body and held only in an Angular signal (`AuthService`, in-memory, never persisted). It is what every API call's `Authorization: Bearer` header carries.
- **Refresh:** a long-lived (30 days default) opaque random token, delivered as an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api`. Its SHA-256 hash (never the raw value) backs a revocable `AuthSession` row (`server/core/authentication/sessionService.js`). `POST /api/v1/auth/refresh` exchanges a valid cookie for a fresh access token.
- **Bootstrap:** on app start, `provideAppInitializer` in `src/app/app.config.ts` calls `refresh()` once, silently restoring the session after a page reload without ever touching `localStorage`.
- **Revocation:** users can list/revoke their own sessions; an administrator can revoke another member's sessions within their shared organization (`sessions.manage_others` permission). Revoking sets `AuthSession.revokedAt`; `findActiveSessionByRawToken` checks it on every refresh.
- **CSRF is not separately mitigated with a token**, because the cookie alone cannot perform any mutating action — every state-changing endpoint requires the `Authorization` bearer header, which a cross-site request cannot attach. The cookie only unlocks the refresh endpoint, which itself performs no state change beyond issuing a new access token to whoever already holds the valid session cookie.
- **Impersonation** (ADR-adjacent, see the Phase 1 completion report) reuses the same JWT mechanism with an added `imp: { by, reason }` claim and a much shorter TTL (30 minutes), deliberately *not* backed by an `AuthSession` row — it is a temporary elevated view, not a persisted session, and "exit" is a client-side token swap plus an audited `/impersonation/end` call.

## Consequences

- A leaked access token is only useful for 15 minutes; a leaked refresh cookie can be revoked without asking the user to change their password.
- The frontend needed a one-time-retry-then-logout interceptor (`auth.interceptor.ts`) to handle a 401 from an expired access token transparently.
- `JWT_EXPIRES_IN` (legacy env var) is no longer the effective access-token lifetime; `ACCESS_TOKEN_TTL` is. Kept as a fallback default inside `signToken()` for any caller that doesn't pass an explicit override.
- No 2FA in Phase 1, matching the architecture's stated initial scope.
