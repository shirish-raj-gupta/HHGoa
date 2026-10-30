import { API, BUSINESS, expect, expectNoSideScroll, STAGE, test, WEB } from './fixtures';

// Every page of the three apps opens without errors, shows its heading and fits the screen. Runs on desktop and
// on a phone.

const PAGES: [string, string, RegExp][] = [
  ['home', `${WEB}/`, /No receipt,\s*no review/],
  ['review', `${WEB}/review`, /Write a verified review/],
  ['check-ins', `${WEB}/followups`, /Check-ins/],
  ['earnings', `${WEB}/earnings`, /Earnings/],
  ['for agents', `${WEB}/developers`, /Receipts for AI agents/],
  ['leaderboard', `${WEB}/leaderboard`, /Most-cited reviewers/],
  ['wallet and identity', `${WEB}/onboard`, /Your wallet and one-human check/],
  ['not found', `${WEB}/no-such-page`, /No receipt here/],
  ['business home', `${BUSINESS}/`, /See what verified buyers say about you/],
  ['business claim', `${BUSINESS}/claim`, /Claim your listing/],
  ['business billing', `${BUSINESS}/billing`, /Billing/],
  ['stage', `${STAGE}/`, /Different sources/],
  ['stage attack', `${STAGE}/attack`, /What happens when someone games it/],
  ['stage sandbox', `${STAGE}/sandbox`, /The web the left agent searched/],
];

for (const [name, url, heading] of PAGES) {
  test(`${name} page opens cleanly`, async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('h1').first()).toContainText(heading);
    await expect(page.getByRole('link', { name: /Receipts/ }).first()).toBeVisible();
    await expectNoSideScroll(page);
  });
}

test('stage numbers page opens cleanly', async ({ page }) => {
  await page.goto(`${STAGE}/stats`);
  await expect(page.getByText('verified reviews from real purchases')).toBeVisible();
  await expectNoSideScroll(page);
});

test('a receipt page opens cleanly', async ({ page, request }) => {
  const res = await request.post(`${API}/v1/ask`, { data: { q: 'best veg biryani under 400 near Calangute' } });
  const answer = (await res.json()) as { options: { claims: { receipts: string[] }[] }[] };
  const url = answer.options[0]?.claims[0]?.receipts[0];
  expect(url, 'the seeded data has a receipt to open').toBeTruthy();
  await page.goto(url!.replace(/^https?:\/\/[^/]+/, WEB));
  await expect(page.getByText('Proof ledger')).toBeVisible();
  await expect(page.getByText('Simulated demo data').first()).toBeVisible();
  await expectNoSideScroll(page);
});
