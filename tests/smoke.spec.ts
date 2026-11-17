import { test, expect } from '@playwright/test';

test.describe('Vescio Nexus Critical Flows', () => {
  test('App loads without crashing', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Vescio/i);
    const rootContainer = page.locator('#root');
    await expect(rootContainer).toBeVisible();
  });
});
