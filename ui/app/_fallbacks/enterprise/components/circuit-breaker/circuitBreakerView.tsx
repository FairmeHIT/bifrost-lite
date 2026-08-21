import { useI18n } from "@/lib/i18n/context";
import { CircuitBoard } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function CircuitBreakerView() {
	const { t } = useI18n();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<CircuitBoard className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.circuitBreakerTitle")}
				description={t("enterprise.circuitBreakerDesc")}
				readmeLink="https://docs.getbifrost.ai/enterprise/circuit-breaker"
			/>
		</div>
	);
}