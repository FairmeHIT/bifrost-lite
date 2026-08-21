import { useI18n } from "@/lib/i18n/context";
import { Badge } from "./ui/badge";

export default function BetaBadge() {
	const { t } = useI18n();
	return <Badge variant="secondary">{t("beta.badge")}</Badge>;
}