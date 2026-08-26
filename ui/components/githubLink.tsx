import { Github } from "lucide-react";

import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

/** GitHub repository URL of this project. */
const GITHUB_URL = "https://github.com/FairmeHIT/bifrost-lite-ops";

/**
 * GitHub link — opens the project repository in a new tab.
 * Mirrors the look of the language/theme toggles in the sidebar footer.
 */
export function GithubLink() {
	const { t } = useI18n();

	return (
		<Button
			variant="ghost"
			size="icon"
			asChild
			className="hover:text-primary text-muted-foreground flex h-5 w-5 cursor-pointer items-center border-0 ring-offset-0 outline-none select-none focus-visible:ring-0"
			aria-label={t("common.github")}
			data-testid="github-link"
		>
			<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
				<Github className="h-4 w-4" strokeWidth={2} />
				<span className="sr-only">{t("common.github")}</span>
			</a>
		</Button>
	);
}