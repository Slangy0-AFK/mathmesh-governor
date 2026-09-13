import { test, expect } from '@playwright/test';

test.describe('Governor application', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/apps/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'E2E backend unavailable' }),
      });
    });
  });

  test('home entry renders without uncaught page errors', async ({ page }) => {
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const response = await page.goto('/');

    expect(response?.status()).toBeLessThan(500);
    await page.waitForTimeout(1_500);
    expect(errors, `Page errors: ${errors.join('; ')}; Console errors: ${consoleErrors.join('; ')}`).toEqual([]);
    await expect(page.locator('body')).toBeVisible();
  });

  test('the declared root route is not a 404', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/not found|404/i)).toHaveCount(0);
  });
});