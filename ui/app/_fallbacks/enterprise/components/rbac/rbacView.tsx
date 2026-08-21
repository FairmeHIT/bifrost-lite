import { useI18n } from "@/lib/i18n/context";
import { UserRoundCheck } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function RBACView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<UserRoundCheck className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.rbacTitle")}
				description={t("enterprise.rbacDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}