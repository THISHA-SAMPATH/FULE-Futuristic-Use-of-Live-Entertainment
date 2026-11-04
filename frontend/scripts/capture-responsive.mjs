import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.FULE_SCREENSHOT_URL || 'http://localhost:5173/';
const widths = [1440, 1024, 390];
const screenshotDirectory = new URL('../screenshots/', import.meta.url);
await mkdir(screenshotDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__fuleCls = 0;
      if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) if (!entry.hadRecentInput) window.__fuleCls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
      }
    });
    page.on('pageerror', (error) => failures.push(`${width}px: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 500) failures.push(`${width}px: HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForSelector('.hero-section', { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (foreground, background) => {
        const first = luminance(foreground);
        const second = luminance(background);
        return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
      };
      const visible = (element) => {
        for (let current = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const tooSmall = [...document.querySelectorAll('body *')]
        .filter((element) => element.children.length === 0 && element.textContent.trim() && visible(element))
        .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12)
        .map((element) => element.textContent.trim().slice(0, 40));
      const headline = document.querySelector('.carousel-heading h1').getBoundingClientRect();
      const player = document.querySelector('.carousel-feature').getBoundingClientRect();
      const bodyStyle = getComputedStyle(document.body);
      const actionStyle = getComputedStyle(document.querySelector('.header-sos'));
      const focusStyle = getComputedStyle(document.activeElement);
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tooSmall,
        headingPlayerOverlap: headline.right > player.left && headline.bottom > player.top && headline.top < player.bottom,
        focusRing: { style: focusStyle.outlineStyle, width: focusStyle.outlineWidth },
        contrast: {
          bodyText: contrast(bodyStyle.color, bodyStyle.backgroundColor),
          primaryAction: contrast(actionStyle.color, actionStyle.backgroundColor),
        },
        cumulativeLayoutShift: Number(window.__fuleCls.toFixed(3)),
      };
    });
    assert.equal(result.documentWidth, width, `${width}px layout overflowed horizontally`);
    assert.deepEqual(result.tooSmall, [], `${width}px page has text smaller than 12px`);
    assert.equal(result.headingPlayerOverlap, false, `${width}px hero content overlaps`);
    assert.notEqual(result.focusRing.style, 'none', `${width}px keyboard focus ring is missing`);
    assert.ok(Number.parseFloat(result.focusRing.width) >= 3, `${width}px keyboard focus ring is too thin`);
    assert.ok(result.contrast.bodyText >= 4.5, `${width}px body text contrast is below WCAG AA`);
    assert.ok(result.contrast.primaryAction >= 4.5, `${width}px primary action contrast is below WCAG AA`);
    assert.ok(result.cumulativeLayoutShift < 0.1, `${width}px layout shift exceeded CLS 0.1`);
    await page.screenshot({ path: fileURLToPath(new URL(`fule-professional-${width}.png`, screenshotDirectory)) });
    console.log(JSON.stringify(result));
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(failures, [], 'Browser errors occurred during responsive screenshots');
