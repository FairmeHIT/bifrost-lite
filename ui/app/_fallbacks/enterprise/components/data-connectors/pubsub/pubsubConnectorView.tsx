import { useI18n } from "@/lib/i18n/context";
import { Radio } from "lucide-react";
import ContactUsView from "../../views/contactUsView";

interface EnableToggleProps {
	enabled: boolean;
	onToggle: () => void;
	disabled?: boolean;
}

interface PubSubConnectorViewProps {
	onDelete?: () => void;
	isDeleting?: boolean;
	enableToggle?: EnableToggleProps;
}

export default function PubSubConnectorView(_props: PubSubConnectorViewProps) {
	const { t } = useI18n();
	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<div className="flex w-full flex-col items-center justify-center py-8">
					<ContactUsView
						align="middle"
						className="mx-auto w-full max-w-lg"
						icon={<Radio className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
						title={t("enterprise.pubsubTitle")}
						description={t("enterprise.pubsubDesc")}
						readmeLink="https://docs.getbifrost.ai/enterprise/pubsub-connector"
						testIdPrefix="pubsub-connector"
					/>
				</div>
			</div>
		</div>
	);
}