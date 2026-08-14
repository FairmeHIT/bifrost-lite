import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { LANGS, useI18n } from "@/lib/i18n";

/**
 * Language switcher — toggles the UI between English and 中文.
 * The choice is persisted in localStorage (bifrost_lang).
 */
export function LanguageToggle() {
	const { lang, setLang, t } = useI18n();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="hover:text-primary text-muted-foreground h-5 w-5 border-0 ring-offset-0 outline-none select-none focus-visible:ring-0"
					aria-label={t("common.language")}
					data-testid="language-toggle"
				>
					<Languages className="h-5.5 w-5.5" strokeWidth={2} />
					<span className="sr-only">{t("common.language")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="top">
				{LANGS.map((l) => (
					<DropdownMenuItem
						key={l.value}
						onSelect={() => setLang(l.value)}
						className={l.value === lang ? "text-primary" : undefined}
						data-testid={`language-option-${l.value}`}
					>
						{l.nativeLabel}
						<span className="text-muted-foreground ml-2 text-xs">{l.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
