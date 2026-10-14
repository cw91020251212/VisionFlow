const { test, expect } = require('@playwright/test');

async function overflow(page, width = 980) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  return page.evaluate(() => ({
    max: document.querySelector('#main-toolbar').scrollWidth - document.querySelector('#main-toolbar').clientWidth,
    barHidden: document.querySelector('#toolbar-scrollbar').hidden,
  }));
}

test('visible scrollbar and toolbar remain synchronized in both directions', async ({ page }) => {
  const state = await overflow(page);
  expect(state.max).toBeGreaterThan(100);
  expect(state.barHidden).toBe(false);
  const bar = page.locator('#toolbar-scrollbar');
  await expect(bar).toHaveAttribute('role', 'scrollbar');
  await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');

  await page.evaluate(() => {
    const toolbar = document.querySelector('#main-toolbar');
    toolbar.scrollLeft = 140;
    toolbar.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => bar.getAttribute('aria-valuenow')).toBe('140');
  const thumb = page.locator('.toolbar-scrollbar-thumb');
  const thumbBox = await thumb.boundingBox();
  expect(thumbBox.width).toBeGreaterThan(35);

  await page.evaluate(() => { document.querySelector('#main-toolbar').scrollLeft = 0; });
  await expect.poll(() => bar.getAttribute('aria-valuenow')).toBe('0');
  const before = await thumb.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 100, before.y + before.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.locator('#main-toolbar').evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
  await bar.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.locator('#main-toolbar').evaluate(el => el.scrollLeft)).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#main-toolbar').evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
});

test('blank toolbar area can be grabbed while controls retain normal clicks', async ({ page }) => {
  await overflow(page);
  const blank = await page.evaluate(() => {
    const toolbar = document.querySelector('#main-toolbar');
    const rect = toolbar.getBoundingClientRect();
    for (let x = rect.left + 2; x < rect.right - 2; x += 2) {
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      if (target && !target.closest('button,a,input,select,textarea,[role="button"],.brand')) {
        return { x, y, cursor: getComputedStyle(target).cursor };
      }
    }
    return null;
  });
  expect(blank).not.toBeNull();
  expect(blank.cursor).toBe('grab');
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x - 100, blank.y, { steps: 8 });
  await expect(page.locator('#main-toolbar')).toHaveClass(/toolbar-dragging/);
  await page.mouse.up();
  await expect(page.locator('#main-toolbar')).not.toHaveClass(/toolbar-dragging/);
  await expect.poll(() => page.locator('#main-toolbar').evaluate(el => el.scrollLeft)).toBeGreaterThan(50);

  await page.evaluate(() => { document.querySelector('#main-toolbar').scrollLeft = 0; });
  await page.locator('#toggle-left').click();
  await expect(page.locator('.workspace')).not.toHaveClass(/left-closed/);
  await expect(page.locator('#main-toolbar')).not.toHaveClass(/toolbar-dragging/);
  expect(await page.locator('#main-toolbar').evaluate(el => el.scrollLeft)).toBe(0);
});

test('wide view hides the scrollbar; mobile and focus layouts keep it below the toolbar', async ({ page }) => {
  const wide = await overflow(page, 2800);
  expect(wide.barHidden).toBe(true);

  await overflow(page, 390);
  const positions = await page.evaluate(() => {
    const toolbar = document.querySelector('#main-toolbar').getBoundingClientRect();
    const bar = document.querySelector('#toolbar-scrollbar').getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    document.querySelector('.app').classList.add('focus-mode');
    const focusRows = getComputedStyle(document.querySelector('.app')).gridTemplateRows.split(' ').length;
    return { overflow: !document.querySelector('#toolbar-scrollbar').hidden, toolbarBottom: toolbar.bottom, barTop: bar.top, barBottom: bar.bottom, workspaceTop: workspace.top, focusRows };
  });
  expect(positions.overflow).toBe(true);
  expect(positions.barTop).toBeGreaterThanOrEqual(positions.toolbarBottom);
  expect(positions.workspaceTop).toBeGreaterThanOrEqual(positions.barBottom);
  expect(positions.focusRows).toBeGreaterThanOrEqual(4);
});
