import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
	const { t } = useI18n();
	const { theme, setTheme } = useTheme();

	const toggleTheme = () => {
		setTheme(theme === "dark" ? "light" : "dark");
	};

	return (
		<Button
			variant="ghost"
			size="icon"
			className="hover:text-primary text-muted-foreground relative h-5 w-5 cursor-pointer border-0 ring-offset-0 outline-none select-none focus-visible:ring-0"
			onClick={toggleTheme}
			aria-label={t("theme.toggle")}
		>
			<Sun className="h-5.5 w-5.5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" strokeWidth={2} />
			<Moon className="absolute h-5.5 w-5.5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" strokeWidth={2} />
			<span className="sr-only">{t("theme.toggle")}</span>
		</Button>
	);
}