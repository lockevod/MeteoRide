/* The help pages, as they are read in the two places they are read from.
 *
 * Inside the app the same page must not be the website's help: the recipes for
 * installing the PWA are noise when you are already in the app, and the whole thing
 * is too long to scroll on a phone, so the sections arrive collapsed. On the website
 * nothing changes: every section open, nothing hidden, no disclosure to click.
 */
import { expect, test } from '@playwright/test';

const PAGES = ['/help.html', '/help_en.html'];

/** Capacitor injects its bridge into every page in the web view; help.js only asks it
 *  whether this is a native platform. That one answer is the whole difference. */
const asApp = (page) =>
  page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
  });

for (const path of PAGES) {
  test(`${path}: the bundled page, opened without the app, has every section open and the install recipes there`, async ({ page }) => {
    await page.goto(path);

    await expect(page.locator('html')).not.toHaveClass(/cw-native/);
    // Not one collapsed section: the website reads as one continuous page.
    await expect(page.locator('details.section:not([open])')).toHaveCount(0);
    await expect(page.locator('details.section')).not.toHaveCount(0);

    // How to install the PWA: the website is where that belongs.
    await expect(page.locator('details.web-only')).toBeVisible();
    // And the app-only section is the one thing the website does not show.
    await expect(page.locator('.app-only')).toBeHidden();
  });

  test(`${path}: inside the app the install recipes are gone and the sections start collapsed`, async ({ page }) => {
    await asApp(page);
    await page.goto(path);

    await expect(page.locator('html')).toHaveClass(/cw-native/);
    // Every section closed: the reader gets an index, not an endless scroll.
    await expect(page.locator('details.section[open]')).toHaveCount(0);
    await expect(page.locator('details.section')).not.toHaveCount(0);

    // Installing the PWA from inside the app is meaningless.
    await expect(page.locator('details.web-only')).toBeHidden();
    await expect(page.locator('.app-only')).toBeVisible();
    // innerText, not textContent: what the reader can actually see. The section is
    // still in the page, hidden by CSS, which is the whole mechanism under test.
    await expect(page.locator('body')).not.toContainText(/Add to Home|pantalla de inicio/i, {
      useInnerText: true,
    });
  });

  test(`${path}: a collapsed section opens when tapped`, async ({ page }) => {
    await asApp(page);
    await page.goto(path);

    const first = page.locator('details.section').first();
    await expect(first.locator('summary')).toBeVisible();
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    // The body of the section is now readable, which is what the tap was for.
    await expect(first.locator('p').first()).toBeVisible();
  });

  test(`${path}: the back button reserves the safe area`, async ({ page }) => {
    await page.goto(`${path}?return=true`);
    await expect(page.locator('#backBtn')).toBeVisible();

    // A headless browser reports no inset, and Playwright cannot fake one, so the
    // rule itself is what is asserted: the header pays for the notch, and the button
    // sitting in it is offset by the same inset. A rule that lost its env() fails here.
    const rules = await page.evaluate(() =>
      [...document.styleSheets]
        .flatMap((s) => [...s.cssRules])
        .map((r) => r.cssText)
        .filter((t) => t.includes('safe-area-inset-top'))
    );
    expect(rules.some((t) => t.startsWith('.header'))).toBe(true);
    expect(rules.some((t) => t.startsWith('.back-button'))).toBe(true);

    // And the calc() around it is valid CSS rather than a declaration the engine drops:
    // with a zero inset the header keeps exactly the padding it always had.
    const pad = await page
      .locator('.header')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(pad).toBeGreaterThanOrEqual(16);

    // The button stays inside the header, which is where it is meant to be.
    const inHeader = await page.locator('#backBtn').evaluate((el) => !!el.closest('.header'));
    expect(inHeader).toBe(true);
  });
}
