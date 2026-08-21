// Bifrost UI i18n — lightweight, dependency-free internationalization.
//
// Usage:
//   const { t, lang, setLang } = useI18n();
//   t("common.save");                    // "Save" / "保存"
//   t("dashboard.period", { p: "24h" }); // interpolation: {placeholder}
//
// Language is persisted in localStorage ("bifrost_lang") and defaults to
// 中文 unless the browser language is English.

import type { Lang, Dict } from "./types";
import { en } from "./en";
import { zh } from "./zh";

export type { Lang } from "./types";
export { I18nProvider, useI18n } from "./context";

export const LANG_STORAGE_KEY = "bifrost_lang";

export const LANGS: { value: Lang; label: string; nativeLabel: string }[] = [
	{ value: "en", label: "English", nativeLabel: "English" },
	{ value: "zh", label: "中文", nativeLabel: "中文" },
];

const dictionaries: Record<Lang, Dict> = { en, zh };

export function detectInitialLang(): Lang {
	try {
		const stored = localStorage.getItem(LANG_STORAGE_KEY);
		if (stored === "en" || stored === "zh") return stored;
	} catch {
		// localStorage unavailable — fall through to browser language
	}
	if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) {
		return "en";
	}
	return "zh";
}

function resolvePath(dict: Dict, path: string): string | undefined {
	let node: unknown = dict;
	for (const part of path.split(".")) {
		if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
			node = (node as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return typeof node === "string" ? node : undefined;
}

/** Interpolates {placeholder} tokens in a translated string. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in params ? String(params[key]) : match,
	);
}

/** Translate a dot-path key in the given language dictionary. Falls back to en, then the raw key. */
export function translate(lang: Lang, path: string, params?: Record<string, string | number>): string {
	const dict = dictionaries[lang];
	const hit = resolvePath(dict, path);
	if (hit !== undefined) return interpolate(hit, params);
	const enHit = resolvePath(en, path);
	if (enHit !== undefined) return interpolate(enHit, params);
	return path;
}
