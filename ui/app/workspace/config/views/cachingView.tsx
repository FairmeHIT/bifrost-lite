import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/context";
import { ProviderIconType, RenderProviderIcon } from "@/lib/constants/icons";
import { EmbeddingSupportedProviders, getProviderLabel } from "@/lib/constants/logs";
import {
	getErrorMessage,
	useCreatePluginMutation,
	useGetCoreConfigQuery,
	useGetPluginsQuery,
	useGetProvidersQuery,
	useUpdatePluginMutation,
} from "@/lib/store";
import { CacheConfig, EditorCacheConfig, ModelProvider, ModelProviderName } from "@/lib/types/config";
import { SEMANTIC_CACHE_PLUGIN } from "@/lib/types/plugins";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { I18nState } from "@/lib/i18n/types";

// The local cache plugin runs in one of two modes. Direct-only is purely
// hash-based, no embedding provider needed; perfect for exact-replay
// caching. Semantic adds vector similarity on top, requiring an
// embedding-capable provider and the model's real dimension.
type CacheMode = "direct" | "semantic";

// Embedding-capable providers gate the semantic mode. Built-in providers
// are listed in EmbeddingSupportedProviders; custom providers expose
// support via custom_provider_config.allowed_requests.embedding.
const supportsEmbedding = (provider: ModelProvider): boolean => {
	if (provider.custom_provider_config) {
		return provider.custom_provider_config.allowed_requests?.embedding === true;
	}
	return (EmbeddingSupportedProviders as readonly string[]).includes(provider.name);
};

const defaultDirectConfig: EditorCacheConfig = {
	ttl: 300,
	threshold: 0.8,
	dimension: 1,
	conversation_history_threshold: 3,
	exclude_system_prompt: false,
	cache_by_model: true,
	cache_by_provider: true,
};

// Configs we treat as "the user has nothing saved": both API responses
// where every field is the type's zero value and the literal undefined
// look like this.
const isEmptyConfig = (config: Partial<EditorCacheConfig> | undefined): boolean => {
	if (!config) return true;
	// Booleans are deliberate user choices (e.g. cache_by_model: false), not
	// empty markers — only treat numeric/string zero values as empty.
	const isZero = (v: unknown) => v === undefined || v === null || v === 0 || v === "";
	return Object.values(config).every(isZero);
};

const toEditorCacheConfig = (config?: Partial<EditorCacheConfig>): EditorCacheConfig => {
	if (!config || isEmptyConfig(config)) {
		return { ...defaultDirectConfig };
	}
	return { ...defaultDirectConfig, ...config };
};

const inferMode = (config: EditorCacheConfig): CacheMode => {
	if (config.dimension && config.dimension > 1 && config.provider) return "semantic";
	return "direct";
};

// Strip semantic-only fields when persisting a direct-only payload so the
// server validator doesn't reject a stale provider choice.
const buildPayload = (config: EditorCacheConfig, mode: CacheMode): CacheConfig => {
	const base = {
		ttl: config.ttl ?? 0,
		threshold: config.threshold ?? 0,
		conversation_history_threshold: config.conversation_history_threshold,
		exclude_system_prompt: config.exclude_system_prompt,
		cache_by_model: config.cache_by_model,
		cache_by_provider: config.cache_by_provider,
		vector_store_namespace: config.vector_store_namespace?.trim() || undefined,
		default_cache_key: config.default_cache_key?.trim() || undefined,
	};
	if (mode === "direct") {
		return { ...base, dimension: 1 } as CacheConfig;
	}
	return {
		...base,
		provider: config.provider as ModelProviderName,
		embedding_model: config.embedding_model ?? "",
		dimension: config.dimension ?? 0,
	} as CacheConfig;
};

const validateForSave = (config: EditorCacheConfig, mode: CacheMode, t: I18nState["t"]): string | null => {
	if (mode === "semantic") {
		if (!config.provider) return t("config.caching.validation.embeddingProviderRequired");
		if (!config.embedding_model?.trim()) return t("config.caching.validation.embeddingModelRequired");
		if (!config.dimension || config.dimension <= 1) {
			return t("config.caching.validation.dimensionRequired");
		}
	}
	if (config.ttl !== undefined && config.ttl < 0) return t("config.caching.validation.ttlNonNegative");
	if (config.threshold !== undefined && (config.threshold < 0 || config.threshold > 1)) {
		return t("config.caching.validation.thresholdBetween");
	}
	if (
		config.conversation_history_threshold !== undefined &&
		(config.conversation_history_threshold < 1 || config.conversation_history_threshold > 50)
	) {
		return t("config.caching.validation.conversationHistoryThresholdBetween");
	}
	return null;
};

export default function CachingView() {
	const { t } = useI18n();
	const { data: bifrostConfig, isLoading: configLoading, error: configError } = useGetCoreConfigQuery({ fromDB: true });
	const isVectorStoreEnabled = bifrostConfig?.is_cache_connected ?? false;

	// Local cache state lives on the plugin row keyed by SEMANTIC_CACHE_PLUGIN.
	// No dedicated /local-cache-config endpoint exists — the plugins API is
	// the source of truth for both the enabled flag and the config blob.
	const { data: plugins, isLoading: pluginsLoading } = useGetPluginsQuery();
	const semanticCachePlugin = useMemo(() => plugins?.find((p) => p.name === SEMANTIC_CACHE_PLUGIN), [plugins]);
	const enabledOnServer = Boolean(semanticCachePlugin?.enabled);

	const { data: providersData, error: providersError, isLoading: providersLoading } = useGetProvidersQuery();
	const providers = useMemo(() => providersData || [], [providersData]);
	const embeddingProviders = useMemo(() => providers.filter(supportsEmbedding), [providers]);

	const [updatePlugin, { isLoading: isUpdating }] = useUpdatePluginMutation();
	const [createPlugin, { isLoading: isCreating }] = useCreatePluginMutation();
	const isSaving = isUpdating || isCreating;

	const [cacheConfig, setCacheConfig] = useState<EditorCacheConfig>(defaultDirectConfig);
	const [serverCacheConfig, setServerCacheConfig] = useState<EditorCacheConfig>(defaultDirectConfig);
	const [mode, setMode] = useState<CacheMode>("direct");

	// Hydrate from the plugin row once it lands. If the plugin doesn't exist
	// yet (first-time setup), keep the default direct-only seed so the user
	// can start typing before any save.
	useEffect(() => {
		if (plugins === undefined) return;
		if (!semanticCachePlugin?.config) return;
		const editorConfig = toEditorCacheConfig(semanticCachePlugin.config as Partial<EditorCacheConfig>);
		setCacheConfig(editorConfig);
		setServerCacheConfig(editorConfig);
		setMode(inferMode(editorConfig));
	}, [plugins, semanticCachePlugin]);

	useEffect(() => {
		if (providersError) {
			toast.error(t("config.caching.providersLoadFailed", { error: getErrorMessage(providersError as any) }));
		}
	}, [providersError, t]);

	// Surface validation problems inline rather than only on Save click.
	const validationError = useMemo(() => validateForSave(cacheConfig, mode, t), [cacheConfig, mode, t]);

	// Only show the dimension/namespace heads-up when the user has actually
	// touched a structural field. Showing it permanently in semantic mode
	// trains users to ignore it; showing it on diff makes it land.
	const hasStructuralChange = useMemo(() => {
		return (
			cacheConfig.provider !== serverCacheConfig.provider ||
			cacheConfig.embedding_model !== serverCacheConfig.embedding_model ||
			cacheConfig.dimension !== serverCacheConfig.dimension
		);
	}, [cacheConfig, serverCacheConfig]);

	const hasUnsavedConfigChanges = useMemo(() => {
		const fields: (keyof EditorCacheConfig)[] = [
			"provider",
			"embedding_model",
			"dimension",
			"ttl",
			"threshold",
			"conversation_history_threshold",
			"exclude_system_prompt",
			"cache_by_model",
			"cache_by_provider",
			"vector_store_namespace",
			"default_cache_key",
		];
		const changed = fields.some((k) => (cacheConfig[k] ?? "") !== (serverCacheConfig[k] ?? ""));
		const modeChanged = inferMode(serverCacheConfig) !== mode;
		return changed || modeChanged;
	}, [cacheConfig, serverCacheConfig, mode]);

	const updateLocal = (updates: Partial<EditorCacheConfig>) => {
		setCacheConfig((prev) => ({ ...prev, ...updates }));
	};

	// Toggle handler. Updates the semantic_cache plugin's enabled flag while
	// keeping the last-saved config so the backend can ReloadPlugin/RemovePlugin
	// based on the new flag. When toggling on for the first time and no plugin
	// row exists, we seed it with the current editor config (direct-only by
	// default) so the create call has a valid payload — the user can refine
	// the config and Save afterwards.
	const handleToggle = async (checked: boolean) => {
		try {
			if (semanticCachePlugin) {
				await updatePlugin({
					name: SEMANTIC_CACHE_PLUGIN,
					data: { enabled: checked, config: semanticCachePlugin.config },
				}).unwrap();
			} else {
				// No plugin row + user toggling off ⇒ nothing to disable.
				// Bail before the success toast so we don't lie about the state.
				if (!checked) return;
				const err = validateForSave(cacheConfig, mode, t);
				if (err) {
					toast.error(err);
					return;
				}
				const payload = buildPayload(cacheConfig, mode);
				await createPlugin({
					name: SEMANTIC_CACHE_PLUGIN,
					enabled: true,
					config: payload,
					path: "",
				}).unwrap();
			}
			toast.success(checked ? t("config.caching.enabled") : t("config.caching.disabled"));
		} catch (error) {
			toast.error(
				checked
					? t("config.caching.enableFailed", { error: getErrorMessage(error) })
					: t("config.caching.disableFailed", { error: getErrorMessage(error) }),
			);
		}
	};

	const handleSave = async () => {
		const err = validateForSave(cacheConfig, mode, t);
		if (err) {
			toast.error(err);
			return;
		}
		const payload = buildPayload(cacheConfig, mode);
		try {
			const updated = semanticCachePlugin
				? await updatePlugin({
						name: SEMANTIC_CACHE_PLUGIN,
						data: { enabled: semanticCachePlugin.enabled, config: payload },
					}).unwrap()
				: await createPlugin({
						name: SEMANTIC_CACHE_PLUGIN,
						enabled: false,
						config: payload,
						path: "",
					}).unwrap();
			const editor = toEditorCacheConfig(updated.config as Partial<EditorCacheConfig>);
			setCacheConfig(editor);
			setServerCacheConfig(editor);
			setMode(inferMode(editor));
			toast.success(t("config.caching.updated"));
		} catch (error) {
			toast.error(t("config.caching.updateFailed", { error: getErrorMessage(error) }));
		}
	};

	const cachingActive = enabledOnServer && isVectorStoreEnabled;
	const isLoading = configLoading || pluginsLoading;

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{t("config.caching.sectionTitle")}</h2>
				<p className="text-muted-foreground text-sm">
					<span dangerouslySetInnerHTML={{ __html: t("config.caching.description") }} />{" "}
					{!isVectorStoreEnabled && (
						<span
							className="text-destructive font-medium"
							dangerouslySetInnerHTML={{ __html: t("config.caching.requiresVectorStore") }}
						/>
					)}
				</p>
			</div>

			{configError !== undefined && (
				<div className="border-destructive/50 bg-destructive/10 rounded-sm border p-4">
					<p className="text-destructive text-sm font-medium">{t("config.caching.loadFailed")}</p>
					<p className="text-muted-foreground mt-1 text-sm">
						{getErrorMessage(configError) || t("config.caching.unexpectedError")}
					</p>
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
				</div>
			)}

			{!isLoading && !configError && (
				<div className="space-y-4">
					{/* Enable toggle flips plugin.enabled on the semantic_cache
					    plugin row. The plugins API handles ReloadPlugin /
					    RemovePlugin transparently on update. */}
					<div className="flex items-center justify-between space-x-2">
						<div className="space-y-0.5">
							<label htmlFor="enable-caching" className="text-sm font-medium">
								{t("config.caching.enableCaching")}
							</label>
							<p className="text-muted-foreground text-sm">{t("config.caching.enableCachingDescription")} </p>
						</div>
						<Switch
							id="enable-caching"
							data-testid="caching-enable-switch"
							size="md"
							checked={cachingActive}
							disabled={!isVectorStoreEnabled || isSaving}
							onCheckedChange={handleToggle}
						/>
					</div>

					{providersLoading ? (
						<div className="flex items-center justify-center py-4">
							<Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
						</div>
					) : (
						<>
							<div className={cn("space-y-4", !cachingActive && "pointer-events-none opacity-50")} aria-disabled={!cachingActive}>
								{/* Mode picker. Direct-only is first-class. */}
								<div className="space-y-2">
									<Label className="text-sm font-medium">{t("config.caching.mode")}</Label>
									<Tabs value={mode} onValueChange={(v) => setMode(v as CacheMode)}>
										<TabsList className="grid w-full grid-cols-2">
											<TabsTrigger value="direct" data-testid="caching-mode-direct-tab">
												{t("config.caching.directOnly")}
											</TabsTrigger>
											<TabsTrigger
												value="semantic"
												data-testid="caching-mode-semantic-tab"
												disabled={embeddingProviders.length === 0}
												title={
													embeddingProviders.length === 0 ? t("config.caching.semanticTooltip") : undefined
												}
											>
												{t("config.caching.directSemantic")}
											</TabsTrigger>
										</TabsList>
									</Tabs>
									<p className="text-muted-foreground text-xs">
										{mode === "direct" ? t("config.caching.directModeDescription") : t("config.caching.semanticModeDescription")}
									</p>
								</div>

								{validationError && (
									<div className="border-destructive/40 bg-destructive/10 text-destructive rounded-sm border p-3 text-xs">
										{validationError}
									</div>
								)}

								{/* Provider/model/dimension only appear in semantic mode. */}
								{mode === "semantic" && (
									<>
										{hasStructuralChange && (
											<div className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
												<b>{t("config.caching.headsUp")}</b>{" "}
												<span dangerouslySetInnerHTML={{ __html: t("config.caching.dimensionWarning") }} />
											</div>
										)}

										<div className="space-y-4">
											<h3 className="text-sm font-medium">{t("config.caching.embeddingProviderAndModel")}</h3>
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-2">
													<Label htmlFor="provider">{t("config.caching.configuredProviders")}</Label>
													<Select
														value={cacheConfig.provider}
														onValueChange={(value: ModelProviderName) =>
															updateLocal({
																provider: value,
																embedding_model: value === cacheConfig.provider ? cacheConfig.embedding_model : "",
															})
														}
													>
														<SelectTrigger className="w-full" data-testid="caching-provider-select">
															<SelectValue placeholder={t("config.caching.selectProvider")} />
														</SelectTrigger>
														<SelectContent>
															{embeddingProviders
																.filter((provider) => provider.name)
																.map((provider) => (
																	<SelectItem key={provider.name} value={provider.name}>
																		<div className="flex items-center gap-2">
																			<RenderProviderIcon provider={provider.name as ProviderIconType} size="sm" className="h-4 w-4" />
																			<span>{getProviderLabel(provider.name)}</span>
																		</div>
																	</SelectItem>
																))}
														</SelectContent>
													</Select>
												</div>
												<div className="space-y-2">
													<Label htmlFor="embedding_model">{t("config.caching.embeddingModel")}</Label>
													<ModelMultiselect
														inputId="embedding_model"
														data-testid="caching-embedding-model-select"
														isSingleSelect
														provider={cacheConfig.provider || undefined}
														value={cacheConfig.embedding_model ?? ""}
														onChange={(model) => updateLocal({ embedding_model: model })}
														placeholder={
															cacheConfig.provider
																? t("config.caching.searchEmbeddingModel")
																: t("config.caching.selectProviderFirst")
														}
														disabled={!cacheConfig.provider}
													/>
												</div>
											</div>
											<p className="text-muted-foreground text-xs">{t("config.caching.apiKeysInherited")}</p>
											<div className="space-y-2">
												<Label htmlFor="dimension">{t("config.caching.dimension")}</Label>
												<Input
													id="dimension"
													data-testid="caching-dimension-input"
													type="number"
													min="2"
													value={cacheConfig.dimension === undefined || Number.isNaN(cacheConfig.dimension) ? "" : cacheConfig.dimension}
													onChange={(e) => {
														const value = e.target.value;
														if (value === "") {
															updateLocal({ dimension: undefined });
															return;
														}
														const parsed = parseInt(value);
														if (!Number.isNaN(parsed)) {
															updateLocal({ dimension: parsed });
														}
													}}
												/>
												<p className="text-muted-foreground text-xs">
													{t("config.caching.dimensionDescription")} <code>1536</code>
													{t("config.caching.dimensionDescriptionForOpenAISmall")} <code>text-embedding-3-small</code>,{" "}
													<code>3072</code>
													{t("config.caching.dimensionDescriptionForOpenAILarge")} <code>text-embedding-3-large</code>,{" "}
													<code>768</code>
													{t("config.caching.dimensionDescriptionSuffix")}
												</p>
											</div>
										</div>
									</>
								)}

								{/* Cache settings shared across modes. */}
								<div className="space-y-4">
									<h3 className="text-sm font-medium">{t("config.caching.cacheSettings")}</h3>
									<div className={cn("grid gap-4", mode === "semantic" ? "grid-cols-2" : "grid-cols-1")}>
										<div className="space-y-2">
											<Label htmlFor="ttl">{t("config.caching.ttl")}</Label>
											<Input
												id="ttl"
												data-testid="caching-ttl-input"
												type="number"
												min="1"
												value={cacheConfig.ttl === undefined || Number.isNaN(cacheConfig.ttl) ? "" : cacheConfig.ttl}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														updateLocal({ ttl: undefined });
														return;
													}
													const parsed = parseInt(value);
													if (!Number.isNaN(parsed)) {
														updateLocal({ ttl: parsed });
													}
												}}
											/>
											<p
												className="text-muted-foreground text-xs"
												dangerouslySetInnerHTML={{ __html: t("config.caching.ttlDescription") }}
											/>
										</div>
										{mode === "semantic" && (
											<div className="space-y-2">
												<Label htmlFor="threshold">{t("config.caching.similarityThreshold")}</Label>
												<Input
													id="threshold"
													data-testid="caching-threshold-input"
													type="number"
													min="0"
													max="1"
													step="0.01"
													value={cacheConfig.threshold === undefined || Number.isNaN(cacheConfig.threshold) ? "" : cacheConfig.threshold}
													onChange={(e) => {
														const value = e.target.value;
														if (value === "") {
															updateLocal({ threshold: undefined });
															return;
														}
														const parsed = parseFloat(value);
														if (!Number.isNaN(parsed)) {
															updateLocal({ threshold: parsed });
														}
													}}
												/>
												<p
													className="text-muted-foreground text-xs"
													dangerouslySetInnerHTML={{ __html: t("config.caching.thresholdDescription") }}
												/>
											</div>
										)}
									</div>
								</div>

								{/* Storage & Cache Key. */}
								<div className="space-y-4">
									<h3 className="text-sm font-medium">{t("config.caching.storageAndCacheKey")}</h3>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-2">
											<Label htmlFor="vector_store_namespace">{t("config.caching.vectorStoreNamespace")}</Label>
											<Input
												id="vector_store_namespace"
												data-testid="caching-vector-store-namespace-input"
												type="text"
												placeholder={t("config.caching.vectorStoreNamespacePlaceholder")}
												value={cacheConfig.vector_store_namespace ?? ""}
												onChange={(e) => updateLocal({ vector_store_namespace: e.target.value })}
											/>
											<p
												className="text-muted-foreground text-xs"
												dangerouslySetInnerHTML={{ __html: t("config.caching.vectorStoreNamespaceDescription") }}
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="default_cache_key">{t("config.caching.defaultCacheKey")}</Label>
											<Input
												id="default_cache_key"
												data-testid="caching-default-cache-key-input"
												type="text"
												placeholder={t("config.caching.defaultCacheKeyPlaceholder")}
												value={cacheConfig.default_cache_key ?? ""}
												onChange={(e) => updateLocal({ default_cache_key: e.target.value })}
											/>
											<p
												className="text-muted-foreground text-xs"
												dangerouslySetInnerHTML={{ __html: t("config.caching.defaultCacheKeyDescription") }}
											/>
										</div>
									</div>
								</div>

								{/* Conversation Settings. */}
								<div className="space-y-4">
									<h3 className="text-sm font-medium">{t("config.caching.conversationSettings")}</h3>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-2">
											<Label htmlFor="conversation_history_threshold">{t("config.caching.conversationHistoryThreshold")}</Label>
											<Input
												id="conversation_history_threshold"
												data-testid="caching-conversation-history-threshold-input"
												type="number"
												min="1"
												max="50"
												value={
													cacheConfig.conversation_history_threshold === undefined ||
													Number.isNaN(cacheConfig.conversation_history_threshold)
														? ""
														: cacheConfig.conversation_history_threshold
												}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														updateLocal({ conversation_history_threshold: undefined });
														return;
													}
													const parsed = parseInt(value);
													if (!Number.isNaN(parsed)) {
														updateLocal({ conversation_history_threshold: parsed });
													}
												}}
											/>
											<p className="text-muted-foreground text-xs">{t("config.caching.conversationHistoryThresholdDescription")}</p>
										</div>
									</div>
									<div className="space-y-2">
										<div className="flex h-fit items-center justify-between space-x-2 rounded-sm border p-3">
											<div className="space-y-0.5">
												<Label className="text-sm font-medium">{t("config.caching.excludeSystemPrompt")}</Label>
												<p className="text-muted-foreground text-xs">{t("config.caching.excludeSystemPromptDescription")}</p>
											</div>
											<Switch
												data-testid="caching-exclude-system-prompt-switch"
												checked={cacheConfig.exclude_system_prompt || false}
												onCheckedChange={(checked) => updateLocal({ exclude_system_prompt: checked })}
												size="md"
											/>
										</div>
									</div>
								</div>

								{/* Cache Behavior applies to both modes. */}
								<div className="space-y-4">
									<h3 className="text-sm font-medium">{t("config.caching.cacheKeyComposition")}</h3>
									<div className="space-y-3">
										<div className="flex items-center justify-between space-x-2 rounded-sm border p-3">
											<div className="space-y-0.5">
												<Label className="text-sm font-medium">{t("config.caching.cacheByModel")}</Label>
												<p className="text-muted-foreground text-xs">{t("config.caching.cacheByModelDescription")}</p>
											</div>
											<Switch
												data-testid="caching-cache-by-model-switch"
												checked={cacheConfig.cache_by_model}
												onCheckedChange={(checked) => updateLocal({ cache_by_model: checked })}
												size="md"
											/>
										</div>
										<div className="flex items-center justify-between space-x-2 rounded-sm border p-3">
											<div className="space-y-0.5">
												<Label className="text-sm font-medium">{t("config.caching.cacheByProvider")}</Label>
												<p className="text-muted-foreground text-xs">{t("config.caching.cacheByProviderDescription")}</p>
											</div>
											<Switch
												data-testid="caching-cache-by-provider-switch"
												checked={cacheConfig.cache_by_provider}
												onCheckedChange={(checked) => updateLocal({ cache_by_provider: checked })}
												size="md"
											/>
										</div>
									</div>
								</div>

								<div className="space-y-2">
									<Label className="text-sm font-medium">{t("config.caching.perRequestOverrides")}</Label>
									<ul className="text-muted-foreground list-inside list-disc text-xs">
										<li dangerouslySetInnerHTML={{ __html: t("config.caching.overrideCacheKey") }} />
										<li dangerouslySetInnerHTML={{ __html: t("config.caching.overrideCacheTtl") }} />
										<li dangerouslySetInnerHTML={{ __html: t("config.caching.overrideCacheThreshold") }} />
										<li dangerouslySetInnerHTML={{ __html: t("config.caching.overrideCacheType") }} />
										<li dangerouslySetInnerHTML={{ __html: t("config.caching.overrideCacheNoStore") }} />
									</ul>
								</div>
							</div>

							<div className="flex justify-end pt-2">
								<Button
									data-testid="caching-save-button"
									onClick={handleSave}
									disabled={!hasUnsavedConfigChanges || isSaving || Boolean(validationError)}
								>
									{isSaving ? t("common.saving") : t("config.caching.saveChanges")}
								</Button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}