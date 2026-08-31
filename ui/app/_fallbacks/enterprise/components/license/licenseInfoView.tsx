import { useI18n } from "@/lib/i18n/context";
import { KeyRound } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function LicenseSettingsView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<KeyRound className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.licenseTitle")}
				description={t("enterprise.licenseDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/overview"
				testIdPrefix="license"
			/>
		</div>
	);
}