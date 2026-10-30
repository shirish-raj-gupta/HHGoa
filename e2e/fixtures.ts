import { expect, test as base, type Page } from '@playwright/test';

// The test stack's own ports, beside `pnpm dev` (see playwright.config.ts and test.env).
export const WEB = 'http://localhost:3100';
// The business app is a zone of the reviewer site: /business on the same origin (its own server runs on 3101).
export const BUSINESS = 'http://localhost:3100/business';
export const STAGE = 'http://localhost:3102';
export const ADMIN = 'http://localhost:3103';
export const API = 'http://localhost:8799';

// Console lines from the dev tooling that say nothing about the app (Next's dev client logs its COOP check on any
// 404 page; production builds do not).
const IGNORED = [/Download the React DevTools/i, /\[Fast Refresh\]/, /\[HMR\]/, /Error checking Cross-Origin-Opener-Policy/];

/** Every test fails on an uncaught error or a console error in any page it opened. The first-visit splash is marked as
 *  seen unless a test asks for it with `test.use({ splash: true })`. */
export const test = base.extend<{ errors: string[]; splash: boolean }>({
  splash: [false, { option: true }],
  context: async ({ context, splash }, use) => {
    if (!splash) {
      await context.addInitScript(() => {
        try {
          if (localStorage.getItem('receipts.role') === null) localStorage.setItem('receipts.role', 'skip');
        } catch {}
      });
    }
    await use(context);
  },
  errors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (page: Page) => {
        page.on('pageerror', (e) => errors.push(`${page.url()} threw: ${e.message}`));
        page.on('console', (m) => {
          if (m.type() !== 'error' || IGNORED.some((r) => r.test(m.text()))) return;
          // A not-found page answers 404 for its own document; that is correct, not an error. Any other failed load is.
          if (/status of 404/.test(m.text()) && m.location().url === page.url() && /no-such-page/.test(page.url())) return;
          errors.push(`${page.url()} console: ${m.text()} ${m.location().url ? `(${m.location().url})` : ''}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(errors);
      expect(errors, 'errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Nothing on the page is wider than the screen (no sideways scrolling on phones). */
export async function expectNoSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, 'page is wider than the screen').toBeLessThanOrEqual(width);
}
