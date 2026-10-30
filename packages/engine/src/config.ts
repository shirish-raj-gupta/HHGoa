import { z } from 'zod';

// Every setting the backend reads, in one place. Anything unset degrades to a labelled local mode instead of
// crashing, so `pnpm dev` works with an empty .env; each integration switches on when its keys appear.

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const opt = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

export function parseEnv(source: Record<string, string | undefined> = process.env) {
  const production = source.NODE_ENV === 'production';
  // On Vercel every app shares the deployment's origin (vercel.json): the API at /v1, /mcp, /go and /health, the
  // reviewer site at /, the business app at /business, the stage at /stage and the admin console at /admin.
  const host = source.VERCEL_ENV === 'production' && source.VERCEL_PROJECT_PRODUCTION_URL ? source.VERCEL_PROJECT_PRODUCTION_URL : source.VERCEL_URL;
  const vercel = source.VERCEL && host ? `https://${host}` : null;
  const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(8787),

    PUBLIC_API_URL: z.string().default(vercel ?? 'http://localhost:8787'),
    PUBLIC_WEB_URL: z.string().default(vercel ?? 'http://localhost:3000'),
    PUBLIC_MERCHANT_URL: z.string().default(`${vercel ?? 'http://localhost:3000'}/business`),
    PUBLIC_DEMO_URL: z.string().default(`${vercel ?? 'http://localhost:3002'}/stage`),
    PUBLIC_ADMIN_URL: z.string().default(`${vercel ?? 'http://localhost:3003'}/admin`),
    CORS_ORIGINS: opt,

    DATABASE_URL: opt,
    /** Signs session tokens. Required in production; development uses a fixed, public value. */
    SESSION_SECRET: opt,
    /** 32 bytes (hex or base64) for AES-GCM over proof blobs and audio. Derived from SESSION_SECRET when unset. */
    DATA_ENCRYPTION_KEY: opt,
    ADMIN_TOKEN: opt,
    /** Vercel Cron signs its calls to /v1/cron/:minutes with this (Authorization: Bearer). */
    CRON_SECRET: opt,

    /** Show labelled simulated history and allow demo controls. */
    DEMO_MODE: bool(!production),
    /** Accept the dev rail (simulated purchases). Never in production. */
    ALLOW_SIMULATED_PROOFS: bool(!production),
    /** Accept mock personhood (no ID check) for rehearsals. */
    ALLOW_MOCK_IDENTITY: bool(!production),
    /** Cache answers to repeated stage questions (the payment still runs live). */
    DEMO_CACHE_ANSWERS: bool(false),
    RUN_WORKER_IN_PROCESS: bool(!production),

    // Chain
    CHAIN: z.enum(['base-sepolia', 'base', 'local', 'off']).optional(),
    BASE_SEPOLIA_RPC_URL: opt,
    BASE_RPC_URL: opt,
    RELAYER_PRIVATE_KEY: opt,
    OPERATOR_PRIVATE_KEY: opt,
    TREASURY_ADDRESS: opt,

    // x402
    X402_MODE: z.enum(['on', 'off']).optional(),
    X402_FACILITATOR_URL: z.string().default('https://x402.org/facilitator'),
    X402_NETWORK: z.string().optional(),
    X402_PAY_TO: opt,
    AGENT_DAILY_CAP_USDC: z.string().default('1.00'),

    // Identity
    SELF_SCOPE: z.string().default('receipts-v1'),
    SELF_ENDPOINT: opt,
    SELF_MOCK_PASSPORT: bool(!production),
    ANON_AADHAAR_NULLIFIER_SEED: z.string().default('4534'),
    ANON_AADHAAR_TEST_MODE: bool(!production),

    // Proof providers
    RECLAIM_APP_ID: opt,
    RECLAIM_APP_SECRET: opt,
    RECLAIM_PROVIDER_UPI: opt,
    RECLAIM_PROVIDER_SWIGGY_PARTNER: opt,

    // Places: Google Maps Platform (Places API, Static Maps). Server-side only.
    GOOGLE_MAPS_API_KEY: opt,

    // Voice and LLM
    SARVAM_API_KEY: opt,
    // read-aloud of published reviews and answers (Smallest AI Lightning text to speech)
    SMALLEST_API_KEY: opt,
    /** saaras:v3 (the plan's pick, with codemix mode) or saaras:v4 (newer default; supports keyterms). */
    SARVAM_MODEL: z.string().default('saaras:v3'),
    SARVAM_MODE: z.string().default('codemix'),
    LLM_PROVIDER: z.enum(['anthropic', 'gemini', 'openai-compat', 'offline']).optional(),
    ANTHROPIC_API_KEY: opt,
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    GEMINI_API_KEY: opt,
    GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
    /** Any OpenAI-compatible chat completions endpoint (AI Grants India keys, OpenRouter, Groq, a local server). */
    OPENAI_COMPAT_BASE_URL: opt,
    OPENAI_COMPAT_API_KEY: opt,
    OPENAI_COMPAT_MODEL: opt,

    // Storage
    PINATA_JWT: opt,
    PINATA_GATEWAY: opt,

    // Trust
    TIGERGRAPH_HOST: opt,
    TIGERGRAPH_GRAPH: z.string().default('Receipts'),
    TIGERGRAPH_SECRET: opt,
    TIGERGRAPH_TOKEN: opt,
    /** Command that starts the TigerGraph MCP server (pyTigerGraph-mcp) for the investigator agent. */
    TIGERGRAPH_MCP_COMMAND: opt,

    // Shop-through
    AFFILIATE_SECRET_CUELINKS: opt,
    AFFILIATE_SECRET_ADMITAD: opt,
    AFFILIATE_SECRET_INRDEALS: opt,
    AFFILIATE_SECRET_DIRECT: opt,
    AFFILIATE_SECRET_TEST: z.string().default('test-network-secret'),
    AFFILIATE_TEMPLATE_CUELINKS: z.string().default('https://linksredirect.com/?pub_id={pub}&subid={click}&source=linkkit&url={url}'),
    AFFILIATE_TEMPLATE_ADMITAD: z.string().default('{deeplink}&subid={click}'),
    AFFILIATE_TEMPLATE_INRDEALS: z.string().default('https://inr.deals/track?id={pub}&src=api&subid={click}&url={url}'),
    AFFILIATE_PUBLISHER_ID: opt,

    // Optional legacy UPI disbursements and ownership checks; Dodo checkout does not replace these rails.
    RAZORPAYX_KEY_ID: opt,
    RAZORPAYX_KEY_SECRET: opt,
    RAZORPAYX_ACCOUNT_NUMBER: opt,
    RAZORPAY_WEBHOOK_SECRET: opt,
    RAZORPAY_CLAIM_VPA: opt,
    FX_INR_PER_USD: z.coerce.number().default(88),

    // Dodo billing for API credits and business subscriptions (server-side credentials only).
    DODO_API_KEY: opt,
    DODO_WEBHOOK_SECRET: opt,
    DODO_ENV: z.enum(['test_mode', 'live_mode']).default('test_mode'),
    DODO_PRODUCT_CREDITS: opt,
    DODO_PRODUCT_MERCHANT_PRO: opt,

    // Notifications
    EXPO_ACCESS_TOKEN: opt,
    VAPID_PUBLIC_KEY: opt,
    VAPID_PRIVATE_KEY: opt,
    WHATSAPP_TOKEN: opt,
    WHATSAPP_PHONE_ID: opt,
    WHATSAPP_TEMPLATE: z.string().default('receipts_followup'),
    RESEND_API_KEY: opt,
    EMAIL_FROM: z.string().default('Receipts <checkins@receipts.local>'),

    // GST lookups for merchant claims
    GST_API_URL: opt,
    GST_API_KEY: opt,
  });
  const env = schema.parse(source);
  if (production && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production (it signs every session).');
  }
  const chain = env.CHAIN ?? (env.RELAYER_PRIVATE_KEY ? 'base-sepolia' : 'local');
  const llm =
    env.LLM_PROVIDER ??
    (env.ANTHROPIC_API_KEY
      ? 'anthropic'
      : env.GEMINI_API_KEY
        ? 'gemini'
        : env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_MODEL
          ? 'openai-compat'
          : 'offline');
  return {
    ...env,
    CHAIN: chain,
    LLM_PROVIDER: llm,
    X402_MODE: env.X402_MODE ?? (chain === 'base-sepolia' || chain === 'base' ? 'on' : 'off'),
    X402_NETWORK: env.X402_NETWORK ?? (chain === 'base' ? 'eip155:8453' : 'eip155:84532'),
    SELF_ENDPOINT: env.SELF_ENDPOINT ?? `${env.PUBLIC_API_URL}/v1/self/verify`,
    SESSION_SECRET: env.SESSION_SECRET ?? 'dev-only-session-secret-change-me',
    production,
  };
}

export type Env = ReturnType<typeof parseEnv>;
