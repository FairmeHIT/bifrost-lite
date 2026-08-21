import { useI18n } from "@/lib/i18n/context";
import { Users } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function UserRankingsTab() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Users className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.userRankingsTitle")}
				description={t("enterprise.userRankingsDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/user-rankings"
				testIdPrefix="user-rankings"
			/>
		</div>
	);
}