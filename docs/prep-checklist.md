# Prep checklist

What to set up before the event, in order of how much of the demo depends on it. Each item names the `.env`
variables it fills; everything not done keeps its labelled fallback.

## 1. Base Sepolia (attestations, payouts, x402)

1. Make three wallets: deployer, relayer/operator, demo agent. Fund deployer and relayer with Base Sepolia ETH, and
   the agent with Base Sepolia USDC (Circle faucet).
2. `DEPLOYER_PRIVATE_KEY=0x... pnpm contracts:deploy` deploys the four contracts, registers the EAS schemas and
   writes `packages/contracts/deployments/index.json`. On a faucet-sized balance, `-- --skip-governance` deploys the
   core contracts only (about half the gas; about 0.00005 ETH in October 2026); `-- --governance-only` adds the
   testnet governance pair later without touching the rest.
3. Set `RELAYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`, `TREASURY_ADDRESS`, `AGENT_PRIVATE_KEY`. With a relayer key the
   API switches to `CHAIN=base-sepolia` and x402 on.
4. Fund the PayoutDistributor with test USDC before the first epoch (the operator posts roots daily).
5. Check: `pnpm agent` shows a payment line with a transaction hash.

## 2. Voice and models

- `SARVAM_API_KEY`: speech-to-text (saaras:v3, codemix). Test with Hindi, Konkani and Hinglish notes on two phones.
- `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`): structuring, cited answers, the investigator, and both demo agents.
  Gemini's free tier allows only 20 requests a day on 3.6 Flash, which one afternoon of testing used up; turn on billing in AI
  Studio before the event (Tier 1 starts instantly), or use `GEMINI_MODEL=gemini-3.5-flash-lite`, which has its own quota.
  Set up now (2026-10-30): the AI Grants India OpenAI key, as `LLM_PROVIDER=openai-compat` with `gpt-5-nano` at
  `https://api.openai.com/v1` (Gemini stays in `.env` as the alternative). AI Grants blocks a key that appears in any
  GitHub commit: keep it in `.env` only.
- `SMALLEST_API_KEY` (AI Grants India voice credits): read-aloud of published reviews and answers with Smallest AI's
  Lightning voices (Indian English and Hindi, plus Tamil, Telugu, Kannada, Malayalam, Marathi, Punjabi, Bengali, Odia and
  Gujarati). Only published text is spoken, by id, and each clip is cached, so the credits go on new reviews only.

## 3. One human

- Self: deploy the API on public HTTPS and set `SELF_ENDPOINT` to `https://<api>/v1/self/verify`. Keep
  `SELF_MOCK_PASSPORT=true` for staging. Self now labels this open-source SDK legacy; confirm it still verifies
  before relying on it on stage.
- Anon Aadhaar: works in the browser. `ANON_AADHAAR_TEST_MODE=true` accepts test QR codes; turn it off for real
  ones (the QR must be under an hour old).

## 4. Proof rails

- Reclaim: create the app (`RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`) and rename it "Receipts" in the Reclaim dashboard
  (phones see its name). Ten brands have community providers built in (packages/brands/src/reclaim.ts); test each on
  two phones before calling it live. Zomato and UPI payments need providers built in the devtool, then
  `RECLAIM_PROVIDER_<BRAND>`. Which ones and how: [providers.md](providers.md).
- Google Maps: `GOOGLE_MAPS_API_KEY` with Places API (New) and Maps Static API enabled. In Google Cloud, restrict the key
  to those two APIs and to the API server's IP, and set a budget alert (it was pasted in a chat).
- ZK Email (optional): register blueprints and set `ZKEMAIL_BLUEPRINT_<BRAND>`; the `.eml` upload works without them.
- Merchant QR receipts need no setup: claim a demo listing in the merchant app and sign one.

## 5. Money and billing

Dodo handles API credit purchases and business Pro subscriptions. Its [payouts](https://docs.dodopayments.com/features/payouts/payout-structure)
settle the business's sales to its bank account; they cannot replace reviewer UPI withdrawals or prove the UPI ID
of a business claiming a listing. Leave the optional Razorpay settings unset to run Dodo billing with USDC claims
and domain/manual business verification.

1. Put a test-mode key in `DODO_API_KEY` and set `DODO_ENV=test_mode` in `.env` (both files are gitignored).
2. Run `pnpm dodo:setup`. It creates or reuses a $1 USD one-time credit product and a monthly business Pro product,
   defaulting to $10/month for tests. It saves their IDs as `DODO_PRODUCT_CREDITS` and `DODO_PRODUCT_MERCHANT_PRO` in
   `.env` and the existing `.env.vercel`. To choose another test price, use minor units, for example
   `pnpm dodo:setup --merchant-price=49900 --merchant-currency=INR`. Existing product prices are never silently changed.
3. Once the public API URL is known, run
   `pnpm dodo:setup --webhook-url=https://<domain>/v1/dodo/webhook`. The command creates or reuses that exact endpoint,
   subscribes to the supported payment/subscription events, and saves `DODO_WEBHOOK_SECRET` without displaying it.
   To select an existing endpoint explicitly, also pass `--webhook-id=ep_...`; it requires `--webhook-url` and checks
   that the endpoint URL matches. Existing event subscriptions are preserved.
   Use a public HTTPS development tunnel for localhost; never register localhost itself.
4. Restart the local API. For Vercel, import the updated `.env.vercel` (or `.env.dodo.vercel` for just the five Dodo
   settings prepared on this machine) and redeploy. Products and webhook secrets are
   separate between test and live mode; this bootstrap refuses live mode. Configure live pricing and keys separately.
5. Complete a sandbox checkout from `/developers` or a claimed business's plan page. Confirm a successful webhook
   delivery in Dodo and the resulting credit balance/Pro plan in Receipts. Checkout remains unavailable until its
   webhook secret is configured. The return URL alone grants nothing. Replay the same event to confirm no duplicate credit.

Configured on 31 October 2026: the test products use $1 USD per API-credit unit and $10 USD/month for Pro. Both
hosted checkout sessions were created successfully. Endpoint `ep_3LPT02Zdd4BbEtAlbRRbKEp30kk` points to
`https://hackerhousegoa-receipts.vercel.app/v1/dodo/webhook`, with its signing secret saved in the ignored `.env`
and `.env.vercel`. The hosted deployment still needs the Dodo settings imported and redeployed; payment completion
and credit/plan fulfillment remain to be checked using step 5.

The handler uses [Dodo's Standard Webhooks verification](https://docs.dodopayments.com/developer-resources/webhooks).
Subscribe to `payment.succeeded`, `subscription.active`, `subscription.renewed`, `subscription.updated`,
`subscription.cancelled`, `subscription.expired`, `subscription.on_hold`, `subscription.failed`, `subscription.paused`,
`subscription.unpaused` and `subscription.past_due`. Credits are based on units of the configured credit product,
so taxes and adaptive checkout currency do not increase the credit balance. Billing never changes rankings.

Optional payout and verification integrations:

- RazorpayX test mode: `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAY_WEBHOOK_SECRET`
  (webhook to `https://<api>/v1/razorpay/webhook`). There is no shared test account number: sign in at x.razorpay.com
  with the same Razorpay account, switch to test mode, add test balance, and copy the account number it shows. Until
  then the payouts API answers "Access to requested resource not available", and reviewers' "Withdraw to UPI" says rupee
  payouts are off. Razorpay sends nothing under ₹1 (100 paise), for payouts and payment links alike.
- The ₹1 business check works in test mode too: test payment links take any method (this account's test checkout
  offers no UPI), so pay with the Razorpay test card 4100 2800 0000 1007, any future expiry and CVV, and any 4 to 10
  digit OTP. "Check now" asks Razorpay whether the link was paid, so it works on localhost without the webhook. A
  listing whose UPI ID is known still needs the payment from that UPI ID; otherwise approve it in the admin console.
- Admin console (`apps/admin`, localhost:3003/admin): `ADMIN_TOKEN` in `.env` is the password it asks for.
- Affiliate networks: apply early (approval takes days). Until approved, `DEMO_MODE` uses the labelled test network.

## 6. Sponsor tools

| Tool | What it does here | What to get |
|---|---|---|
| TigerGraph | Ring and funding-graph checks, the investigator's graph tools | A TigerGraph Savanna workspace and an organization API key (`TIGERGRAPH_API_KEY`). `pnpm graph:setup` creates a database user, loads `packages/engine/graph/schema.gsql` and `queries.gsql`, and writes `TIGERGRAPH_HOST` and `TIGERGRAPH_SECRET` to `.env`. Savanna creates that user without schema rights: run `GRANT ROLE globaldesigner TO receipts_api` once in the workspace's GSQL editor, then run the setup again. Savanna pauses the workspace after an idle hour, and with its auto start off it stays paused (the API then logs once that it is, and local checks carry on): run `pnpm graph:wake` before the demo, or turn on auto start in the workspace settings (the API's sync every five minutes then keeps it awake while the API runs) |
| Dodo Payments | Card billing: API credits and the merchant plan | Test-mode `DODO_API_KEY`, then `pnpm dodo:setup --webhook-url=https://<domain>/v1/dodo/webhook` for the products and signing secret |
| Socket | Supply-chain security for our ~1,900 npm packages (crypto deps are a frequent malware target) | Firewall: no key. Run installs as `pnpm safe install` / `pnpm safe add <pkg>`; CI does the same. Scans and PR alerts: a free account at socket.dev, then install the Socket GitHub app on the repo (reads `socket.yml`) and, for `pnpm security:scan`, set `SOCKET_CLI_API_TOKEN` (and `SOCKET_CLI_ORG_SLUG`) in `.env`, which the script loads, or as a CI secret |
| AI Grants India | Free model access for structuring, answers and both demo agents | Apply at aigrants.in; put the base URL, key and model they issue in `OPENAI_COMPAT_*` |
| Cake Wallet | Where reviewers can keep their USDC | No key. Earnings → "send to another wallet" takes its Base address (mainnet only; it does not show Base Sepolia) |
| Wispr Flow | Voice dictation into the typed-review box | No key needed for that. Its developer API is invite-only (enterprise@wisprflow.ai); with access it could become a second speech-to-text provider |
| Edge City | The residency and community around the event | Nothing to integrate |

## 7. Nice to have

- `PINATA_JWT` (IPFS pinning), `PRIVY_APP_ID` (email wallets on web), push (`EXPO_ACCESS_TOKEN`, VAPID keys,
  WhatsApp, Resend).
- The phone's native launch screen (shown before JavaScript loads, then the in-app splash takes over): run
  `pnpm safe add expo-splash-screen --filter @receipts/mobile` and add the plugin to `apps/mobile/app.json` with
  `"image": "./assets/splash-wordmark.png"`, `"imageWidth": 220`, `"backgroundColor": "#02142d"`. Until then the
  phone shows its default launch screen for a moment.

## 8. Stage

- Deploy and set `ADMIN_TOKEN` and `DEMO_TOKEN`. Reset the attack after each rehearsal (stage → The attack → Reset).
- Re-check before the event that no real restaurant in Goa is called "Saffron Comet Biryani" (the planted name).
