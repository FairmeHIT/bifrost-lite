import { NoPermissionView } from "@/components/noPermissionView";
import { useI18n } from "@/lib/i18n/context";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { createFileRoute } from "@tanstack/react-router";
import VirtualKeysRedirectPage from "./page";

function RouteComponent() {
	const { t } = useI18n();
	const hasVirtualKeysAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.View);
	if (!hasVirtualKeysAccess) {
		return <NoPermissionView entity={t("sidebar.virtualKeys")} />;
	}
	return <VirtualKeysRedirectPage />;
}

export const Route = createFileRoute("/workspace/virtual-keys")({
	component: RouteComponent,
});