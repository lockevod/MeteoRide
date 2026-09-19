/* The way in for someone who has no GPX.
 *
 * Every first-time user arrives without a route file, and so does every App Store
 * reviewer: their test device has never held a .gpx. Before this button the whole app sat
 * behind a file picker that opened on an empty folder, and nothing below the map could be
 * reached at all — which is also the exact shape of a Guideline 2.1 "we were unable to
 * review your app" rejection.
 *
 * So this is not a nicety. It is the only path into the app that works on a clean install,
 * and it has to keep working.
 */
import { test, expect } from '@playwright/test';

/** A forecast for any coordinate, so the test turns on the route rather than the weather. */
const hourly = {
  time: Array.from({ length: 48 }, (_, i) => `2026-09-20T${String(i % 24).padStart(2, '0')}:00`),
  temperature_2m: Array(48).fill(18),
  precipitation: Array(48).fill(0),
  wind_speed_10m: Array(48).fill(9),
  wind_direction_10m: Array(48).fill(180),
  wind_gusts_10m: Array(48).fill(14),
  weather_code: Array(48).fill(1),
  relative_humidity_2m: Array(48).fill(60),
  precipitation_probability: Array(48).fill(5),
};

async function stubForecast(page) {
  await page.route('**/api.open-meteo.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly }) }));
}

test('the example route is reachable, loads, and produces a forecast', async ({ page }) => {
  await stubForecast(page);
  await page.goto('/');

  const button = page.locator('#exampleRoute');
  await expect(button, 'nothing offers a route to someone who has none').toBeVisible();

  await button.click();
  await expect(
    page.locator('#weatherTable td').first(),
    'the bundled route did not reach the table: a reviewer would see an empty app'
  ).toBeVisible({ timeout: 25000 });

  // Once there is a forecast on screen the way in has done its job and gets out of the way.
  await expect(button).toBeHidden();
});

test('the bundled route file is in the shipped app and is a real track', async ({ request }) => {
  // It is fetched at runtime from the bundle, so a build that drops it breaks the button
  // silently — the failure would only show as a notice on a device nobody is watching.
  const res = await request.get('/assets/example-route.gpx');
  expect(res.status()).toBe(200);
  const gpx = await res.text();
  const points = [...gpx.matchAll(/<trkpt\s/g)].length;
  expect(points, 'too few points to be a usable ride').toBeGreaterThan(50);
  expect(gpx).toContain('<trkseg>');
});
