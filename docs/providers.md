# Reclaim providers: the fields we read

Rails 1 (order page) and 3 (payment proof) take whatever a Reclaim provider extracts and map it to one purchase.
Custom providers should extract the canonical names; community providers are mapped through their entry in
`packages/brands/src/reclaim.ts` (our field -> their variable), then through the aliases below.
Source of truth: `packages/rails/src/reclaim.ts`.

## What Reclaim's directory has (checked 2026-10-29)

The whole directory (`GET https://devapi.reclaimprotocol.org/api/providers/active`, about 19 MB) lists 25,089
providers. 22,464 are universities; of the other 2,625, 543 mention a purchase, and only 52 extract an order or
transaction reference with an amount, items or a date. Most of those are tests or foreign payment apps. The ones that
fit Receipts are in `packages/brands/src/reclaim.ts`, used by default:

| Brand | Provider | Proves | Tier |
|---|---|---|---|
| Swiggy | `8aac5893…` Last Order Details | restaurant, dishes, total (no order number) | A |
| Swiggy Instamart | `24dbc5f4…` | order number and amount | B |
| Blinkit | `675fa687…` Last 3 Orders | order number, amount, date | B |
| JioMart | `46538f0f…` | first product, amount, date (also your name, email, mobile) | A |
| Amazon.in | `1d270ba2…` Amazon Orders A | that an order exists, by number | B |
| Nike | `7440d107…` | product, order number, date | A |
| KFC India | `eed85427…` | first item, price, date | A |
| Paytm | `f0a8cd0f…` | the order (recharge, bill, ticket), number, amount, date | A |
| Netflix | `789c875f…` | the current plan | A |
| Uber | `29b27359…` Uber Last Ride | fare of the latest ride (nothing personal) | B |

All are community providers: their configs were read, sessions start through our app, but none has carried a real
order yet, so each rail stays `testing` until one does on two phones. `RECLAIM_PROVIDER_<BRAND>` overrides a default.

Not usable, so build these in the Reclaim devtool (dev.reclaimprotocol.org, "Create provider"):

- **Zomato**: every directory provider proves an order count or a username; one is hard-wired to its author's page.
  Prove `www.zomato.com/webroutes/user/orders` (or the order details call the orders page makes) and extract
  `orderId`, `restaurantName`, `items`, `total`, `orderTime` for the latest order.
- **UPI payments (local shops, rent)**: no UPI app has web history, so it has to be a bank's netbanking statement. The
  only bank provider, HDFC "Last Transaction" (`343537da…ff872`), captures the description with three lazy groups,
  so its payee comes back empty, and it also extracts the account balance. Build one per bank that extracts
  `upiRef`, `payeeName`, `payeeVpa`, `amount`, `txnTime` from the latest debit, and nothing else.
- **BookMyShow** has booking providers, but they need the booking ID typed in and Receipts has no events category yet.

## The QR code

The request link Reclaim's SDK makes is about 1,600 characters, too dense for a QR code a camera can read off a
screen (about 137 squares a side). So the QR carries a short link: ours (`/go/proof/<id>`, redirecting to Reclaim's
in-browser portal) when phones can reach the API, otherwise Reclaim's own short link, which opens its verifier app.
"Log in with Reclaim" opens the portal in the same browser, which needs no phone at all.

## Order page (rail 1, proves the items)

| Canonical | Also accepted |
|---|---|
| `orderId` (required) | `order_id`, `orderID`, `orderNumber`, `order_number`, `id` |
| `items` | `itemNames`, `item_names`, `dishes`, `products`, `orderItems` (a list or JSON list; objects may carry `name`, `quantity`, `price`) |
| `itemPrices` | `item_prices`, `prices` |
| `total` | `orderTotal`, `order_total`, `grandTotal`, `billTotal`, `totalAmount`, `amount` |
| `merchantName` | `restaurantName`, `restaurant_name`, `restaurant`, `storeName`, `sellerName`, `merchant`, `hotelName` |
| `merchantId` | `restaurantId`, `restaurant_id`, `storeId`, `outletId`, `sellerId` |
| `orderTime` | `order_time`, `orderedAt`, `ordered_at`, `orderDate`, `order_date`, `date`, `timestamp` |
| `address` | `restaurantAddress`, `locality`, `area` |

## Payment proof (rail 3, proves the payment only)

| Canonical | Also accepted |
|---|---|
| `upiRef` (required) | `utr`, `rrn`, `upi_ref`, `upiTransactionId`, `transactionId`, `txnId`, `referenceId`, `refId` |
| `payeeName` | `payee`, `merchantName`, `toName`, `beneficiary`, `paidTo` |
| `payeeVpa` | `vpa`, `upiId`, `toVpa`, `payee_vpa` |
| `amount` | `txnAmount`, `total` |
| `txnTime` | `transactionDate`, `date`, `time`, `timestamp` |

Rent (landlord reviews) may instead extract `payments`: a JSON list of `{amount, date, ref}`.

## Providers in use (checked 2026-10-29)

From Reclaim's public directory (308 providers matched our brands). All are community-made and unverified; our app
starts sessions with each.

| Env var | Provider | Proves | Gaps |
|---|---|---|---|
| `RECLAIM_PROVIDER_SWIGGY` | `8aac5893-f43b-4fd9-ad26-ae266da258d2` "Swiggy Last Order Details" | The latest order: restaurant, items (JSON), net total, delivery status, from `swiggy.com/mapi/order/all` | No order ID or time: duplicates are keyed per reviewer, and the date is the day of the proof |
| `RECLAIM_PROVIDER_BLINKIT` | `675fa687-4e5b-45ec-b560-ec8cd61174eb` "Blinkit Last 3 Orders" | The newest three orders: ID, amount, date, status, cart ID, from `blinkit.com/v1/layout/order_history` | No items, so the claim is tier B |

A cancelled, failed or rejected order is refused whatever the provider.

## Still to build

No community provider proves an order for these. In the Reclaim devtool, create a provider (or open the closest one
and duplicate it). Log in to the site inside it, pick the request, select the fields under the canonical names above,
publish it, add it to the app, and test it on two phones.

| Env var | Request to pick | Fields | Closest community provider |
|---|---|---|---|
| `RECLAIM_PROVIDER_SWIGGY` (upgrade) | `GET https://www.swiggy.com/mapi/order/all?order_id=` | From `$.data.orders[0]`: `order_id` as orderId, `order_time` as orderTime, plus the four it has | Duplicate `8aac5893…` and add the two fields |
| `RECLAIM_PROVIDER_ZOMATO` | The JSON behind Profile → Order history (`zomato.com/webroutes/getPage?page_url=/users/<you>/ordering`) | orderId, merchantName (restaurant), items, total, orderTime | None: the directory's Zomato providers prove a username or an order count |
| `RECLAIM_PROVIDER_AMAZON` | `https://www.amazon.in/gp/your-account/order-details?orderID=…` (HTML, so XPath) | orderId, items (product titles), total, orderTime | `1d270ba2-8680-415b-b7e2-2cebd47f6f02` "Amazon Orders A" proves the newest order ID only |
| `RECLAIM_PROVIDER_UPI` | A bank's netbanking statement, or a UPI app's web history | upiRef, payeeName or payeeVpa, amount, txnTime | `343537da-09a8-4b34-a1dd-06a1166ff872` "HDFC Last Transaction": HDFC accounts only, and it also extracts the balance |

Items split on `|`, `;` or new lines, or come as a JSON list. Zomato's dish list is comma-separated, so extract each
dish if the devtool allows it.

The planned brands (Flipkart, Myntra, AJIO, Nykaa, Meesho, the airlines, IRCTC, MakeMyTrip, Goibibo, Airbnb, OYO,
Booking.com, Uber, Ola, Rapido) have no community provider that proves an order either; their order email rail works
without one. `RECLAIM_PROVIDER_SWIGGY_PARTNER` is declared but not read yet.

## Testing a provider

1. Set `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET` and `RECLAIM_PROVIDER_<BRAND>`, restart the API.
2. On a phone, web app → Review → Prove a purchase → the brand → Order page.
3. The API log shows the extracted parameters on failure; the brand's rail stays `testing` in
   `packages/brands/src/brands.ts` until it works on two phones, then flip it to `live`.
