import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Language switcher — click to toggle between English and 中文.
 * The choice is persisted in localStorage (bifrost_lang).
 */
export function LanguageToggle() {
	const { lang, setLang, t } = useI18n();

	const nextLang = lang === "en" ? "zh" : "en";
	const label = lang === "en" ? "EN" : "中";

	return (
		<Button
			variant="ghost"
			size="icon"
			className="hover:text-primary text-muted-foreground flex h-5 w-5 cursor-pointer items-center border-0 ring-offset-0 outline-none select-none focus-visible:ring-0"
			aria-label={t("common.language")}
			data-testid="language-toggle"
			onClick={() => setLang(nextLang)}
		>
			<span className="text-[11px] font-semibold tracking-wider">{label}</span>
			<span className="sr-only">{t("common.language")}</span>
		</Button>
	);
}