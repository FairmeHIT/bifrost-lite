import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useI18n } from "@/lib/i18n/context";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import OAuthDiscoverCallbackPage from "./page";

function RouteComponent() {
	const { t } = useI18n();
	const hasUserProvisioningAccess = useRbac(RbacResource.UserProvisioning, RbacOperation.View);
	if (!hasUserProvisioningAccess) {
		return <NoPermissionView entity={t("sidebar.userProvisioning")} />;
	}
	return <OAuthDiscoverCallbackPage />;
}

export const Route = createFileRoute("/workspace/scim/oauth-discover-callback")({
	component: RouteComponent,
});