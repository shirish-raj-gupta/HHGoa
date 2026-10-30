import type { Page } from '@playwright/test';
import { BUSINESS, expect, STAGE, test, WEB } from './fixtures';

// The theme toggle: skin (light) and dark, remembered per device and applied before the first paint.

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

test('the reviewer app switches between skin and dark and remembers the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${WEB}/`);
  expect(await theme(page), 'follows the system until someone picks').toBeNull();
  await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
  await expect.poll(() => theme(page)).toBe('dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(3, 15, 36)');

  // Applied before the page paints on the next visit, so it never flashes skin.
  await page.reload();
  expect(await theme(page)).toBe('dark');
  await page.getByRole('button', { name: 'Switch to the skin (light) theme' }).click();
  await expect.poll(() => theme(page)).toBe('light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 231, 215)');
});

test('the stage starts dark for the projector and can switch to skin', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${STAGE}/`);
  expect(await theme(page)).toBe('dark');
  await page.getByRole('button', { name: 'Switch to the skin (light) theme' }).click();
  await expect.poll(() => theme(page)).toBe('light');
  await page.reload();
  expect(await theme(page)).toBe('light');
});

test('the business dashboard has the same switch', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BUSINESS}/`);
  await page.getByRole('button', { name: 'Switch to the skin (light) theme' }).click();
  await expect.poll(() => theme(page)).toBe('light');
});
