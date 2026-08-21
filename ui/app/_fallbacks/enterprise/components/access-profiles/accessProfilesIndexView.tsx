import { useI18n } from "@/lib/i18n/context";
import { ShieldCheck } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function AccessProfilesIndexView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<ShieldCheck className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.accessProfilesTitle")}
				description={t("enterprise.accessProfilesDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/access-profiles"
				testIdPrefix="access-profiles"
			/>
		</div>
	);
}