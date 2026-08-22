import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useGetCoreConfigQuery } from "@/lib/store";
import { useGetModelConfigsQuery, useGetVirtualKeysQuery } from "@/lib/store/apis/governanceApi";
import { useGetSCIMProvidersQuery } from "@enterprise/lib/store/apis/scimApi";
import { useGetAllKeysQuery } from "@/lib/store/apis/providersApi";
import { useMemo } from "react";
import { t } from "@/lib/i18n";

export const METADATA_DISMISSED_KEY = "onboarding_dismissed";
export const METADATA_SKIPPED_KEY = "onboarding_skipped";
// "Remind me later" snoozes the widget by setting this cookie's expiry to the
// chosen date — once the browser drops the cookie, the widget is due again.
export const REMIND_LATER_COOKIE = "bifrost_onboarding_remind_at";
// Closing via X is a session-scoped hide, not a long-lived dismissal — no
// expiry, explicitly cleared on route change. Both cookies are shared
// constants (not just widget-local) so the sidebar's "resume setup" promo
// card can read the same hidden/snoozed state the floating widget uses.
export const HIDDEN_UNTIL_NAV_COOKIE = "bifrost_onboarding_hidden_until_nav";

export type OnboardingSection = string;

export interface OnboardingStep {
	id: string;
	title: string;
	route: string;
	complete: boolean;
	section: OnboardingSection;
}

export const parseSkippedIds = (raw: unknown) => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);

const authValueSet = (secretVar: { value?: string; ref?: string; type?: string } | undefined) => {
	if (!secretVar) return false;
	return !!secretVar.value || !!secretVar.ref;
};

// Shared onboarding checklist state — both the floating OnboardingWidget and
// the sidebar's "resume setup" promo card read this, so they can't silently
// disagree on what counts as done. RTK Query dedupes the underlying
// core-config/keys/governance calls across both consumers automatically.
export function useOnboardingChecklist({ skip = false }: { skip?: boolean } = {}) {
	const { data: bifrostConfig } = useGetCoreConfigQuery({}, { skip });
	const isDismissedForAll = bifrostConfig?.metadata?.[METADATA_DISMISSED_KEY] === true;
	const shouldSkipChecklistQueries = skip || isDismissedForAll;

	const { data: allKeys } = useGetAllKeysQuery(undefined, { skip: shouldSkipChecklistQueries });
	const { data: modelConfigsResponse } = useGetModelConfigsQuery(undefined, {
		skip: shouldSkipChecklistQueries || !IS_ENTERPRISE,
	});
	const { data: vksResponse } = useGetVirtualKeysQuery(undefined, {
		skip: shouldSkipChecklistQueries || !IS_ENTERPRISE,
	});
	const { data: scimProviders } = useGetSCIMProvidersQuery(undefined, {
		skip: shouldSkipChecklistQueries || !IS_ENTERPRISE,
	});

	const checklistReady =
		bifrostConfig !== undefined &&
		allKeys !== undefined &&
		(!IS_ENTERPRISE || (vksResponse !== undefined && modelConfigsResponse !== undefined && scimProviders !== undefined));

	const skippedIds = useMemo<string[]>(() => {
		return parseSkippedIds(bifrostConfig?.metadata?.[METADATA_SKIPPED_KEY]);
	}, [bifrostConfig?.metadata]);

	const authConfig = bifrostConfig?.auth_config;
	const clientConfig = bifrostConfig?.client_config;

	const steps: OnboardingStep[] = useMemo(() => {
		// Order: 1) Security, 2) Provider Setup, 3) Everything Else.
		// Security comes first so admins lock down access before exposing keys.
		const allowedOrigins = clientConfig?.allowed_origins ?? [];
		const common: OnboardingStep[] = [
			{
				id: "cors",
				title: t("onboarding.restrictCors"),
				route: "/workspace/config/security",
				section: "Security",
				complete:
					allowedOrigins.some((origin) => origin.trim().length > 0) && allowedOrigins.every((origin) => origin.trim() !== "*"),
			},
			{
				id: "dashboard-auth",
				title: t("onboarding.setupDashboardAuth"),
				route: "/workspace/config/security",
				section: "Security",
				complete: !!authConfig?.is_enabled && authValueSet(authConfig?.admin_username) && authValueSet(authConfig?.admin_password),
			},
			{
				id: "enforce-inference-auth",
				title: t("onboarding.enforceAuthInference"),
				route: "/workspace/config/security",
				section: "Security",
				complete: !!clientConfig?.enforce_auth_on_inference,
			},
			{
				id: "provider-key",
				title: t("onboarding.addProviderKey"),
				route: "/workspace/providers",
				section: t("onboarding.providerSetup"),
				complete: (allKeys?.length ?? 0) > 0,
			},
		];
		const enterprise: OnboardingStep[] = IS_ENTERPRISE
			? [
					{
						id: "scim",
						title: t("onboarding.configureScim"),
						route: "/workspace/scim",
						section: t("onboarding.everythingElse"),
						complete: (scimProviders?.length ?? 0) > 0,
					},
					{
						id: "models",
						title: t("onboarding.configureGovernanceCatalog"),
						route: "/workspace/model-catalog",
						section: t("onboarding.everythingElse"),
						complete: (modelConfigsResponse?.total_count ?? 0) > 0,
					},
					{
						id: "virtual-keys",
						title: "Set up virtual keys / access profiles",
						route: "/workspace/virtual-keys",
						section: t("onboarding.everythingElse"),
						complete: (vksResponse?.total_count ?? 0) > 0,
					},
				]
			: [];
		return [...common, ...enterprise];
	}, [allKeys, clientConfig, authConfig, scimProviders, modelConfigsResponse, vksResponse]);

	return { bifrostConfig, steps, skippedIds, checklistReady, isDismissedForAll };
}
