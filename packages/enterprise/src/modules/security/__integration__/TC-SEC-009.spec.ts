import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-SEC-009: Legacy profile route redirects to security profile with accessibility section', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('redirects legacy change-password route and renders injected accessibility section', async ({ page }) => {
    await page.goto('/backend/profile/change-password', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/backend\/profile\/security$/)
    await expect(page.getByRole('heading', { name: 'Accessibility' })).toBeVisible()
  })
})
