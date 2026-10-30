// Bootstrap the Receipts catalog in Dodo TEST mode. Never prints API keys or webhook secrets.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import DodoPayments from 'dodopayments';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

const events = [
  'payment.succeeded',
  'subscription.active',
  'subscription.renewed',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.expired',
  'subscription.on_hold',
  'subscription.failed',
  'subscription.paused',
  'subscription.unpaused',
  'subscription.past_due',
];

function save(values) {
  for (const file of ['.env', '.env.vercel']) {
    if (file === '.env.vercel' && !existsSync(file)) continue;
    let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    for (const [name, value] of Object.entries(values)) {
      if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid value for ${name}.`);
      const pattern = new RegExp(`^${name}=.*$`, 'm');
      text = pattern.test(text) ? text.replace(pattern, () => `${name}=${value}`) : `${text.trimEnd()}${newline}${name}=${value}${newline}`;
    }
    writeFileSync(file, text);
    console.log(`Updated ${file}: ${Object.keys(values).join(', ')} (values hidden).`);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'merchant-price': { type: 'string' },
    'merchant-currency': { type: 'string' },
    'webhook-url': { type: 'string' },
    'webhook-id': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('pnpm dodo:setup [--merchant-price=1000 --merchant-currency=USD] [--webhook-url=https://your-domain/v1/dodo/webhook --webhook-id=ep_...]');
    console.log('Test mode only. Price is in minor units; defaults to $10/month. Existing configured monthly pricing is kept unless price flags are supplied.');
    return;
  }
  const env = { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env };
  if (env.DODO_ENV && env.DODO_ENV !== 'test_mode') throw new Error('This setup command only supports DODO_ENV=test_mode. Configure live products separately.');
  if (!env.DODO_API_KEY?.startsWith('dodo_test_')) throw new Error('Set a Dodo test-mode DODO_API_KEY in .env first.');
  // Avoid mixing a live or different account's deployment file with this test catalog.
  if (existsSync('.env.vercel')) {
    const deployment = parseEnv(readFileSync('.env.vercel', 'utf8'));
    if ((deployment.DODO_ENV && deployment.DODO_ENV !== 'test_mode') || (deployment.DODO_API_KEY && deployment.DODO_API_KEY !== env.DODO_API_KEY)) {
      throw new Error('.env.vercel has a different Dodo account or environment. Align it with the test account before running setup.');
    }
  }
  const currency = (values['merchant-currency'] ?? 'USD').toUpperCase();
  const amount = Number(values['merchant-price'] ?? '1000');
  if (!['USD', 'INR'].includes(currency)) throw new Error('Use USD or INR for --merchant-currency.');
  if (!Number.isSafeInteger(amount) || amount < 100) throw new Error('--merchant-price must be an integer of at least 100 minor units; Dodo may enforce a higher minimum for your currency.');
  let webhookUrl;
  if (values['webhook-id'] && !values['webhook-url']) throw new Error('--webhook-id requires --webhook-url so the existing endpoint destination can be checked.');
  if (values['webhook-url']) {
    const url = new URL(values['webhook-url']);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/dodo/webhook' || /^(localhost|127\.|\[::1\])/.test(url.hostname)) {
      throw new Error('--webhook-url must be a public HTTPS URL ending in /v1/dodo/webhook without credentials, query or fragment.');
    }
    webhookUrl = url.toString();
  }
  const client = new DodoPayments({ bearerToken: env.DODO_API_KEY, environment: 'test_mode', maxRetries: 0, timeout: 20_000 });
  // Check an explicitly selected endpoint before creating any catalog products.
  const selectedHook = values['webhook-id'] ? await client.webhooks.retrieve(values['webhook-id']) : null;
  if (selectedHook && selectedHook.url !== webhookUrl) throw new Error('The selected webhook endpoint does not match --webhook-url. No settings were changed.');
  const products = [];
  for await (const product of client.products.list({ archived: false, page_size: 100 })) products.push(product);

  async function product(kind, configuredId, input) {
    const matches = products.filter((p) => p.metadata?.app === 'receipts' && p.metadata?.kind === kind);
    if (!configuredId && matches.length > 1) throw new Error(`Multiple Receipts ${kind} products exist; choose its product ID in .env.`);
    const id = configuredId || matches[0]?.product_id;
    if (id && !products.some((p) => p.product_id === id)) throw new Error(`Configured ${kind} product is missing or archived in this test account.`);
    let result = id ? await client.products.retrieve(id) : null;
    if (result) {
      const price = result.price;
      const validCredits = kind !== 'credits' || (price.type === 'one_time_price' && price.currency === 'USD' && price.price === 100 && !price.pay_what_you_want && !price.discount && !price.discount_bps && !price.purchasing_power_parity);
      const explicitPrice = values['merchant-price'] || values['merchant-currency'];
      const validPlan = kind !== 'merchant_pro' || (price.type === 'recurring_price' && price.payment_frequency_count === 1 && price.payment_frequency_interval === 'Month' && price.subscription_period_count === 20 && price.subscription_period_interval === 'Year' && (!explicitPrice || (price.currency === currency && price.price === amount)));
      if (!validCredits || !validPlan) throw new Error(`Existing ${kind} product has incompatible pricing. Correct the product or select another product ID; setup does not silently change prices.`);
      console.log(`Using ${kind} product ${result.product_id}.`);
    } else {
      result = await client.products.create({ ...input, metadata: { app: 'receipts', kind }, tax_category: 'saas' });
      console.log(`Created ${kind} test product ${result.product_id}.`);
    }
    return result.product_id;
  }

  const credits = await product('credits', env.DODO_PRODUCT_CREDITS, {
    name: 'Receipts API credits (test)',
    description: 'One unit adds $1 of Receipts API query credits. Test-mode product.',
    price: { type: 'one_time_price', currency: 'USD', price: 100, pay_what_you_want: false, tax_inclusive: false },
  });
  save({ DODO_ENV: 'test_mode', DODO_PRODUCT_CREDITS: credits });
  const merchant = await product('merchant_pro', env.DODO_PRODUCT_MERCHANT_PRO, {
    name: 'Receipts Business Pro (test)',
    description: 'Monthly business insights, alerts and receipts. Paying never changes review scores or rankings. Test-mode product.',
    price: {
      type: 'recurring_price', currency, price: amount, tax_inclusive: false,
      payment_frequency_count: 1, payment_frequency_interval: 'Month',
      subscription_period_count: 20, subscription_period_interval: 'Year',
    },
  });
  save({ DODO_PRODUCT_MERCHANT_PRO: merchant });

  if (!webhookUrl) {
    console.log('Products are ready. To connect payment fulfillment, run again with --webhook-url=https://your-domain/v1/dodo/webhook.');
    console.log('No webhook endpoint or secret was created. Existing webhook settings were kept. Restart the API after setup; import .env.vercel into Vercel and redeploy when ready.');
    return;
  }
  const hooks = [];
  for await (const hook of client.webhooks.list()) if (hook.url === webhookUrl) hooks.push(hook);
  if (hooks.length > 1) throw new Error('Multiple webhooks use this URL. Keep one endpoint in Dodo before running setup.');
  const existing = selectedHook ?? hooks[0];
  const hook = existing
    ? await client.webhooks.update(existing.id, { disabled: false, filter_types: existing.filter_types == null ? null : [...new Set([...existing.filter_types, ...events])] })
    : await client.webhooks.create({ url: webhookUrl, description: 'Receipts test billing', filter_types: events, metadata: { app: 'receipts' }, idempotency_key: `receipts:${webhookUrl}` });
  const { secret } = await client.webhooks.retrieveSecret(hook.id);
  save({ DODO_WEBHOOK_SECRET: secret });
  console.log(`Test webhook configured: ${hook.id} at ${webhookUrl}. Restart the API; import .env.vercel into Vercel and redeploy to apply it there.`);
}

main().catch((error) => {
  // SDK errors may carry request headers. Do not log error objects or provider payloads.
  console.error(error instanceof DodoPayments.APIError ? `Dodo setup failed (HTTP ${error.status ?? 'unknown'}). Check the test key, account permissions and product settings in the Dodo dashboard.` : error.message);
  process.exitCode = 1;
});
