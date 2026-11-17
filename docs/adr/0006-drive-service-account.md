# ADR-0006: Drive access with a service account, updates only

- Status: Accepted
- Date: 2026-11-17

## Context

The application needs to list and read files in the owner's Drive folder and update `feedback.json`, from server code, without the owner being signed in.

Known constraint: service accounts have no Drive storage quota and cannot own files in a personal My Drive. Creating files there fails with `storageQuotaExceeded`. Reading files shared with the service account and updating the content of an existing file owned by the user does work.

## Options

1. **Service account** with the folder shared to it as Editor. The owner creates `feedback.json` once; the app only updates it.
2. **OAuth as the owner** with a stored refresh token. Can create files. Needs a restricted scope (`drive.readonly` plus write) for files the app did not create, which requires Google verification for production apps; an unverified app in testing mode gets refresh tokens that expire after 7 days.
3. Move the folder to a Shared Drive. Requires Google Workspace.

## Decision

Option 1. The service account key is stored as a Vercel environment variable. Scope: `https://www.googleapis.com/auth/drive`, effectively limited to the one folder shared with the account.

## Consequences

- No user token refresh to maintain.
- The app never creates files in Drive. If that is ever needed, revisit with option 2 or 3.
- The service account key is a long-lived secret: rotate yearly and on suspicion of leak. See operations runbook.
- Risk R2 in the architecture: Google may change these rules again. The update-only design keeps exposure small.
