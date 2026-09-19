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

test('the example is a real ride around Mont-roig', async ({ request }) => {
  // The first example was drawn with straight legs every ~240 m and crossed the sea, the
  // port and the airport: the first thing a reviewer sees. This one is a loop the developer
  // rode, which leaves a vertex every few tens of metres; a hand-drawn line does not, so the
  // median leg tells the two apart.
  const gpx = await (await request.get('/assets/example-route.gpx')).text();
  const pts = [...gpx.matchAll(/lat="([\d.-]+)" lon="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const legs = pts.slice(1).map(([la, lo], i) => {
    const [pa, po] = pts[i];
    const x = (lo - po) * Math.PI / 180 * Math.cos((la + pa) * Math.PI / 360);
    return 6371000 * Math.hypot(x, (la - pa) * Math.PI / 180);
  }).sort((a, b) => a - b);
  expect(legs[legs.length >> 1], 'legs this long are a line drawn by hand, not a road').toBeLessThan(80);
  for (const [la, lo] of pts) {
    expect(la >= 41.02 && la <= 41.16 && lo >= 0.91 && lo <= 0.99, `${la},${lo} is outside the Mont-roig loop`).toBe(true);
  }
  // A loop: it ends where it starts, give or take the last few metres.
  const [[a0, o0], [a1, o1]] = [pts[0], pts[pts.length - 1]];
  expect(Math.hypot(a1 - a0, (o1 - o0) * Math.cos(a0 * Math.PI / 180)) * 111195).toBeLessThan(100);
});

test('the example is named in the language chosen', async ({ page }) => {
  await stubForecast(page);
  await page.addInitScript(() => localStorage.setItem('cwSettings', JSON.stringify({ language: 'es' })));
  await page.goto('/');
  await page.locator('#exampleRoute').click();
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.route.name ?? null))
    .toBe('Ruta de ejemplo - Mont-roig a Castillo');
});

test('the button ships hidden, so it is never drawn over a route still being restored', async ({ request }) => {
  // Shown only once the app knows there is nothing to replace (ui.js offerExample). Drawn
  // by default, it sat over the map for as long as the recent routes took to read, and a
  // tap in that window replaced the route being restored with the example.
  const html = await (await request.get('/index.html')).text();
  const tag = html.match(/<button[^>]*id="exampleRoute"[^>]*>/);
  expect(tag, 'the example-route button is gone from the page').not.toBeNull();
  expect(tag[0]).toMatch(/\shidden[\s>]/);
});
