# ADR-0002: Next.js on Vercel Hobby with Neon Postgres

- Status: Accepted
- Date: 2026-11-17

## Context

The owner wants a web application reachable from any device, free hosting, and room to extend it. It is single-user and non-commercial. The owner explicitly chose Vercel.

Facts checked on 2026-11-17:
- Vercel Hobby is free for personal, non-commercial use. Cron jobs on Hobby run at most once per day and may fire anywhere within the scheduled hour.
- Neon Free: 1 GB storage and 100 CU-hours of compute per project per month; compute scales to zero when idle. Source: neon.com FAQ "free plan limits and quotas", updated 2026-10-01.

## Options

1. Next.js on Vercel with Neon Postgres via the Vercel Marketplace.
2. Next.js on Vercel with a hosted SQLite (Turso). Cheaper at scale, less standard tooling.
3. Self-host on the home lab. Full control; requires exposing a home service to the internet and patching it.

## Decision

Option 1. Next.js App Router, TypeScript strict, Drizzle ORM, Neon Postgres provisioned through the Vercel Marketplace so connection variables are injected automatically.

## Consequences

- Zero recurring cost within the free limits; estimated volume is far below them.
- Standard Postgres and Drizzle migrations keep the data portable.
- Once-per-day cron means sync must also run on page open and on demand.
- Cold starts on Neon add latency to the first request after idle.
- Moving to Vercel Pro would be required for commercial use or frequent crons.
