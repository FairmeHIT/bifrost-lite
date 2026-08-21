import { useI18n } from "@/lib/i18n/context";
import { Users } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function UsersView() {
	const { t } = useI18n();
	return (
		<div className="w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Users className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.usersTitle")}
				description={t("enterprise.usersDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}