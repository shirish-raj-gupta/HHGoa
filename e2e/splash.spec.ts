import { expect, test, WEB } from './fixtures';

// The first-visit splash on the reviewer home page: it sends each kind of visitor where they meant to go, shows once,
// and the home page leads with the choice afterwards.

test.use({ splash: true });

test('a first visit opens the splash, and "review what I bought" goes to the review page', async ({ page }) => {
  await page.goto(`${WEB}/`);
  const doors = page.getByRole('dialog', { name: /What brings you to Receipts/ });
  await expect(doors).toBeVisible();
  await doors.getByRole('button', { name: /Review what I bought/ }).click();
  await expect(page).toHaveURL(`${WEB}/review`);
  await expect(page.locator('h1').first()).toContainText(/Write a verified review/);

  // Shown once: back home there is no splash, and the page leads with the review link.
  await page.goto(`${WEB}/`);
  await expect(page.locator('h1').first()).toContainText(/No receipt,\s*no review/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Write a verified review/ }).first()).toBeVisible();

  // Choosing again opens the doors at once; Escape closes them and keeps the earlier choice.
  await page.getByRole('button', { name: 'Here for something else?' }).click();
  await expect(page.getByRole('dialog', { name: /What brings you to Receipts/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Here for something else?' })).toBeVisible();
});

test('skipping the splash keeps it away', async ({ page }) => {
  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('h1').first()).toContainText(/No receipt,\s*no review/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'What brings you here?' })).toBeVisible();
});
