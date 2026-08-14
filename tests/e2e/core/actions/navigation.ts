import { Page } from '@playwright/test'
import { waitForNetworkIdle } from '../utils/test-helpers'

/**
 * Navigation helper functions
 */

/**
 * Navigate to the workspace root
 */
export async function goToWorkspace(page: Page): Promise<void> {
  await page.goto('/workspace')
  await waitForNetworkIdle(page)
}

/**
 * Navigate to Providers page
 */
export async function goToProviders(page: Page): Promise<void> {
  await page.goto('/workspace/providers')
  await waitForNetworkIdle(page)
}

/**
 * Navigate to Logs page
 */
export async function goToLogs(page: Page): Promise<void> {
  await page.goto('/workspace/logs')
  await waitForNetworkIdle(page)
}

/**
 * Navigate to Config page
 */
export async function goToConfig(page: Page): Promise<void> {
  await page.goto('/workspace/config')
  await waitForNetworkIdle(page)
}

/**
 * Navigate to a specific provider
 */
export async function goToProvider(page: Page, providerName: string): Promise<void> {
  await page.goto(`/workspace/providers?provider=${encodeURIComponent(providerName)}`)
  await waitForNetworkIdle(page)
}
