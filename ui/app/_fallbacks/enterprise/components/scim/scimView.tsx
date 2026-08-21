import { useI18n } from "@/lib/i18n/context";
import { BookUser } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function SCIMView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<BookUser className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.scimTitle")}
				description={t("enterprise.scimDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}