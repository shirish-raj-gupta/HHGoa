import { BUSINESS, expect, STAGE, test, WEB } from './fixtures';

// The main journeys, end to end in the browser, against the API.

test('a reviewer proves a purchase, reviews it, publishes it and re-checks the receipt', async ({ page }) => {
  // Wallet in the browser, signed in, verified as a (labelled) mock human.
  await page.goto(`${WEB}/onboard`);
  await page.getByRole('button', { name: 'Use a wallet on this device' }).click();
  await expect(page.getByText(/Signed in as 0x/)).toBeVisible();
  await page.getByRole('button', { name: 'Use a mock human' }).click();
  await expect(page.getByText('verified (mock)')).toBeVisible();

  // Prove a purchase on the dev rail; the review draft opens by itself.
  await page.goto(`${WEB}/review`);
  await page.getByRole('button', { name: 'Prove a purchase' }).first().click();
  await page.getByRole('button', { name: /Dev rail/ }).click();
  await page.getByRole('button', { name: 'Create simulated purchase' }).click();
  await page.waitForURL(/\/review\/[^/]+$/);

  // Type the review, get the card, change the stars, sign and publish.
  await page.getByRole('tab', { name: 'Type' }).click();
  await page.getByPlaceholder(/The biryani was not oily/).fill('The veg dum biryani was excellent and not oily. Portion fed two people. 5 stars.');
  await page.getByRole('button', { name: 'Make my card' }).click();
  await expect(page.getByText('Your review card')).toBeVisible();
  await page.getByRole('radio', { name: '4 stars' }).click();
  await expect(page.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Sign and publish' }).click();
  await expect(page.getByRole('heading', { name: 'Published.' })).toBeVisible();

  // The receipt shows the review and every applicable check passes.
  await page.getByRole('link', { name: 'Open the receipt' }).click();
  await expect(page.getByText('Proof ledger')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Veg Dum Biryani');
  await page.getByRole('button', { name: 'Re-check this receipt' }).click();
  await expect(page.getByText('Every check that applies passed.')).toBeVisible();
});

test('asking a question gives ranked options that link to their receipts', async ({ page }) => {
  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: 'Best veg biryani under ₹400 near Calangute' }).click();
  await expect(page.getByText('Answer from receipts')).toBeVisible();
  await expect(page.getByText('Top pick')).toBeVisible();
  await page.getByRole('link', { name: 'receipt 1' }).first().click();
  await expect(page.getByText('Proof ledger')).toBeVisible();
});

test('email sign-in opens Privy without a login-method error', async ({ page }) => {
  await page.goto(`${WEB}/onboard`);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page.getByPlaceholder(/email/i).first()).toBeVisible();
  await expect(page.getByText(/not allowed/i)).toHaveCount(0);
});

test('a business signs in with a device wallet and finds a listing to claim', async ({ page }) => {
  await page.goto(`${BUSINESS}/`);
  await page.getByRole('button', { name: 'Use a wallet on this device' }).click();
  await expect(page.getByText('No claimed listings on this wallet yet')).toBeVisible();
  await page.getByRole('link', { name: 'Claim', exact: true }).click();
  await page.getByLabel('Business name').fill('Saudade');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/Saudade Kitchen/).first()).toBeVisible();
});

test('the stage plants a review ring and the trust score holds', async ({ page }) => {
  await page.goto(`${STAGE}/attack`);
  await page.getByRole('button', { name: 'Plant a review ring' }).click();
  await expect(page.getByText('The Receipts trust score')).toBeVisible();
  await expect(page.getByText('A plain star average')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
});

test('the stage runs both agents side by side', async ({ page }) => {
  await page.goto(`${STAGE}/`);
  await page.getByRole('button', { name: 'Ask both agents' }).click();
  await expect(page.getByText(/sources were planted/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/verified buyers/).first()).toBeVisible({ timeout: 90_000 });
});
