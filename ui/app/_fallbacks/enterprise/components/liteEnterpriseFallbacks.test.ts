import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { zh } from "@/lib/i18n/zh";

const fromUiRoot = (path: string) => resolve(process.cwd(), path);
const hasPath = (dict: Record<string, unknown>, path: string) => {
	let node: unknown = dict;
	for (const part of path.split(".")) {
		if (!node || typeof node !== "object" || !(part in node)) return false;
		node = (node as Record<string, unknown>)[part];
	}
	return true;
};

describe("Lite enterprise fallbacks", () => {
	it("does not keep route-only enterprise upsell views", () => {
		const removedViews = [
			"app/_fallbacks/enterprise/components/rbac/rbacView.tsx",
			"app/_fallbacks/enterprise/components/user-groups/usersView.tsx",
			"app/_fallbacks/enterprise/components/user-groups/businessUnitsView.tsx",
			"app/_fallbacks/enterprise/components/scim/scimView.tsx",
			"app/_fallbacks/enterprise/components/scim/wizard/discoverCallbackView.tsx",
			"app/_fallbacks/enterprise/components/audit-logs/auditLogsView.tsx",
			"app/_fallbacks/enterprise/components/access-profiles/accessProfilesIndexView.tsx",
		];

		for (const view of removedViews) {
			expect(existsSync(fromUiRoot(view)), view).toBe(false);
		}
	});

	it("keeps fallback components used by Lite features", () => {
		const requiredFallbacks = [
			"app/_fallbacks/enterprise/components/api-keys/apiKeysIndexView.tsx",
			"app/_fallbacks/enterprise/components/user-groups/teamsView.tsx",
			"app/_fallbacks/enterprise/components/user-groups/viewUserDetailsButton.tsx",
			"app/_fallbacks/enterprise/components/user-groups/sheets/customerDetailSheet.tsx",
			"app/_fallbacks/enterprise/components/access-profiles/managedVirtualKeyActions.tsx",
			"app/_fallbacks/enterprise/components/access-profiles/managedVirtualKeyNotice.tsx",
		];

		for (const fallback of requiredFallbacks) {
			expect(existsSync(fromUiRoot(fallback)), fallback).toBe(true);
		}
	});

	it("drops copy for removed enterprise-only Lite pages", () => {
		const removedCopyPaths = [
			"sidebar.users",
			"sidebar.descUsers",
			"sidebar.businessUnits",
			"sidebar.descBusinessUnits",
			"sidebar.userProvisioning",
			"sidebar.descUserProvisioning",
			"sidebar.rolesAndPermissions",
			"sidebar.descRolesAndPermissions",
			"sidebar.accessProfiles",
			"sidebar.descAccessProfiles",
			"sidebar.auditLogs",
			"sidebar.descAuditLogs",
			"enterprise.accessProfilesDesc",
			"enterprise.accessProfilesTitle",
			"enterprise.auditLogsDesc",
			"enterprise.auditLogsTitle",
			"enterprise.businessUnitsDesc",
			"enterprise.businessUnitsTitle",
			"enterprise.rbacDesc",
			"enterprise.rbacTitle",
			"enterprise.scimDesc",
			"enterprise.scimTitle",
			"enterprise.scopeApiKeysDesc",
			"enterprise.scopeApiKeysTitle",
			"enterprise.usersDesc",
			"enterprise.usersTitle",
		];

		for (const path of removedCopyPaths) {
			expect(hasPath(en, path), `en.${path}`).toBe(false);
			expect(hasPath(zh, path), `zh.${path}`).toBe(false);
		}

		expect(hasPath(en, "sidebar.apiKeys")).toBe(true);
		expect(hasPath(zh, "sidebar.apiKeys")).toBe(true);
		expect(hasPath(en, "enterprise.apiKeysAuthEnabled")).toBe(true);
		expect(hasPath(zh, "enterprise.apiKeysAuthEnabled")).toBe(true);
	});
});
