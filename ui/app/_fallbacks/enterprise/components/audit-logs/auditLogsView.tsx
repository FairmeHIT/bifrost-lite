import { useI18n } from "@/lib/i18n/context";
import { ScrollText } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function AuditLogsView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<ScrollText className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.auditLogsTitle")}
				description={t("enterprise.auditLogsDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/audit-logs"
			/>
		</div>
	);
}