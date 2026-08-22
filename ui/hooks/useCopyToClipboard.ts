import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";

interface UseCopyToClipboardOptions {
	successMessage?: string;
	errorMessage?: string;
	resetDelay?: number;
}

export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}) {
	const { successMessage = t("ui.copyToClipboard.success"), errorMessage = t("ui.copyToClipboard.failed"), resetDelay = 2000 } = options;
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const copy = useCallback(
		async (text: string) => {
			try {
				await navigator.clipboard.writeText(text);
				setCopied(true);
				toast.success(successMessage);

				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
			} catch {
				toast.error(errorMessage);
			}
		},
		[successMessage, errorMessage, resetDelay],
	);

	return { copy, copied };
}