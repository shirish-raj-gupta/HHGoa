# Deploying

The deployment in use is one Vercel project for every app and the API, on Supabase: see
[deploy-vercel.md](deploy-vercel.md). This page is the alternative, with the API and worker on a long-running Node host.

| Piece | Where | Notes |
|---|---|---|
| Postgres (PostGIS + pgvector) | A managed Postgres with both extensions (Supabase and Neon offer both), or the `infra/postgres` image | `pnpm db:migrate && pnpm db:seed` once |
| API | A long-running Node host (Railway, Fly, Render) | `pnpm --filter @receipts/api start`; must be public HTTPS for Self, Reclaim callbacks, Razorpay and Dodo webhooks |
| Worker | Same host, second process | `pnpm --filter @receipts/worker start`; set `RUN_WORKER_IN_PROCESS=false` on the API |
| web, merchant, demo | Vercel (one project per app, root directory `apps/<name>`) | Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`; the demo app also needs the agent and admin variables server-side |
| Mobile | Expo Go for the event; EAS Build for store builds | Set `EXPO_PUBLIC_API_URL`; change the bundle identifiers in `apps/mobile/app.json` first |

Production checklist:

- `NODE_ENV=production`, `SESSION_SECRET` (32+ random characters; the API refuses to start without it),
  `DATA_ENCRYPTION_KEY`, `ADMIN_TOKEN`.
- `DEMO_MODE`, `ALLOW_SIMULATED_PROOFS` and `ALLOW_MOCK_IDENTITY` default off in production; leave them off.
- Point the webhooks: Reclaim callback is built per request; Razorpay `/v1/razorpay/webhook`; Dodo
  `/v1/dodo/webhook`; affiliate postbacks `/v1/affiliate/postback/<network>`; Self `/v1/self/verify`.
- `CORS_ORIGINS` for any web origin other than the configured app URLs.
