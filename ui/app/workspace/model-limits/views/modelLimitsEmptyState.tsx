import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { Wallet } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

const MODEL_LIMITS_DOCS_URL = "https://docs.getbifrost.ai/features/governance";

interface ModelLimitsEmptyStateProps {
	onAddClick: () => void;
	canCreate?: boolean;
}

export function ModelLimitsEmptyState({ onAddClick, canCreate = true }: ModelLimitsEmptyStateProps) {
	const { t } = useI18n();

	return (
		<div className="flex min-h-[80vh] w-full flex-col items-center justify-center gap-4 py-16 text-center">
			<div className="text-muted-foreground">
				<Wallet className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{t("modelLimits.emptyState.heading")}</h1>
				<div className="text-muted-foreground mx-auto mt-2 max-w-[600px] text-sm font-normal">
					{t("modelLimits.emptyState.description")}
				</div>
				<div className="mx-auto mt-6 flex flex-row flex-wrap items-center justify-center gap-2">
					<Button
						variant="outline"
						aria-label={t("modelLimits.emptyState.readMoreAria")}
						data-testid="model-limits-button-read-more"
						onClick={() => {
							window.open(`${MODEL_LIMITS_DOCS_URL}?utm_source=bfd`, "_blank", "noopener,noreferrer");
						}}
					>
						{t("modelLimits.emptyState.readMore")} <ArrowUpRight className="text-muted-foreground h-3 w-3" />
					</Button>
					<Button
						aria-label={t("modelLimits.emptyState.addLimitAria")}
						onClick={onAddClick}
						disabled={!canCreate}
						data-testid="model-limits-button-create"
					>
						{t("modelLimits.emptyState.addLimit")}
					</Button>
				</div>
			</div>
		</div>
	);
}