import { test, expect } from '@playwright/test'

test.describe('app shell', () => {
  test('root redirects to a locale and renders the home page', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/en$/)
    await expect(page.getByTestId('home')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Concept/)
  })

  test('CTA opens the first topic; breadcrumb and sidebar reflect location; reload works', async ({ page }) => {
    await page.goto('/en')
    await page.getByTestId('cta-start').click()
    await expect(page).toHaveURL(/\/en\/crdts\/the-problem\/more-than-one-copy$/)
    await expect(page.getByTestId('topic-title')).toHaveText('More than one copy')
    await expect(page.getByTestId('breadcrumb')).toContainText('CRDTs')
    await expect(page.getByTestId('breadcrumb')).toContainText('More than one copy')
    await expect(page.getByTestId('nav-topic-more-than-one-copy')).toHaveAttribute('data-active', 'true')
    await page.reload()
    await expect(page.getByTestId('topic-title')).toHaveText('More than one copy')
  })

  test('next/prev topic navigation changes the URL', async ({ page }) => {
    await page.goto('/en/crdts/the-problem/more-than-one-copy')
    await page.getByTestId('next-topic').click()
    await expect(page).toHaveURL(/locks-the-classic-answer$/)
    await page.getByTestId('prev-topic').click()
    await expect(page).toHaveURL(/more-than-one-copy$/)
  })

  test('sidebar can be collapsed and the state persists across reloads', async ({ page }) => {
    await page.goto('/en/crdts')
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
    await page.getByTestId('sidebar-trigger').click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await page.reload()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
    await page.getByTestId('sidebar-trigger').click()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
  })

  test('theme switch applies the dark class and persists', async ({ page }) => {
    await page.goto('/en')
    await page.getByTestId('settings-trigger').click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('language switch changes the URL prefix and <html lang/dir>', async ({ page }) => {
    await page.goto('/en/crdts')
    await page.getByTestId('settings-trigger').click()
    await page.getByRole('menuitem', { name: /Language/ }).hover()
    await page.getByRole('menuitemradio', { name: 'العربية' }).click()
    await expect(page).toHaveURL(/\/ar\/crdts$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('unknown locale and unknown topic show not-found', async ({ page }) => {
    await page.goto('/xx')
    await expect(page.getByText(/not found/i)).toBeVisible()
    await page.goto('/en/crdts/nope/nope')
    await expect(page.getByText(/not found/i)).toBeVisible()
  })

  test('module page lists units and topics', async ({ page }) => {
    await page.goto('/en/crdts')
    await expect(page.getByTestId('module-page')).toBeVisible()
    await expect(page.getByTestId('unit-state-based')).toBeVisible()
    await page.getByTestId('topic-link-lww-register').click()
    await expect(page).toHaveURL(/\/en\/crdts\/state-based\/lww-register$/)
  })

  test('design page renders', async ({ page }) => {
    await page.goto('/en/design')
    await expect(page.getByTestId('design-page')).toBeVisible()
  })
})
