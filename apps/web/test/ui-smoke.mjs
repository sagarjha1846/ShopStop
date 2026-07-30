// Browser smoke test for the web↔API integration. Drives a real Chromium through
// register → cookie session recovery → authed listing create → SSR detail → theme.
//
// Run with the API on :4000 and web on :3000, then:
//   npm i -D playwright-core   (or use a preinstalled browser)
//   PW_CHROMIUM=/path/to/chrome node apps/web/test/ui-smoke.mjs
// If PW_CHROMIUM is unset, playwright-core's bundled browser is used.
import { chromium } from 'playwright-core';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:3000';
const EXEC = process.env.PW_CHROMIUM || undefined;
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  ok('home shows brand', (await page.content()).includes('ShopStop'));

  await page.goto(`${BASE}/register`);
  await page.fill('input[placeholder="Email"]', `uiuser_${RUN}@example.com`);
  await page.fill('input[placeholder^="Password"]', 'uitestpassword1');
  await page.fill('input[placeholder="Display name (optional)"]', 'UI Tester');
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type=submit]')]);
  ok('register redirects home (cookie set)', page.url() === `${BASE}/`);

  // Fresh navigation must recover the session from the httpOnly cookie via refresh().
  await page.goto(`${BASE}/sell`, { waitUntil: 'networkidle' });
  await page.waitForSelector('select', { timeout: 5000 });
  ok('sell page authed via cookie refresh', await page.isVisible('text=Create a listing'));

  const value = await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('select option')).find((o) =>
      o.textContent?.includes('Mobile Phones'),
    );
    return opt?.value ?? '';
  });
  await page.selectOption('select', value);
  await page.fill('input[placeholder="Title"]', `UI Test Phone ${RUN}`);
  await page.fill('textarea', 'Created by the browser smoke test, in great condition.');
  await page.fill('input[placeholder="Price (₹)"]', '12345');
  const brand = page.locator('label:has-text("Brand") input');
  if (await brand.count()) await brand.fill('TestBrand');
  const model = page.locator('label:has-text("Model") input');
  if (await model.count()) await model.fill('TestModel');
  await Promise.all([page.waitForURL(/\/l\/.+/, { timeout: 10000 }), page.click('button[type=submit]')]);
  ok('authed listing create → detail page', /\/l\//.test(page.url()), page.url());

  const body = await page.content();
  ok('detail shows listing title', body.includes(`UI Test Phone ${RUN}`));
  ok('detail shows buy CTA', body.includes('Make an offer'));

  await page.goto(`${BASE}/`);
  await page.click('[data-testid="theme-toggle"]');
  const theme = await page.getAttribute('html', 'data-theme');
  ok('theme toggle works', theme === 'dark' || theme === 'light', `theme=${theme}`);
} catch (e) {
  ok(`unexpected error: ${e.message}`, false);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
