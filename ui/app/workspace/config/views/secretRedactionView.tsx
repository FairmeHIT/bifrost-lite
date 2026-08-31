import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/context";
import { getErrorMessage, useCreatePluginMutation, useGetPluginsQuery, useUpdatePluginMutation } from "@/lib/store";
import { SECRETREDACT_PLUGIN } from "@/lib/types/plugins";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { I18nState } from "@/lib/i18n/types";

// Editor form state. Everything lives as strings in the editor and is
// converted to the typed plugin config on save — the plugin config blob is
// a free-form object on the wire (plugin.config: any).
interface EditorConfig {
	placeholder: string;
	minEntropy: string;
	ignoredKeywords: string;
	customRules: string;
	disableDefaults: boolean;
}

const defaultEditorConfig: EditorConfig = {
	placeholder: "",
	minEntropy: "",
	ignoredKeywords: "",
	customRules: "",
	disableDefaults: false,
};

// Hydrate the editor from the stored plugin config blob. Unknown or absent
// fields fall back to empty (the backend then applies its own defaults).
const toEditorConfig = (config: Record<string, unknown> | undefined | null): EditorConfig => {
	if (!config) return { ...defaultEditorConfig };
	const rules = Array.isArray(config.custom_rules) ? config.custom_rules : [];
	const keywords = Array.isArray(config.ignored_keywords) ? config.ignored_keywords : [];
	return {
		placeholder: typeof config.placeholder === "string" ? config.placeholder : "",
		minEntropy: config.min_entropy != null ? String(config.min_entropy) : "",
		ignoredKeywords: keywords.map((k) => String(k)).join(", "),
		customRules: rules.length > 0 ? JSON.stringify(rules, null, 2) : "",
		disableDefaults: config.disable_defaults === true,
	};
};

// Build the wire-format config from the editor state. Empty/invalid optional
// fields are omitted so the backend defaults apply.
const buildPayload = (editor: EditorConfig): Record<string, unknown> => {
	const payload: Record<string, unknown> = {};
	const placeholder = editor.placeholder.trim();
	if (placeholder) payload.placeholder = placeholder;
	const entropy = Number.parseFloat(editor.minEntropy);
	if (Number.isFinite(entropy) && entropy > 0) payload.min_entropy = entropy;
	const keywords = editor.ignoredKeywords
		.split(",")
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
	if (keywords.length > 0) payload.ignored_keywords = keywords;
	const rulesText = editor.customRules.trim();
	if (rulesText) payload.custom_rules = JSON.parse(rulesText);
	if (editor.disableDefaults) payload.disable_defaults = true;
	return payload;
};

// Validation returns a translated error message or null.
const validate = (editor: EditorConfig, t: I18nState["t"]): string | null => {
	const entropy = Number.parseFloat(editor.minEntropy);
	if (editor.minEntropy.trim() !== "" && (!Number.isFinite(entropy) || entropy < 0 || entropy > 8)) {
		return t("config.secretRedaction.validation.entropyRange");
	}
	const rulesText = editor.customRules.trim();
	if (rulesText) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rulesText);
		} catch {
			return t("config.secretRedaction.validation.rulesJsonInvalid");
		}
		if (!Array.isArray(parsed)) {
			return t("config.secretRedaction.validation.rulesJsonInvalid");
		}
		for (const entry of parsed) {
			if (
				typeof entry !== "object" ||
				entry === null ||
				typeof (entry as Record<string, unknown>).id !== "string" ||
				typeof (entry as Record<string, unknown>).pattern !== "string"
			) {
				return t("config.secretRedaction.validation.rulesEntryInvalid");
			}
		}
	}
	return null;
};

export default function SecretRedactionView() {
	const { t } = useI18n();

	// The plugins API row is the single source of truth for both the enabled
	// flag and the config blob — same pattern as the caching view.
	const { data: plugins, isLoading: pluginsLoading, error: pluginsError } = useGetPluginsQuery();
	const plugin = useMemo(() => plugins?.find((p) => p.name === SECRETREDACT_PLUGIN), [plugins]);
	const enabledOnServer = Boolean(plugin?.enabled);

	const [updatePlugin, { isLoading: isUpdating }] = useUpdatePluginMutation();
	const [createPlugin, { isLoading: isCreating }] = useCreatePluginMutation();
	const isSaving = isUpdating || isCreating;

	const [editor, setEditor] = useState<EditorConfig>(defaultEditorConfig);

	// Hydrate once the plugin row lands.
	useEffect(() => {
		if (plugins === undefined || !plugin) return;
		setEditor(toEditorConfig(plugin.config as Record<string, unknown> | undefined));
	}, [plugins, plugin]);

	const handleToggle = async (checked: boolean) => {
		try {
			if (plugin) {
				// Keep the last-saved config; the backend ReloadPlugins or
				// RemovePlugins based on the new flag — no restart needed.
				await updatePlugin({
					name: SECRETREDACT_PLUGIN,
					data: { enabled: checked, config: plugin.config ?? {} },
				}).unwrap();
			} else {
				// No plugin row + toggling off ⇒ nothing to disable.
				if (!checked) return;
				await createPlugin({
					name: SECRETREDACT_PLUGIN,
					enabled: true,
					config: {},
					path: "",
				}).unwrap();
			}
			toast.success(checked ? t("config.secretRedaction.enabled") : t("config.secretRedaction.disabled"));
		} catch (error) {
			toast.error(
				checked
					? t("config.secretRedaction.enableFailed", { error: getErrorMessage(error) })
					: t("config.secretRedaction.disableFailed", { error: getErrorMessage(error) }),
			);
		}
	};

	const handleSave = async () => {
		const err = validate(editor, t);
		if (err) {
			toast.error(err);
			return;
		}
		let payload: Record<string, unknown>;
		try {
			payload = buildPayload(editor);
		} catch {
			toast.error(t("config.secretRedaction.validation.rulesJsonInvalid"));
			return;
		}
		try {
			if (plugin) {
				await updatePlugin({
					name: SECRETREDACT_PLUGIN,
					data: { enabled: plugin.enabled, config: payload },
				}).unwrap();
			} else {
				// Save-before-enable: create a disabled row holding the config;
				// flipping the switch later loads it as-is.
				await createPlugin({
					name: SECRETREDACT_PLUGIN,
					enabled: false,
					config: payload,
					path: "",
				}).unwrap();
			}
			toast.success(t("config.secretRedaction.saved"));
		} catch (error) {
			toast.error(t("config.secretRedaction.saveFailed", { error: getErrorMessage(error) }));
		}
	};

	const isLoading = pluginsLoading;

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{t("config.secretRedaction.title")}</h2>
				<p className="text-muted-foreground text-sm">{t("config.secretRedaction.description")}</p>
			</div>

			{pluginsError !== undefined && (
				<div className="border-destructive/50 bg-destructive/10 rounded-sm border p-4">
					<p className="text-destructive text-sm font-medium">{t("config.secretRedaction.loadFailed")}</p>
					<p className="text-muted-foreground mt-1 text-sm">{getErrorMessage(pluginsError)}</p>
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
				</div>
			)}

			{!isLoading && (
				<div className="space-y-4">
					{/* Enable toggle flips plugin.enabled on the secretredact plugin row.
					    The plugins API handles ReloadPlugin / RemovePlugin transparently. */}
					<div className="flex items-center justify-between space-x-2">
						<div className="space-y-0.5">
							<label htmlFor="enable-secret-redaction" className="text-sm font-medium">
								{t("config.secretRedaction.enable")}
							</label>
							<p className="text-muted-foreground text-sm">{t("config.secretRedaction.enableDescription")}</p>
						</div>
						<Switch
							id="enable-secret-redaction"
							data-testid="secret-redaction-enable-switch"
							size="md"
							checked={enabledOnServer}
							disabled={isSaving}
							onCheckedChange={handleToggle}
						/>
					</div>

					<div className={cn("space-y-4", !enabledOnServer && "pointer-events-none opacity-50")} aria-disabled={!enabledOnServer}>
						<div className="space-y-2">
							<Label htmlFor="secret-redaction-placeholder" className="text-sm font-medium">
								{t("config.secretRedaction.placeholder")}
							</Label>
							<p className="text-muted-foreground text-sm">{t("config.secretRedaction.placeholderDescription")}</p>
							<Input
								id="secret-redaction-placeholder"
								data-testid="secret-redaction-placeholder-input"
								placeholder="[REDACTED:{rule}]"
								value={editor.placeholder}
								onChange={(e) => setEditor((prev) => ({ ...prev, placeholder: e.target.value }))}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="secret-redaction-entropy" className="text-sm font-medium">
								{t("config.secretRedaction.minEntropy")}
							</Label>
							<p className="text-muted-foreground text-sm">{t("config.secretRedaction.minEntropyDescription")}</p>
							<Input
								id="secret-redaction-entropy"
								data-testid="secret-redaction-entropy-input"
								type="number"
								min="0"
								max="8"
								step="0.1"
								placeholder="3.5"
								value={editor.minEntropy}
								onChange={(e) => setEditor((prev) => ({ ...prev, minEntropy: e.target.value }))}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="secret-redaction-ignored" className="text-sm font-medium">
								{t("config.secretRedaction.ignoredKeywords")}
							</Label>
							<p className="text-muted-foreground text-sm">{t("config.secretRedaction.ignoredKeywordsDescription")}</p>
							<Input
								id="secret-redaction-ignored"
								data-testid="secret-redaction-ignored-input"
								placeholder="example, dummy, test-key"
								value={editor.ignoredKeywords}
								onChange={(e) => setEditor((prev) => ({ ...prev, ignoredKeywords: e.target.value }))}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="secret-redaction-rules" className="text-sm font-medium">
								{t("config.secretRedaction.customRules")}
							</Label>
							<p className="text-muted-foreground text-sm">{t("config.secretRedaction.customRulesDescription")}</p>
							<Textarea
								id="secret-redaction-rules"
								data-testid="secret-redaction-rules-textarea"
								rows={6}
								placeholder={'[\n  { "id": "internal-key", "pattern": "acme_[A-Za-z0-9]{20,}" }\n]'}
								value={editor.customRules}
								onChange={(e) => setEditor((prev) => ({ ...prev, customRules: e.target.value }))}
							/>
						</div>

						<div className="flex items-center justify-between space-x-2">
							<div className="space-y-0.5">
								<label htmlFor="secret-redaction-defaults" className="text-sm font-medium">
									{t("config.secretRedaction.disableDefaults")}
								</label>
								<p className="text-muted-foreground text-sm">{t("config.secretRedaction.disableDefaultsDescription")}</p>
							</div>
							<Switch
								id="secret-redaction-defaults"
								data-testid="secret-redaction-defaults-switch"
								size="md"
								checked={editor.disableDefaults}
								onCheckedChange={(checked) => setEditor((prev) => ({ ...prev, disableDefaults: checked }))}
							/>
						</div>

						<Button data-testid="secret-redaction-save-button" variant="secondary" size="sm" disabled={isSaving} onClick={handleSave}>
							{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("config.secretRedaction.save")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}