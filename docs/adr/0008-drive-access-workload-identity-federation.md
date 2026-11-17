# ADR-0008: Drive access through Workload Identity Federation, no service account key

- Status: Accepted
- Date: 2026-11-17
- Supersedes: [ADR-0006](0006-drive-service-account.md)

## Context

ADR-0006 chose a Google service account for Drive access, authenticated with a JSON key stored in a Vercel environment variable. With one instance per user (ADR-0007), every user would create, store and rotate such a key. A long-lived key is the most damaging secret in the system: it grants access to the agent folder until someone revokes it.

Facts checked on 2026-11-17 in the Vercel docs "OpenID Connect (OIDC) Federation" (updated 2026-08-04) and "Connect to Google Cloud Platform (GCP)" (updated 2026-09-01):

- OIDC federation is available on all Vercel plans, including Hobby.
- Vercel Functions receive a signed OIDC token with a time to live of two hours.
- The token subject has the form `owner:<team>:project:<project>:environment:<environment>`, so Google Cloud can grant access per project and per environment.
- The issuer is `https://oidc.vercel.com/<team>` in team mode, which Vercel recommends.
- Google Cloud Workload Identity Federation exchanges that token for a short-lived access token that impersonates a service account. Code uses `@vercel/oidc` and `ExternalAccountClient` from `google-auth-library`.
- For local development, `vercel env pull` writes a `VERCEL_OIDC_TOKEN` for the development environment.

The Drive constraints from ADR-0006 still hold: the service account has no storage quota, so the app only reads files and updates the owner-created `feedback.json`.

## Options

1. **Service account with a JSON key** (ADR-0006). Simple, works anywhere. Long-lived secret per user.
2. **Service account impersonated through Workload Identity Federation**, with Vercel as OIDC provider. No stored Google secret. More one-time setup in Google Cloud. Works only where a Vercel OIDC token is available.
3. OAuth as the owner with a stored refresh token. Rejected in ADR-0006 and ADR-0007 (restricted scope, 7-day token expiry in testing mode).

## Decision

Option 2 is the default. The service account keeps the role it had in ADR-0006 (Drive folder shared with it as Editor, update-only), but has no keys.

- Only the principal for the instance's own Vercel project in the `production` environment may impersonate it (`roles/iam.workloadIdentityUser` on the service account).
- The identity provider uses the team issuer and an attribute condition that accepts only tokens from that Vercel team and project.

Option 1 remains a documented fallback for environments without Vercel OIDC, such as local development against a test folder. The Drive client accepts either configuration and prefers federation when both are present.

## Consequences

- No long-lived Google credential exists in Vercel, in the repository or on a laptop, so there is no key to leak or rotate.
- Preview deployments cannot reach the production Drive folder: their tokens carry `environment:preview` and are not granted. Previews use a separate test folder and service account, or no Drive access.
- Setup in Google Cloud has more steps: enable the IAM Service Account Credentials and Security Token Service APIs, create a workload identity pool and provider, and bind the principal. The setup script (ADR-0007) automates this.
- New dependencies: `@vercel/oidc` and `google-auth-library`.
- Local development against Drive needs `vercel link` and `vercel env pull`, or the fallback key for a test folder only.
- Risk R2 in the architecture (Google changes Drive quota rules) is unchanged.
