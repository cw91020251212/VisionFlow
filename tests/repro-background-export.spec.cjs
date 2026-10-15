const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fixture = path.join(__dirname, 'fixtures/regression.html');
test('reproduce uploaded button background survives exported HTML', async ({ page }) => {
  await page.goto('/');
  await page.click('#toggle-left');
  await page.setInputFiles('#file-input', fixture);
  await page.waitForFunction(() => isIframeLoaded && importedFrame?.contentDocument.querySelector('#save-button'));
  await page.click('#toggle-viewport');
  await page.evaluate(() => selectImported(importedFrame.contentDocument.querySelector('#save-button')));
  await page.click('#toggle-right');
  await page.setInputFiles('#bg-image-file', path.join(__dirname, '..', 'icon-192.png'));
  await expect(page.locator('#bg-result')).toContainText('背景大小');
  const before = await page.evaluate(() => ({
    record: recordFor(importedSelected).styles['background-image'],
    computed: getComputedStyle(importedSelected).backgroundImage,
  }));
  const html = await page.evaluate(() => buildAppearanceHtml());
  expect(html).toContain('data:image/');
  const preview = await page.context().newPage();
  await preview.setContent(html);
  const after = await preview.locator('#save-button').evaluate(el => ({ image: getComputedStyle(el).backgroundImage, width: el.getBoundingClientRect().width }));
  expect(before.record).toContain('data:image/');
  expect(after.image).toContain('data:image/');
});
