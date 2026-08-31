export type Lang = "en" | "zh";

/** Dictionary shape: nested objects of strings. */
export type Dict = {
	[key: string]: string | Dict;
};

export interface I18nState {
	lang: Lang;
	setLang: (lang: Lang) => void;
	t: (path: string, params?: Record<string, string | number>) => string;
}