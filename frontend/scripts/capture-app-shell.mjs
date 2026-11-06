import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.FULE_SCREENSHOT_URL || 'http://localhost:5173/';
const routes = ['home', 'walk', 'circle', 'community', 'privacy', 'evidence', 'activity'];
const widths = [1440, 1024, 390];
const directory = new URL('../screenshots/app-shell/', import.meta.url);
await mkdir(directory, { recursive: true });
const chromePath = process.env.FULE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: widths[0], height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', (error) => failures.push(`runtime: ${error.message}`));
    await page.route('**/api/sos', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      incident: { incident_id: 'visual-demo-incident', threat_level: 'ELEVATED', module: 'FULE_PROTECT', module_type: 'FULE_PROTECT', location: { lat: 12.97, lng: 77.59, address: 'Near North Loop transit stop' }, summary: 'A check-in request needs a nearby guardian response.', recommended_action: 'CHECK_IN', status: 'PENDING_DISPATCH', created_at: new Date().toISOString(), acknowledged_by: null, source: 'button', streamer_id: 'demo-streamer' },
      streamer: { id: 'demo-streamer', display_name: 'Demo Streamer' }, streamer_cancel_token: 'visual-demo-token', nearby_accepted_count: 0
    }) }));
    await page.goto(`${baseUrl}#/activity`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.route-view');
    await page.evaluate(() => document.fonts.ready);
    const captureState = async (width, state) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
      await page.evaluate((name) => { window.location.hash = `#/${name}`; }, route);
      const title = route === 'home' ? 'Right now' : route === 'walk' ? 'Safe Walk' : route === 'circle' ? 'My Circle' : route === 'community' ? 'Community' : route === 'privacy' ? 'Privacy' : route === 'evidence' ? 'Evidence' : 'Activity';
      await page.waitForSelector(`[aria-label="${title} view"]`);
      await page.waitForFunction((expected) => document.title === `${expected} · FULE`, title);
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, view: document.querySelector('.route-view')?.getBoundingClientRect().width, hasText: Boolean(document.querySelector('.route-view')?.innerText.trim()), title: document.title, activePage: Boolean(document.querySelector('.rail-link[aria-current="page"]')), focusedHeading: Boolean(document.activeElement?.matches('[data-route-heading]')), drawerFocused: Boolean(document.activeElement?.matches('.drawer-close')) }));
      assert.equal(layout.width, width, `${width}px ${route} view has horizontal overflow`);
      assert.ok(layout.hasText, `${width}px ${route} view is empty`);
      assert.equal(layout.title, `${title} · FULE`, `${width}px ${route} document title did not update`);
      assert.ok(layout.activePage, `${width}px ${route} navigation state is not marked current`);
      assert.ok(layout.focusedHeading, `${width}px ${route} focus target is incorrect (active element: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100))})`);
      await page.screenshot({ path: fileURLToPath(new URL(`${width}-${route}-${state}.png`, directory)) });
      }
    };
    for (const width of widths) await captureState(width, 'calm');
    await page.evaluate(() => { window.location.hash = '#/walk'; });
    await page.waitForSelector('.persistent-walk-panel:not([hidden]) .safe-walk-panel');
    await page.evaluate(() => { window.__safeWalkPanel = document.querySelector('.persistent-walk-panel .safe-walk-panel'); window.location.hash = '#/community'; });
    await page.waitForSelector('.route-view[aria-label="Community view"]');
    const safeWalkStayedMounted = await page.evaluate(() => window.__safeWalkPanel === document.querySelector('.persistent-walk-panel .safe-walk-panel') && document.querySelector('.persistent-walk-panel[hidden]'));
    assert.ok(safeWalkStayedMounted, 'Safe Walk timer view unmounted after navigating away');
    await page.evaluate(() => { window.location.hash = '#/home'; });
    await page.keyboard.down('s');
    await page.waitForTimeout(1100);
    await page.keyboard.up('s');
    await page.waitForTimeout(1200);
    const alertActive = await page.locator('.fule-shell').getAttribute('data-theme');
    assert.equal(alertActive, 'alert', 'Visual SOS did not activate the alert theme');
    await page.locator('.drawer-close').click();
    for (const width of widths) await captureState(width, 'alert');
    console.log(JSON.stringify({ alertActive, widths, screenshots: widths.length * routes.length * 2 }));
    await page.close();
} finally {
  await browser.close();
}
assert.deepEqual(failures, [], 'Browser runtime errors occurred');
