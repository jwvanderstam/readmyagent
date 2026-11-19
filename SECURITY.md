# Security

## Reporting

Report vulnerabilities privately through GitHub: **Security** tab, **Report a vulnerability**. Do not open public issues for vulnerabilities.

Every deployment is a separate instance owned by one person (ADR-0007). The maintainers of this repository have no access to any instance or its data. A fix reaches an instance when its owner merges the release that contains it.

## Assets

Per instance:

| Asset | Sensitivity |
|---|---|
| Mail metadata (senders, subjects, thread IDs) from Mail-triage | Personal data |
| Security findings about repositories | Confidential until fixed |
| Feedback entries | Instructions that influence agent behavior |
| Drive access through the service account (ADR-0008) | Read and update access to the agent folder |
| Database credentials, Auth.js secret, cron secret, OAuth client secret | Full compromise of the application |

For the project:

| Asset | Sensitivity |
|---|---|
| The upstream repository and its releases | Code that every instance owner may deploy |

## Threat model

| ID | Threat | Control |
|---|---|---|
| T1 | Someone other than the owner opens the app | Google sign-in with single-email allowlist enforced in the `signIn` callback, which also requires a verified address. `proxy.ts` decrypts the session JWT and compares its email with `OWNER_EMAIL` on every request; pages and handlers check again. Public routes: `/signin`, `/setup` (only while unconfigured), `/api/health`, `/api/auth/*` and the secret-protected `/api/cron/*`. The app serves only the setup page without a valid `OWNER_EMAIL` |
| T2 | Malicious content in agent output (from emails, web pages, repositories) executes in the browser | Markdown rendered with raw HTML disabled and output sanitized; strict Content Security Policy without `unsafe-inline` scripts; external links `rel="noopener noreferrer nofollow"` |
| T3 | Malicious content in agent output is turned into instructions for agents | The app never copies agent-produced text into `feedback.json`, with one exception: the item fingerprint as `target`, which goes back only to the agent that produced it (feedback for an item of another agent is refused). Feedback is authored by the owner only, from a closed set of types, and validated against the contract before it is written. Agents treat `note` as intent within their own rules (see agent contract 3.3) |
| T4 | Forged run files in the Drive folder | Folder shared only with the owner and the service account. Ingest validates schema and agent slug against the configured agents. Unknown agents are recorded as ingest errors, not ingested |
| T5 | Cron endpoint abused to trigger load | Bearer `CRON_SECRET` required; sync lock prevents concurrent runs |
| T6 | Leaked secrets | No long-lived Google credential: Drive access through Workload Identity Federation (ADR-0008). Remaining secrets only in Vercel environment variables, marked Sensitive. Secret scanning with push protection and a secret scan in CI. Never in logs. See [secret handling](#secret-handling) |
| T7 | Vulnerable dependencies or code | Dependabot, `pnpm audit` in CI, lockfile committed; CodeQL code scanning on every pull request and weekly |
| T8 | Data loss of owner-owned state | Weekly backup of feedback, actions, item states and agents; runs and items can be rebuilt from Drive |
| T9 | CSRF on mutations | Server Actions and Auth.js built-in CSRF protection; `SameSite=Lax` session cookies |
| T10 | Preview deployments expose production data or credentials | Workload Identity Federation grants Drive access to the `production` environment only. Previews use their own database branch without production data and a test Drive folder. Vercel Deployment Protection stays on for previews |
| T11 | Compromised upstream code reaches every instance (supply chain) | Protected `main` with required pull request and CI; GitHub Actions pinned to a commit SHA; workflows with least privilege and no secrets on pull requests from forks; tagged releases with changelog; instance owners merge releases themselves instead of auto-deploying upstream `main` |

## Secret handling

Rules for code and configuration:

- Secrets exist only in the Vercel project of the instance owner. Never in the repository, fixtures, CI logs or application logs.
- No secret is ever read through a `NEXT_PUBLIC_` variable: those are inlined into the browser bundle.
- Modules that read secrets import `server-only`, so the build fails if they end up in client code.
- Environment variables are parsed with Zod at startup. Missing or malformed required values stop the app with an error that names the variable, never its value.
- The setup page shows per setting only whether it is configured. It is public while the instance is not configured, because no sign-in exists yet; it reveals setting names, which are documented anyway, and no values. Once configured, it redirects to the app.
- `.env*` files are ignored by git, except `.env.example` which holds names only.

## Security headers

Static headers are set in `next.config.ts` and the Content Security Policy in `proxy.ts`, with a fresh nonce per request, `strict-dynamic`, and no `unsafe-inline`. For all routes: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with all unused features disabled, `X-Frame-Options: DENY`.

## Data minimization

Agents write only what is needed to recognize an item: sender address, subject line, IDs. No mail bodies, no attachments, no credentials. This rule is part of the agent contract.
