import { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Sidebar navigation page object
 */
export class SidebarPage extends BasePage {
  // Navigation links
  readonly providersLink: Locator
  readonly logsLink: Locator
  readonly configLink: Locator

  constructor(page: Page) {
    super(page)
    this.providersLink = page.getByRole('link', { name: /providers/i })
    this.logsLink = page.getByRole('link', { name: /logs/i })
    this.configLink = page.getByRole('link', { name: /config/i })
  }

  /**
   * Navigate to Providers page
   */
  async goToProviders(): Promise<void> {
    await this.providersLink.click()
    await this.waitForPageLoad()
  }

  /**
   * Navigate to Logs page
   */
  async goToLogs(): Promise<void> {
    await this.logsLink.click()
    await this.waitForPageLoad()
  }

  /**
   * Navigate to Config page
   */
  async goToConfig(): Promise<void> {
    await this.configLink.click()
    await this.waitForPageLoad()
  }
}
