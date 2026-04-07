import { test, expect } from '@playwright/test';

test.describe('Debug UI Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/debug-ui/index.html');
  });

  test('UI fits in viewport by height', async ({ page }) => {
    // Get the container element
    const container = page.locator('.container');
    await expect(container).toBeVisible();

    // Check that container does not exceed viewport height
    const containerBox = await container.boundingBox();
    const viewportSize = page.viewportSize();

    expect(containerBox).not.toBeNull();
    expect(viewportSize).not.toBeNull();
    if (containerBox && viewportSize) {
      // Container should fit within viewport (allowing small overflow for scrollbar)
      expect(containerBox.height).toBeLessThanOrEqual(viewportSize.height + 10);
    }

    // Verify no vertical scrollbar on body (page should fit in viewport)
    const hasVerticalScroll = await page.evaluate(() => {
      return document.documentElement.scrollHeight > document.documentElement.clientHeight;
    });
    expect(hasVerticalScroll).toBe(false);

    // Take screenshot for visual verification
    await expect(page).toHaveScreenshot('debug-ui-full-page.png', {
      fullPage: false,
    });
  });

  test('message list (events container) scrolls inside container', async ({ page }) => {
    // Get the events container
    const eventsContainer = page.locator('#events-container');
    await expect(eventsContainer).toBeVisible();

    // Check that events container has overflow-y: auto
    const overflowY = await eventsContainer.evaluate((el) => {
      return window.getComputedStyle(el).overflowY;
    });
    expect(overflowY).toBe('auto');

    // Verify that events-container has a bounded height (flex: 1 within event-feed)
    const eventFeed = page.locator('.event-feed');
    const eventFeedBox = await eventFeed.boundingBox();
    const eventsContainerBox = await eventsContainer.boundingBox();

    expect(eventFeedBox).not.toBeNull();
    expect(eventsContainerBox).not.toBeNull();
    if (eventFeedBox && eventsContainerBox) {
      // Events container should be contained within event feed
      expect(eventsContainerBox.height).toBeLessThanOrEqual(eventFeedBox.height);
    }

    // Take screenshot of the events area
    await expect(eventsContainer).toHaveScreenshot('events-container.png');
  });

  test('control buttons (START/PAUSE/STEP) are always visible at bottom', async ({ page }) => {
    // Get the control panel (footer)
    const controlPanel = page.locator('.control-panel');
    await expect(controlPanel).toBeVisible();

    // Check all control buttons are visible
    const startBtn = page.locator('#start-btn');
    const pauseBtn = page.locator('#pause-btn');
    const stepBtn = page.locator('#step-btn');

    await expect(startBtn).toBeVisible();
    await expect(pauseBtn).toBeVisible();
    await expect(stepBtn).toBeVisible();

    // Verify control panel is at the bottom of the viewport
    const controlPanelBox = await controlPanel.boundingBox();
    const viewportSize = page.viewportSize();

    expect(controlPanelBox).not.toBeNull();
    expect(viewportSize).not.toBeNull();
    if (controlPanelBox && viewportSize) {
      // Control panel bottom should be at or near viewport bottom
      const panelBottom = controlPanelBox.y + controlPanelBox.height;
      expect(panelBottom).toBeLessThanOrEqual(viewportSize.height + 5);
    }

    // Take screenshot of control panel
    await expect(controlPanel).toHaveScreenshot('control-panel.png');
  });

  test('control panel stays visible when content overflows', async ({ page }) => {
    // Inject many messages to simulate overflow
    await page.evaluate(() => {
      const container = document.getElementById('events-container');
      if (container) {
        container.innerHTML = '';
        for (let i = 0; i < 50; i++) {
          const div = document.createElement('div');
          div.className = 'event-item channel-public';
          div.innerHTML = `<div class="event-header"><span class="event-sender">Test</span></div><div class="event-content">Message ${i}</div>`;
          container.appendChild(div);
        }
      }
    });

    // Control panel should still be visible
    const controlPanel = page.locator('.control-panel');
    await expect(controlPanel).toBeVisible();

    // Verify buttons are still visible
    const startBtn = page.locator('#start-btn');
    await expect(startBtn).toBeVisible();

    // Verify control panel is still at the bottom
    const controlPanelBox = await controlPanel.boundingBox();
    const viewportSize = page.viewportSize();

    expect(controlPanelBox).not.toBeNull();
    expect(viewportSize).not.toBeNull();
    if (controlPanelBox && viewportSize) {
      const panelBottom = controlPanelBox.y + controlPanelBox.height;
      expect(panelBottom).toBeLessThanOrEqual(viewportSize.height + 5);
    }

    // Verify page doesn't have vertical scrollbar (content scrolls inside container)
    const hasVerticalScroll = await page.evaluate(() => {
      return document.documentElement.scrollHeight > document.documentElement.clientHeight;
    });
    expect(hasVerticalScroll).toBe(false);

    // Take screenshot with many messages
    await expect(page).toHaveScreenshot('debug-ui-with-messages.png', {
      fullPage: false,
    });
  });
});
