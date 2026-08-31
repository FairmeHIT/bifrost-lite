import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANG_STORAGE_KEY, detectInitialLang, setCurrentLang, translate } from "./index";
import type { I18nState, Lang } from "./types";

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [lang, setLangState] = useState<Lang>(detectInitialLang);

	useEffect(() => {
		try {
			localStorage.setItem(LANG_STORAGE_KEY, lang);
		} catch {
			// localStorage unavailable — language just won't persist across reloads
		}
		// Sync module-level lang so non-component code (zod, toasts) translates correctly
		setCurrentLang(lang);
	}, [lang]);

	const setLang = useCallback((next: Lang) => setLangState(next), []);

	const t = useCallback((path: string, params?: Record<string, string | number>) => translate(lang, path, params), [lang]);

	const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
	const ctx = useContext(I18nContext);
	if (!ctx) {
		// Outside a provider (e.g. unit tests): fall back to English.
		return {
			lang: "en",
			setLang: () => {},
			t: (path, params) => translate("en", path, params),
		};
	}
	return ctx;
}