import { useI18n } from "@/lib/i18n/context";
import { Building2 } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export function BusinessUnitsView() {
	const { t } = useI18n();
	return (
		<div className="w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				testIdPrefix="business-units-governance"
				icon={<Building2 className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.businessUnitsTitle")}
				description={t("enterprise.businessUnitsDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}