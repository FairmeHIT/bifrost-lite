import { expect, test } from '../../core/fixtures/base.fixture'

test.describe('Placeholder and Enterprise Pages', () => {
  test('should load custom-pricing page', async ({ page }) => {
    await page.goto('/workspace/custom-pricing')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/workspace\/custom-pricing(?:\?.*)?$/)
  })
})
