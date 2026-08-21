import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useI18n } from "@/lib/i18n/context";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import AuditLogsPage from "./page";

function RouteComponent() {
	const { t } = useI18n();
	const hasAuditLogsAccess = useRbac(RbacResource.AuditLogs, RbacOperation.View);
	if (!hasAuditLogsAccess) {
		return <NoPermissionView entity={t("sidebar.auditLogs")} />;
	}
	return <AuditLogsPage />;
}

export const Route = createFileRoute("/workspace/audit-logs")({
	component: RouteComponent,
});