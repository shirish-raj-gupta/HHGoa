# Working in this repo

For coding agents and new teammates. Read README.md first for the layout.

## Commands

- `pnpm install` (pnpm 12, hoisted node_modules; one React version, 19.3.0, for every app including Expo).
- `pnpm typecheck`, `pnpm test`. Engine tests run the whole loop on PGlite and an in-memory EVM; they take about a minute.
- `pnpm test:e2e`: Playwright in the installed Edge against its own stack (`e2e/test.env`, ports 3100-3103 and 8799,
  apps built into `.next/e2e`). A test fails on any console error or uncaught exception in the page. The tests mark
  the first-visit splash as seen; `test.use({ splash: true })` brings it back (`e2e/splash.spec.ts`).
- Next.js builds: `pnpm --filter @receipts/web build` (scripts already wrap `cross-env NODE_ENV=production`, needed
  because this machine's shell exports `NODE_ENV=development`).
- After stopping a dev server, check its port: stopped tasks can leave the node child running.
- `pnpm rehearse` before a demo (keys, wallet gas, the agent's USDC, TigerGraph, warmed answers; reads only).
- The development database (`.data/pglite`) takes one process at a time: the opener keeps its pid in
  `.data/pglite.lock`, and any other process stops after ten seconds (two writers once damaged it past opening). If it
  will not open, move the folder aside; the API migrates and seeds a new one on start. `PGLITE_DEBUG=1` shows why.

## Conventions

- Workspace packages export TypeScript source (`main: ./src/index.ts`); Turbopack, Metro and tsx compile them.
- The engine is the only place business rules live. The API maps HTTP to engine calls; apps only call the API
  through `@receipts/client`.
- Anything simulated (seeded history, the dev rail, mock humans, the attack, the test affiliate network) is labelled
  at the source and shown as such in every UI. Keep it that way.
- One account: a wallet signs in once (`/v1/auth`, no role) and the session serves reviewing and running a business;
  what a wallet may touch is checked by ownership in the engine (`ownAccount`), never by the kind of session. The
  business app is a Next.js zone of the web app (`basePath: '/business'`, proxied by `apps/web/next.config.ts` from
  `BUSINESS_ZONE_URL`, default :3001), so both share one origin: one device wallet, one Privy login, one token. Link
  into it with a plain URL (`MERCHANT_URL`), not `next/link`, since crossing zones is a full page load.
- Vercel (`vercel.json`, `docs/deploy-vercel.md`): one project and one domain; the API at `/v1`, `/mcp`, `/go`, `/health`
  (`apps/api/src/vercel.ts`), the business app at `/business`, the stage at `/stage` and the admin console at `/admin`
  (their `basePath`, also locally). Public URLs come from the deployment's domain; server code reaches the API through
  the `API_INTERNAL_URL` and `RECEIPTS_API_URL` bindings. Migrations are embedded (`pnpm --filter @receipts/db
  migrations:gen` after changing one) and jobs run from Vercel Cron at `/v1/cron/:minutes`. The database is Supabase's
  transaction pooler in Paris, and the functions run beside it (`regions: ["cdg1"]`); move both together.
- There is no route or function that lets a merchant delete, hide, edit or re-rank a review. Do not add one.
- Pay never depends on rating; rankings never read affiliate data. Both are tests in `packages/engine/test/loop.test.ts`.
- The paid-review disclosure is `PAID_REVIEW_DISCLOSURE` (`packages/core/src/answer.ts`), the spec's words exactly: on
  every receipt page, payout screen and buy link (`/go/:item` shows it before the store opens). Use the constant.
- Anchoring can wait; publishing cannot. If the relayer is out of gas or Base does not answer, a review publishes with
  its signed attestation kept (`reviews.anchor`, 7-day deadline) and the anchor-pending job submits it; claims and
  replies complete without their attestation. A revert still fails. RPCs fall back across public endpoints.
- Cities: the four in `packages/core/src/city.ts` are configured; any other city in India is made on first use from
  Google (Geocoding), so a business anywhere in India can list itself.
- `@anon-aadhaar/core` ships TypeScript sources as its types and fails strict checks: the engine imports it through a
  non-literal specifier and the web app through `apps/web/src/vendor/anon-aadhaar.(js|d.ts)`.
- Next.js 16 changed APIs; read `node_modules/next/dist/docs/` before relying on older patterns.
- Add or update dependencies through Socket Firewall: `pnpm safe add <pkg>`, `pnpm safe install` (blocks confirmed
  malware; run `pnpm store prune` first, since cached packages skip the check). CI installs the same way.
- Commits carry no AI co-author or "generated with" lines.

## Design

- The look lives in `packages/react`: tokens in `src/theme.css` (two themes: skin, a warm light palette, and dark navy;
  lime marks verification), the logo in `src/brand.tsx` (an SVG of `docs/brand/receipts-logo.png`), motion helpers in
  `src/motion.tsx`, effects in `src/effects.tsx` (rolling numbers, rotating words, highlight, spotlight and tilt cards,
  signature, the WebGL gradient backdrop, clay orbs, stacking cards), components in `src/ui.tsx`.
- The style is clay, colour blocks and glass:
  - Clay is the default surface: `shadow-card` and `shadow-lift` are clay, and clay buttons lift on hover and squish
    when pressed (`ease-squish`).
  - The six colour blocks (`bg-block-lime|tangerine|pink|sky|violet|sun`, or `Card tone`) are the same in both themes and
    always carry navy ink (`text-block-ink`, at least `/85` for body text). Use `bg-block-bubble` for icons and chips on them.
  - Glass (`.glass`) is for layers that float over colour: the header, the tab bar, the ask box. Text on glass that can
    pass over blocks is ink at 75% or more, never `text-muted`.
  - Orbs sit in the margins or behind opaque cards, never behind text.
  - The web pages are a sheet that lifts off a navy `curtain` footer.
- Themes: `ThemeToggle` switches skin/dark and remembers it per device; `themeScript()` in each root layout's `<head>`
  applies the choice before the first paint (`<html suppressHydrationWarning>`). Never hard-code a theme in a component.
  Components use token classes (`bg-surface`, `text-muted`, `bg-brand`), never raw hex.
- Lime is never text on the skin palette (1.35:1): use `text-good` for verified or accent text and `brand-strong` for
  marks on light surfaces; `text-brand` only on navy (`bg-brand-ink`).
  On `bg-accent` blocks use `accent-mark`, which flips between lime and navy with the theme.
- Animation: import from `motion/react` (never `framer-motion`); each app root has one `MotionProvider`
  (`reducedMotion="user"`). Animate a change of state, feedback, or a relationship to scroll (parallax orbs, stacking
  cards); 150-300ms for small elements. Continuous motion (orb drift, the gradient, marquees, the beam, voice bars) is
  decoration only and stops for reduced motion.
  Simple hover and press states stay CSS.
- Icons come from `lucide-react`; no emoji as icons. Touch targets are at least 44px.
- QR codes are never styled: `QRCodeSVG {...QR_PROPS}` inside `ScanFrame` (black on white, four-module margin, no
  clay, glass or tint), and they carry short links (`/go/proof/<id>`, `/scan?c=<id>`), never a whole signed payload.
  Keep a QR at 41 modules or fewer and 4px or more a module on screen.
- Read-aloud (`ListenButton`, Smallest AI through `/v1/speech/reviews|answers/:id`) speaks only what Receipts published,
  looked up by id, never text a caller sends; it shows only when `config.speech.on`. A simulated review says so first.
- Places come from Google Maps through the API (`packages/engine/src/google.ts`, key server-side only; map images
  through `/v1/maps/static`). Say "Places from Google Maps" wherever Google results are shown.
- The stage starts dark for projectors (`themeScript('dark')`); the other apps follow the system until toggled. Display
  type is Outfit; Instrument Serif italic is the accent for quotes and one emphasised word in a heading.
- The splash: a first visit to the reviewer home page opens on navy (`splashScript()` in the root layout, so the page
  never flashes first), plays the wordmark and asks "What brings you to Receipts?" (`apps/web/src/components/splash.tsx`,
  choice in localStorage `receipts.role`). The phone app plays the wordmark on every cold start and asks on the first
  (`apps/mobile/src/components/splash.tsx`, SecureStore). The web splash opens only on the home page and the phone asks
  only when it starts on its home tab, so a link to a receipt or a scan goes straight there.

## Where to look

| Task | Start in |
|---|---|
| A new brand or rail status | `packages/brands/src/brands.ts` |
| A new category | `packages/categories/configs/*.yaml`, then `pnpm categories:gen` |
| Proof verification | `packages/rails/src/*` and `packages/engine/src/proofs.ts` |
| Scoring and trust | `packages/core/src/scoring.ts`, `packages/engine/src/{trust,graph,investigator}.ts` |
| Paid tools | `packages/engine/src/mcp/server.ts`, `apps/api/src/routes/agent.ts` |
| Contracts | `packages/contracts/src/*.sol`, tests in `packages/contracts/test` |
| Admin console | `apps/admin` (:3003/admin), `packages/engine/src/admin.ts`, `apps/api/src/routes/admin.ts` |
| Places and cities | `packages/engine/src/{google,cities,places}.ts` |
