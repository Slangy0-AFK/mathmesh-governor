import { test, expect } from '@playwright/test';

test.describe('Authentication boundary', () => {
  test('root entry is reachable', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/not found|404/i)).toHaveCount(0);
  });

  test('invalid credentials are rejected when credentials are configured', async ({ page }) => {
    test.skip(
      !process.env.E2E_AUTH_EMAIL || !process.env.E2E_AUTH_PASSWORD,
      'Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD to run the live authentication check.',
    );

    await page.goto('/');
    const email = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
    const password = page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
    await expect(email).toBeVisible({ timeout: 10_000 });
    await expect(password).toBeVisible();
    await email.fill('not-a-real-user@example.invalid');
    await password.fill('wrong-password-12345');
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
    await expect(page.getByText(/invalid|incorrect|failed|error/i).first()).toBeVisible({ timeout: 10_000 });
  });
});