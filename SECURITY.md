# Security

## Reporting

This is a private, single-owner project. Report issues directly to the owner. Do not open public issues for vulnerabilities.

## Assets

| Asset | Sensitivity |
|---|---|
| Mail metadata (senders, subjects, thread IDs) from Mail-triage | Personal data |
| Security findings about repositories | Confidential until fixed |
| Feedback entries | Instructions that influence agent behavior |
| Google service account key | Grants read and update access to the agent folder |
| Database credentials, Auth.js secret, cron secret | Full compromise of the application |

## Threat model

| ID | Threat | Control |
|---|---|---|
| T1 | Someone other than the owner opens the app | Google sign-in with single-email allowlist enforced in the `signIn` callback; middleware plus per-handler authorization checks; no public routes except sign-in, health probe and the secret-protected cron endpoint |
| T2 | Malicious content in agent output (from emails, web pages, repositories) executes in the browser | Markdown rendered with raw HTML disabled and output sanitized; strict Content Security Policy without `unsafe-inline` scripts; external links `rel="noopener noreferrer nofollow"` |
| T3 | Malicious content in agent output is turned into instructions for agents | The app never copies agent-produced text into `feedback.json`. Feedback is authored by the owner only, from a closed set of types. Agents treat `note` as intent within their own rules (see agent contract 3.3) |
| T4 | Forged run files in the Drive folder | Folder shared only with the owner and the service account. Ingest validates schema and agent slug against configuration. Unknown agents are recorded as ingest errors, not ingested |
| T5 | Cron endpoint abused to trigger load | Bearer `CRON_SECRET` required; sync lock prevents concurrent runs |
| T6 | Leaked secrets | Secrets only in Vercel environment variables; secret scanning on the repository; service account key rotated yearly; no secrets in logs |
| T7 | Vulnerable dependencies | Dependabot or Renovate, `pnpm audit` in CI, lockfile committed |
| T8 | Data loss of owner-owned state | Weekly backup of feedback, actions and item states; runs and items can be rebuilt from Drive |
| T9 | CSRF on mutations | Server Actions and Auth.js built-in CSRF protection; `SameSite=Lax` session cookies |

## Security headers

Set in `next.config` for all routes: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with all unused features disabled, `X-Frame-Options: DENY`.

## Data minimization

Agents write only what is needed to recognize an item: sender address, subject line, IDs. No mail bodies, no attachments, no credentials. This rule is part of the agent contract.
