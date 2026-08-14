import { test as base, expect } from "@playwright/test";
import { SidebarPage } from "../pages/sidebar.page";
import { ProvidersPage } from "../../features/providers/pages/providers.page";
import { DashboardPage } from "../../features/dashboard/pages/dashboard.page";
import { LogsPage } from "../../features/logs/pages/logs.page";
import { RoutingRulesPage } from "../../features/routing-rules/pages/routing-rules.page";
import { ObservabilityPage } from "../../features/observability/pages/observability.page";
import { ConfigSettingsPage } from "../../features/config/pages/config-settings.page";
import { ModelLimitsPage } from "../../features/model-limits/pages/model-limits.page";

/**
 * Custom test fixtures type
 */
type BifrostFixtures = {
	closeDevProfiler: void;
	sidebarPage: SidebarPage;
	providersPage: ProvidersPage;
	dashboardPage: DashboardPage;
	logsPage: LogsPage;
	routingRulesPage: RoutingRulesPage;
	observabilityPage: ObservabilityPage;
	configSettingsPage: ConfigSettingsPage;
	modelLimitsPage: ModelLimitsPage;
};

/**
 * Extended test with Bifrost-specific fixtures
 */
export const test = base.extend<BifrostFixtures>({
	closeDevProfiler: [
		async ({ page }, use) => {
			// Keep the development profiler from stealing focus or blocking assertions when
			// tests reuse a manually started dev server that was not launched with
			// BIFROST_DISABLE_PROFILER=1.
			await page.addInitScript(() => {
				window.localStorage.setItem("devProfiler.isVisible", "false");
				window.localStorage.setItem("devProfiler.isExpanded", "false");
			});

			await page.addLocatorHandler(
				page.getByText("Dev Profiler", { exact: true }),
				async () => {
					await page.evaluate(() => {
						window.localStorage.setItem("devProfiler.isVisible", "false");
						window.localStorage.setItem("devProfiler.isExpanded", "false");
					});
					await page
						.locator('button[title="Dismiss"]')
						.click({ force: true, timeout: 1000 })
						.catch(() => {});
				},
				{ noWaitAfter: true },
			);
			await use();
		},
		{ auto: true },
	],

	sidebarPage: async ({ page }, use) => {
		await use(new SidebarPage(page));
	},

	providersPage: async ({ page }, use) => {
		await use(new ProvidersPage(page));
	},

	dashboardPage: async ({ page }, use) => {
		await use(new DashboardPage(page));
	},

	logsPage: async ({ page }, use) => {
		await use(new LogsPage(page));
	},

	routingRulesPage: async ({ page }, use) => {
		await use(new RoutingRulesPage(page));
	},

	observabilityPage: async ({ page }, use) => {
		await use(new ObservabilityPage(page));
	},

	configSettingsPage: async ({ page }, use) => {
		await use(new ConfigSettingsPage(page));
	},

	modelLimitsPage: async ({ page }, use) => {
		await use(new ModelLimitsPage(page));
	},
});

export { expect };
