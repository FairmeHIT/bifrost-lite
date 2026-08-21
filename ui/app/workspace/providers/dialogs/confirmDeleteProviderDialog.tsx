import { useI18n } from "@/lib/i18n/context";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
} from "@/components/ui/alertDialog";
import { getErrorMessage, useDeleteProviderMutation } from "@/lib/store";
import { ModelProvider } from "@/lib/types/config";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { AlertDialogTitle } from "@radix-ui/react-alert-dialog";
import { toast } from "sonner";

interface Props {
	show: boolean;
	onCancel: () => void;
	onDelete: () => void;
	provider: ModelProvider;
}

export default function ConfirmDeleteProviderDialog({ show, onCancel, onDelete, provider }: Props) {
	const { t } = useI18n();
	const [deleteProvider, { isLoading: isDeletingProvider }] = useDeleteProviderMutation();
	const hasDeleteAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Delete);

	const onDeleteHandler = () => {
		deleteProvider(provider.name)
			.unwrap()
			.then(() => {
				onDelete();
			})
			.catch((err) => {
				toast.error(t("providers.confirmDelete.failed"), {
					description: getErrorMessage(err),
				});
			});
	};

	return (
		<AlertDialog open={show}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("providers.confirmDelete.title")}</AlertDialogTitle>
					<AlertDialogDescription>{t("providers.confirmDelete.description")}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>{t("common.cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={onDeleteHandler} disabled={isDeletingProvider || !hasDeleteAccess}>
						{isDeletingProvider ? t("providers.confirmDelete.deleting") : t("common.delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}