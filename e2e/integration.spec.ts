import { ADMIN, BUSINESS, expect, test, WEB } from './fixtures';

// The apps working together through the API: one account for reviewing and for running a business; a business claims
// a listing in the business app, an operator approves it in the admin console, and the business app then says the
// listing is theirs. The footers link the apps together.

test('one account: signing in on the reviewer site signs in the business app too', async ({ page }) => {
  await page.goto(`${WEB}/onboard`);
  await page.getByRole('button', { name: 'Use a wallet on this device' }).click();
  const line = await page.getByText(/Signed in as 0x/).textContent();
  const wallet = /0x[0-9a-f]{40}/i.exec(line ?? '')![0];

  // The business app lives on the same origin, one click away in the footer (a full page load into the other zone),
  // and the same wallet is already signed in: no second sign-in.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('link', { name: 'Receipts for businesses' }).click();
  await expect(page).toHaveURL(new RegExp(`^${BUSINESS}`));
  await expect(page.getByText('No claimed listings on this wallet yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use a wallet on this device' })).toHaveCount(0);
  await expect(page.getByTitle('Sign out')).toContainText(`${wallet.slice(0, 6)}…${wallet.slice(-4)}`, { ignoreCase: true });
});

test('a business claim goes from the business app to the admin console and back', async ({ page, context }) => {
  // The business signs in and claims a seeded listing with a method a person checks.
  await page.goto(`${BUSINESS}/`);
  await page.getByRole('button', { name: 'Use a wallet on this device' }).click();
  await expect(page.getByText('No claimed listings on this wallet yet')).toBeVisible();
  await page.getByRole('link', { name: 'Claim', exact: true }).click();
  await page.getByLabel('Business name').fill('Saudade');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('region', { name: 'On Receipts' }).getByRole('button', { name: /Saudade Kitchen/ }).click();
  await page.getByRole('button', { name: /Swiggy or Zomato partner dashboard/ }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/\/claim\/[^/]+$/);
  await expect(page.getByText('a person at Receipts approves it')).toBeVisible();
  await expect(page.getByText('Status: pending')).toBeVisible();

  // An operator approves it in the admin console (open: the test API has no ADMIN_TOKEN, and says so).
  const admin = await context.newPage();
  await admin.goto(`${ADMIN}/claims`);
  await expect(admin.getByText(/no ADMIN_TOKEN/)).toBeVisible();
  // The seeded listing is simulated, so its name carries the "(demo)" label everywhere.
  const claim = admin.getByText('Saudade Kitchen (demo)', { exact: true }).locator('xpath=ancestor::div[.//button[normalize-space()="Approve"]][1]');
  await claim.getByRole('button', { name: 'Approve' }).click();
  await admin.getByRole('tab', { name: 'Approved' }).click();
  await expect(admin.getByText('Saudade Kitchen (demo)', { exact: true })).toBeVisible();

  // Back in the business app the claim has gone through, and the dashboard opens.
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Verified. The listing is yours.')).toBeVisible();
  await page.getByRole('link', { name: 'Open the dashboard' }).click();
  await expect(page.locator('h1').first()).toContainText('Saudade Kitchen');

  // Each app's footer links to the others.
  await expect(page.getByRole('link', { name: 'Receipts for reviewers' })).toHaveAttribute('href', new RegExp(`^${WEB}`));
  await expect(admin.getByRole('link', { name: 'Business app' })).toHaveAttribute('href', new RegExp(`^${BUSINESS}`));
  await expect(admin.getByRole('link', { name: 'Reviewer site' })).toHaveAttribute('href', new RegExp(`^${WEB}`));
});
