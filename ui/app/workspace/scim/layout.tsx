import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useI18n } from "@/lib/i18n/context";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import SCIMPage from "./page";

function RouteComponent() {
	const { t } = useI18n();
	const hasUserProvisioningAccess = useRbac(RbacResource.UserProvisioning, RbacOperation.View);
	const childMatches = useChildMatches();
	if (!hasUserProvisioningAccess) {
		return <NoPermissionView entity={t("sidebar.userProvisioning")} />;
	}
	return childMatches.length === 0 ? <SCIMPage /> : <Outlet />;
}

export const Route = createFileRoute("/workspace/scim")({
	component: RouteComponent,
});