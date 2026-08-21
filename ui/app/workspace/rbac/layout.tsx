import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useI18n } from "@/lib/i18n/context";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import RBACRedirectPage from "./page";

function RouteComponent() {
	const { t } = useI18n();
	const hasRbacAccess = useRbac(RbacResource.RBAC, RbacOperation.View);
	if (!hasRbacAccess) {
		return <NoPermissionView entity={t("sidebar.rolesAndPermissions")} />;
	}
	return <RBACRedirectPage />;
}

export const Route = createFileRoute("/workspace/rbac")({
	component: RouteComponent,
});