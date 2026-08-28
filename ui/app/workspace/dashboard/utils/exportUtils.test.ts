import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
	t: (key: string) => key,
}));

const { normalizeDashboardTab } = await import("./exportUtils");

describe("normalizeDashboardTab", () => {
	it("keeps exportable dashboard tabs", () => {
		expect(normalizeDashboardTab("provider-usage")).toBe("provider-usage");
		expect(normalizeDashboardTab("virtual-key-rankings")).toBe("virtual-key-rankings");
	});

	it("falls back to overview for removed or unknown tabs", () => {
		expect(normalizeDashboardTab("user-rankings")).toBe("overview");
		expect(normalizeDashboardTab("bu-rankings")).toBe("overview");
		expect(normalizeDashboardTab("not-a-tab")).toBe("overview");
		expect(normalizeDashboardTab(undefined)).toBe("overview");
	});
});