# ADR-0003: Single-owner authentication with Google sign-in

- Status: Accepted
- Date: 2026-11-17

## Context

The data includes mail metadata and security findings. Only the owner may access it. Platform-level protection (Vercel Deployment Protection) differs per plan and per deployment type and is outside our code and tests, so access control must live in the application. Platform protection may be added on top, never instead.

## Options

1. Auth.js with the Google provider and an allowlist of exactly one email address.
2. Passkeys or magic links with a self-managed user table.
3. HTTP basic auth via middleware with a shared secret.

## Decision

Option 1. Auth.js (v5) with Google sign-in. The allowed address is configured in `OWNER_EMAIL`. Any other account is rejected in the `signIn` callback, before a session is created. All routes except the sign-in page, the health probe and the cron endpoint require a session. Middleware enforces this; route handlers check again.

## Consequences

- No passwords to manage; Google provides MFA.
- The Google OAuth client for sign-in is separate from the Drive service account (ADR-0006), so sign-in scopes stay minimal (`openid email profile`).
- Adding a second user later means replacing the allowlist with a users table.
