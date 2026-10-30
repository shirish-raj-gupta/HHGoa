# Deploying to Vercel

One Vercel project serves everything from one domain (`vercel.json`, [Vercel services](https://vercel.com/docs/services)):

| Path | Service | App |
|---|---|---|
| `/` | `web` | the reviewer site |
| `/business` | `merchant` | Receipts for business (same origin as the reviewer site, so one account and one sign-in) |
| `/stage` | `demo` | the stage |
| `/admin` | `admin` | the admin console |
| `/v1/*`, `/mcp`, `/go/*`, `/health` | `api` | the API (`apps/api/src/vercel.ts`) |

Two bindings let server code reach the API inside the project: `web` gets `API_INTERNAL_URL` (its server pages) and
`demo` gets `RECEIPTS_API_URL` (the stage's agents). Vercel sets both; do not add them yourself. The business app and
the admin console call the API only from the browser, at the public paths above.

Every public address (QR codes, receipt links, payment callbacks) comes from the deployment's own domain, so nothing
needs editing when the domain changes. Set the `PUBLIC_*_URL` variables only to override that.

## 1. A database

The API needs Postgres with PostGIS and pgvector; the local PGlite folder does not exist on Vercel. Supabase or Neon both
work (the first migration enables both extensions). Every function instance opens its own connections, so use the
**pooled** connection string. The API migrates and seeds on its first request, so a new database needs nothing else.

- **Supabase**: Connect → **Transaction pooler** (port 6543). The direct connection is IPv6 only, which Vercel's
  functions cannot reach, and the session pooler holds a connection per client. Put your database password in place of
  `[YOUR-PASSWORD]` (percent-encode `@`, `:`, `/`, `#` and `?` in it) and end the URL with `?sslmode=no-verify`:
  node-postgres treats `sslmode=require` as full verification, and Supabase signs with its own CA, so `require` fails
  with "self-signed certificate in certificate chain". `no-verify` still encrypts. To verify as well, download the CA
  from Database settings → SSL and set it as `DATABASE_CA_CERT` (the PEM, newlines written as `\n`); `sslmode` is then
  ignored. Receipts uses no named prepared statements, LISTEN or advisory locks, so the transaction pooler suits it.
- **Neon**: the `-pooler` host with `?sslmode=require` (its certificates verify as they are).

Run the functions in the database's region: `vercel.json` sets `"regions": ["cdg1"]` (Paris) for the Supabase project in
`eu-west-3`. A first start sends about 1,300 statements (migrations and the labelled demo history) and every later cold
start about 135, so at Vercel's default Washington region, about 85 ms from Paris, the first start would take about two
minutes and each cold start about 12 seconds. A database elsewhere takes its nearest region (Mumbai `bom1`, Frankfurt
`fra1`); the Hobby plan allows one.

## 2. The project

Import the GitHub repository into Vercel, root directory `/` (the repository root, where `vercel.json` is). Vercel builds
the five services from it.

## 3. Environment variables

The quickest way: `.env.vercel` at the repository root holds all of it, written from your `.env` with new production
secrets (it is gitignored and never uploaded with the code). Fill in `DATABASE_URL`, then in the project's Settings →
Environment Variables use **Import .env** (or paste its contents) for Production, and Preview if you use previews. Upload
that file, never `.env` itself: `.env` carries localhost addresses and the deployer key.

By hand, add these:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooled Postgres URL from step 1 |
| `SESSION_SECRET` | a new random string of 32 or more characters (signs sessions; required in production) |
| `DATA_ENCRYPTION_KEY` | a new random 32-byte key (hex or base64); keep it once set, it encrypts stored proofs and audio |
| `CRON_SECRET` | a random string; Vercel signs its cron calls with it |
| `DEMO_TOKEN` | a random string; the stage asks for it once before it runs the agents, the attack or Settle now |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel installs with the pnpm 12 the repo pins (`packageManager`) |

Then copy these from your local `.env`: `ADMIN_TOKEN`, `CHAIN`, `BASE_SEPOLIA_RPC_URL`, `RELAYER_PRIVATE_KEY`,
`OPERATOR_PRIVATE_KEY`, `TREASURY_ADDRESS`, `AGENT_PRIVATE_KEY`, `AGENT_NETWORK`, `AGENT_LLM`, `LLM_PROVIDER`,
`OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`SARVAM_API_KEY`, `SMALLEST_API_KEY`, `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`, `GOOGLE_MAPS_API_KEY`, `PINATA_JWT`,
`PRIVY_APP_ID`, `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `TIGERGRAPH_API_KEY`, `TIGERGRAPH_HOST`, `TIGERGRAPH_SECRET`.

Leave these out: `PORT`, the `PUBLIC_*_URL` lines (they point at localhost), `RECEIPTS_API_URL` (the binding sets it),
`DEPLOYER_PRIVATE_KEY` (only the contract scripts need it), and `SOCKET_CLI_*` (local tooling).

Production turns the demo aids off. For a demo deployment, also set `DEMO_MODE=true` (the seeded, labelled history, the
stage's attack and Settle now), `ALLOW_SIMULATED_PROOFS=true` (the dev rail), `ALLOW_MOCK_IDENTITY=true` (mock humans),
`SELF_MOCK_PASSPORT=true` and `ANON_AADHAAR_TEST_MODE=true` (test documents). All of it stays labelled as simulated in
every screen.

## 4. After the first deploy

- Privy: add the domain to the app's allowed origins (one origin now covers the reviewer site and the business app).
- Razorpay: webhook to `https://<domain>/v1/razorpay/webhook`. Dodo: `https://<domain>/v1/dodo/webhook`.
- Google Maps: the key is used only by the API; restrict it to the Places, Geocoding and Maps Static APIs.
- Open `https://<domain>/health` first and wait for it: the first request migrates and seeds the empty database (a few
  seconds in the database's region). Then open `/`, `/business`, `/stage` and `/admin`.
- `REHEARSE_API_URL=https://<domain> pnpm rehearse` checks the deployment's keys, the wallets' gas and the agent's USDC,
  wakes nothing but reports TigerGraph, and warms the stage's three answers.
- Print `https://<domain>/poster` for the seeding drive: its QR opens the review flow on this domain.

## Background jobs

A function has no timer, so Vercel Cron calls `/v1/cron/<minutes>` and every job due in that window runs. `vercel.json`
calls it once a day (05:00 in India), which every plan allows. On Pro, run it every five minutes for live follow-ups,
anchoring and trust scores: `{ "path": "/v1/cron/5", "schedule": "*/5 * * * *" }`. The admin console's buttons also run
trust, the epoch and anchoring on demand.

## Limits worth knowing

- The stage's live ticker is a long-lived stream; on Vercel it reconnects when a function reaches its time limit.
- Read-aloud clips, answer caches and rate limits live in each function instance's memory.
- Anon Aadhaar verification loads its proving artifacts on an instance's first check, so that check is slow.
