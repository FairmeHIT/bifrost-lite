import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Validator } from "@/lib/utils/validation";
import { Save } from "lucide-react";

interface FormFooterProps {
	validator: Validator;
	label: string;
	onCancel: () => void;
	isLoading: boolean;
	isEditing: boolean;
	hasPermission?: boolean;
}

export default function FormFooter({ validator, label, onCancel, isLoading, isEditing, hasPermission = true }: FormFooterProps) {
	const { t } = useI18n();
	const isDisabled = isLoading || !validator.isValid() || !hasPermission;

	const getTooltipMessage = () => {
		if (!hasPermission) return t("formFooter.noPermission");
		if (isLoading) return t("common.saving");
		return validator.getFirstError() || t("formFooter.validationErrors");
	};

	return (
		<DialogFooter className="mt-4">
			<Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
				{t("common.cancel")}
			</Button>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span>
							<Button type="submit" disabled={isDisabled}>
								<Save className="h-4 w-4" />
								{isLoading ? t("common.saving") : isEditing ? `${t("common.edit")} ${label}` : `${t("common.create")} ${label}`}
							</Button>
						</span>
					</TooltipTrigger>
					{isDisabled && (
						<TooltipContent>
							<p>{getTooltipMessage()}</p>
						</TooltipContent>
					)}
				</Tooltip>
			</TooltipProvider>
		</DialogFooter>
	);
}