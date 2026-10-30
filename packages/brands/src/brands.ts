import { defaultReclaimProvider } from './reclaim';
import type { Brand, BrandRail, EmailParser } from './types';

// Brand registry seeds. A brand counts as supported as soon as one rail works for it; most online brands get two.
// Reclaim provider IDs default to the ones in ./reclaim (read from Reclaim's directory); RECLAIM_PROVIDER_<BRAND>
// overrides them, as ZKEMAIL_BLUEPRINT_<BRAND> sets blueprints. brand_rails in Postgres is the live copy.

/** A brand's order page rail through a Reclaim provider: the directory's default unless the env var names another. */
function orderPage(brandId: string, notes?: string): BrandRail {
  const p = defaultReclaimProvider(brandId, 'order_page');
  return { rail: 'order_page', status: p ? 'testing' : 'planned', providerId: p?.id, providerEnv: `RECLAIM_PROVIDER_${brandId.toUpperCase()}`, notes };
}

const AMOUNT = String.raw`(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)`;

const GENERIC_ORDER_ID = [/Order\s*(?:No\.?|Number|ID|#)\s*[:#-]?\s*([A-Z0-9-]{6,30})/i, /Order\s+([0-9]{3}-[0-9]{7}-[0-9]{7})/];
const GENERIC_TOTAL = [
  new RegExp(String.raw`(?:Grand\s*Total|Order\s*Total|Total\s*Paid|Amount\s*Paid|Total\s*Amount|Bill\s*Total|Total)\s*[:\-]?\s*${AMOUNT}`, 'i'),
];
const GENERIC_ITEMS = [
  new RegExp(String.raw`^\s*(\d+)\s*[x×]\s*(.{2,80}?)\s+${AMOUNT}\s*$`, 'gim'),
  new RegExp(String.raw`^\s*(.{2,80}?)\s+[x×]\s*(\d+)\s+${AMOUNT}\s*$`, 'gim'),
];

function email(dkimDomains: string[], extra: Partial<EmailParser> = {}): EmailParser {
  return { dkimDomains, orderId: GENERIC_ORDER_ID, total: GENERIC_TOTAL, items: GENERIC_ITEMS, ...extra };
}

export const BRANDS: Brand[] = [
  // Food delivery: order page first, order email second.
  {
    id: 'swiggy',
    name: 'Swiggy',
    group: 'food_delivery',
    domains: ['swiggy.in', 'swiggy.com'],
    categories: ['food'],
    defaultRail: 'order_page',
    rails: [
      orderPage('swiggy', 'Prove one order, not the whole history: large payloads make proving slow. The community provider leaves out the order ID; one that extracts it keys duplicates per order.'),
      { rail: 'order_email', status: 'testing', blueprintEnv: 'ZKEMAIL_BLUEPRINT_SWIGGY' },
    ],
    email: email(['swiggy.in', 'swiggy.com'], {
      merchant: [/order (?:from|with)\s+(.{2,80}?)\s+(?:has been|was|is)\b/i, /Restaurant\s*[:\-]\s*(.{2,80})/i],
      orderId: [/Order\s*(?:No|ID|#)\.?\s*[:#-]?\s*(\d{6,20})/i, ...GENERIC_ORDER_ID],
    }),
  },
  {
    id: 'kfc',
    name: 'KFC',
    group: 'food_delivery',
    domains: ['kfc.co.in'],
    categories: ['food'],
    defaultRail: 'order_page',
    rails: [orderPage('kfc'), { rail: 'order_email', status: 'planned', blueprintEnv: 'ZKEMAIL_BLUEPRINT_KFC' }],
    email: email(['kfc.co.in']),
  },
  {
    id: 'zomato',
    name: 'Zomato',
    group: 'food_delivery',
    domains: ['zomato.com'],
    categories: ['food'],
    defaultRail: 'order_page',
    rails: [
      { rail: 'order_page', status: 'testing', providerEnv: 'RECLAIM_PROVIDER_ZOMATO' },
      { rail: 'order_email', status: 'testing', blueprintEnv: 'ZKEMAIL_BLUEPRINT_ZOMATO' },
    ],
    email: email(['zomato.com'], {
      merchant: [/(?:ordered|order) from\s+(.{2,80}?)(?:\s+has|\s+was|\.|\n)/i],
      orderId: [/Order\s*ID\s*[:#-]?\s*(\d{6,20})/i, ...GENERIC_ORDER_ID],
    }),
  },
  // Quick commerce and groceries: order email first, the order page where Reclaim has a provider, payment proof third.
  ...(['blinkit', 'zepto', 'instamart', 'bigbasket', 'jiomart'] as const).map((id): Brand => {
    const domains = { blinkit: ['blinkit.com', 'grofers.com'], zepto: ['zeptonow.com', 'zepto.co.in'], instamart: ['swiggy.in'], bigbasket: ['bigbasket.com'], jiomart: ['jiomart.com'] }[id];
    const page = defaultReclaimProvider(id, 'order_page') ? [orderPage(id)] : [];
    return {
      id,
      name: { blinkit: 'Blinkit', zepto: 'Zepto', instamart: 'Swiggy Instamart', bigbasket: 'BigBasket', jiomart: 'JioMart' }[id],
      group: 'quick_commerce',
      domains,
      categories: ['groceries'],
      defaultRail: id === 'jiomart' ? 'order_page' : 'order_email',
      rails: [{ rail: 'order_email', status: 'testing', blueprintEnv: `ZKEMAIL_BLUEPRINT_${id.toUpperCase()}` }, ...page, { rail: 'payment_proof', status: 'planned' }],
      email: email(domains),
    };
  }),
  // Marketplaces and fashion: order page first; order email and shop-through second.
  {
    id: 'amazon',
    name: 'Amazon India',
    group: 'marketplace',
    domains: ['amazon.in'],
    categories: ['products'],
    defaultRail: 'order_page',
    rails: [
      orderPage('amazon', 'The community provider proves an order by its number, not the item (tier B).'),
      { rail: 'order_email', status: 'testing', blueprintEnv: 'ZKEMAIL_BLUEPRINT_AMAZON' },
      { rail: 'shop_through', status: 'blocked', notes: 'Associates policy bars incentives on Amazon links without authorisation.' },
    ],
    email: email(['amazon.in'], { orderId: [/Order\s*#\s*([0-9]{3}-[0-9]{7}-[0-9]{7})/i, ...GENERIC_ORDER_ID] }),
  },
  ...(['flipkart', 'myntra', 'ajio', 'nykaa', 'meesho'] as const).map(
    (id): Brand => ({
      id,
      name: { flipkart: 'Flipkart', myntra: 'Myntra', ajio: 'AJIO', nykaa: 'Nykaa', meesho: 'Meesho' }[id],
      group: 'marketplace',
      domains: { flipkart: ['flipkart.com'], myntra: ['myntra.com'], ajio: ['ajio.com'], nykaa: ['nykaa.com'], meesho: ['meesho.com'] }[id],
      categories: ['products'],
      defaultRail: 'order_page',
      rails: [
        { rail: 'order_page', status: 'planned', providerEnv: `RECLAIM_PROVIDER_${id.toUpperCase()}` },
        { rail: 'order_email', status: 'testing', blueprintEnv: `ZKEMAIL_BLUEPRINT_${id.toUpperCase()}` },
        {
          rail: 'shop_through',
          status: 'planned',
          network: 'cuelinks',
          incentiveAllowed: undefined,
          deeplinkTemplate: { flipkart: 'https://www.flipkart.com/search?q={q}', myntra: 'https://www.myntra.com/{q}', ajio: 'https://www.ajio.com/search/?text={q}', nykaa: 'https://www.nykaa.com/search/result/?q={q}', meesho: 'https://www.meesho.com/search?q={q}' }[id],
          notes: 'Check each campaign allows cashback before enabling.',
        },
      ],
      email: email({ flipkart: ['flipkart.com'], myntra: ['myntra.com'], ajio: ['ajio.com'], nykaa: ['nykaa.com'], meesho: ['meesho.com'] }[id]),
    }),
  ),
  {
    id: 'nike',
    name: 'Nike',
    group: 'marketplace',
    domains: ['nike.com'],
    categories: ['products'],
    defaultRail: 'order_page',
    rails: [orderPage('nike'), { rail: 'order_email', status: 'planned', blueprintEnv: 'ZKEMAIL_BLUEPRINT_NIKE' }],
    email: email(['nike.com']),
  },
  {
    id: 'shopify_d2c',
    name: 'D2C brands on Shopify',
    group: 'd2c',
    domains: ['shopify.com', 'myshopify.com'],
    categories: ['products'],
    defaultRail: 'order_email',
    rails: [
      { rail: 'order_email', status: 'planned', notes: 'Each store signs with its own domain; add the store domain to dkimDomains per brand.' },
      { rail: 'shop_through', status: 'planned', network: 'inrdeals' },
    ],
    email: email(['shopify.com', 'myshopify.com']),
  },
  // Travel: booking email first, order page second. Booking IDs and PNRs are never published.
  ...(
    [
      ['indigo', 'IndiGo', ['goindigo.in', 'customer.goindigo.in']],
      ['airindia', 'Air India', ['airindia.com', 'airindia.in']],
      ['akasa', 'Akasa Air', ['akasaair.com']],
      ['irctc', 'IRCTC', ['irctc.co.in']],
      ['makemytrip', 'MakeMyTrip', ['makemytrip.com']],
      ['goibibo', 'Goibibo', ['goibibo.com']],
      ['airbnb', 'Airbnb', ['airbnb.com']],
      ['oyo', 'OYO', ['oyorooms.com', 'oyo.com']],
      ['booking', 'Booking.com', ['booking.com']],
      ['uber', 'Uber', ['uber.com']],
      ['ola', 'Ola', ['olacabs.com']],
      ['rapido', 'Rapido', ['rapido.bike']],
    ] as const
  ).map(
    ([id, name, domains]): Brand => ({
      id,
      name,
      group: 'travel',
      domains: [...domains],
      categories: ['travel'],
      defaultRail: 'order_email',
      rails: [
        { rail: 'order_email', status: id === 'irctc' || id === 'indigo' || id === 'uber' ? 'testing' : 'planned', blueprintEnv: `ZKEMAIL_BLUEPRINT_${id.toUpperCase()}` },
        orderPage(id),
      ],
      email: email([...domains], {
        orderId: [
          /(?:PNR|Booking\s*(?:ID|Reference|No\.?)|Confirmation\s*(?:code|number)|Trip\s*ID)\s*[:#-]?\s*([A-Z0-9-]{5,20})/i,
          ...GENERIC_ORDER_ID,
        ],
        merchant: [/(?:Hotel|Property|Stay at|Your stay at|reservation at)\s*[:\-]?\s*(.{2,80}?)(?:\n|,|\s+is\b)/i],
        travelDate: [/(?:Check[-\s]?out|Departure|Journey Date|Date of Journey|Trip date)\s*[:\-]?\s*([0-9]{1,2}[\s/-][A-Za-z0-9]{2,9}[\s/-][0-9]{2,4})/i],
      }),
    }),
  ),
  // Dine-in, salons, repairs, local shops: payment proof first, merchant receipt second.
  {
    id: 'local',
    name: 'Local merchant (UPI)',
    group: 'local',
    domains: [],
    categories: ['food', 'local_services'],
    defaultRail: 'payment_proof',
    rails: [
      { rail: 'payment_proof', status: 'testing', providerEnv: 'RECLAIM_PROVIDER_UPI', notes: 'Bank or UPI app web history through a custom Reclaim provider.' },
      { rail: 'merchant_receipt', status: 'testing', notes: 'Merchants who join through the dashboard print a signed QR on the bill.' },
    ],
  },
  {
    id: 'rent',
    name: 'Rent (landlord via UPI or bank)',
    group: 'landlord',
    domains: [],
    categories: ['landlords'],
    defaultRail: 'payment_proof',
    rails: [
      { rail: 'payment_proof', status: 'testing', providerEnv: 'RECLAIM_PROVIDER_UPI', notes: '3+ months of rent payments to the same payee.' },
      { rail: 'order_email', status: 'planned', notes: 'Rent-receipt emails from rental platforms (NoBroker, NestAway).' },
    ],
    email: email(['nobroker.in', 'nestaway.com', 'housing.com']),
  },
  // Subscriptions and apps: invoice email first, payment proof second.
  ...(
    [
      ['netflix', 'Netflix', ['netflix.com']],
      ['spotify', 'Spotify', ['spotify.com']],
      ['youtube', 'YouTube Premium', ['google.com', 'youtube.com']],
      ['hotstar', 'JioHotstar', ['hotstar.com', 'jiohotstar.com']],
    ] as const
  ).map(
    ([id, name, domains]): Brand => ({
      id,
      name,
      group: 'subscription',
      domains: [...domains],
      categories: ['subscriptions'],
      defaultRail: 'order_email',
      rails: [
        { rail: 'order_email', status: 'planned', blueprintEnv: `ZKEMAIL_BLUEPRINT_${id.toUpperCase()}` },
        ...(defaultReclaimProvider(id, 'order_page') ? [orderPage(id)] : []),
        { rail: 'payment_proof', status: 'planned' },
      ],
      email: email([...domains]),
    }),
  ),
  {
    id: 'paytm',
    name: 'Paytm (recharges, bills, tickets)',
    group: 'subscription',
    domains: ['paytm.com'],
    categories: ['subscriptions'],
    defaultRail: 'order_page',
    rails: [orderPage('paytm'), { rail: 'order_email', status: 'planned', blueprintEnv: 'ZKEMAIL_BLUEPRINT_PAYTM' }],
    email: email(['paytm.com']),
  },
  // Agents and APIs: the payment transaction is the receipt.
  {
    id: 'x402',
    name: 'x402 APIs and agents',
    group: 'agents',
    domains: [],
    categories: ['agents_apis'],
    defaultRail: 'onchain_payment',
    rails: [{ rail: 'onchain_payment', status: 'live', notes: 'USDC on Base, including x402 payments.' }],
  },
  // ONDC sellers: network order first, order email second.
  {
    id: 'ondc',
    name: 'ONDC sellers',
    group: 'ondc',
    domains: ['ondc.org'],
    categories: ['food', 'groceries', 'products'],
    defaultRail: 'network_order',
    rails: [
      { rail: 'network_order', status: 'planned', notes: 'Needs Receipts to run or partner with a buyer app.' },
      { rail: 'order_email', status: 'planned' },
    ],
  },
];
