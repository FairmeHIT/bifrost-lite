import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DottedSeparator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { RenderProviderIcon } from "@/lib/constants/icons";
import { ProviderLabels, ProviderName, RequestTypeLabels } from "@/lib/constants/logs";
import {
	getErrorMessage,
	ModelDefaultParameters,
	ModelDetails,
	ModelPricingOverrideSummary,
	useGetCoreConfigQuery,
	useGetProviderQuery,
	useUpsertModelCatalogEntriesMutation,
} from "@/lib/store";
import { KnownProvider } from "@/lib/types/config";
import { PricingOverrideScopeKind } from "@/lib/types/governance";
import { formatCharacterPriceFull, formatTokenPriceFull } from "@/lib/utils/numbers";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fieldLabelByKey, PricingFieldKey, pricingFieldUnit } from "../../custom-pricing/overrides/pricingFields";
import OverriddenPrice from "./overriddenPrice";

const DEFAULT_PRICING_SOURCE_URL = "https://getbifrost.ai/datasheet";

// Scopes whose overrides can't be resolved from the model catalog alone — they
// only apply to requests carrying the matching virtual key, user, or provider
// key, so they are listed here but never change the displayed price.
const SCOPE_CAVEATS: Partial<Record<PricingOverrideScopeKind, string>> = {
	provider_key: "modelCatalog.overrides.scopeCaveatProviderKey",
	virtual_key: "modelCatalog.overrides.scopeCaveatVirtualKey",
	virtual_key_provider: "modelCatalog.overrides.scopeCaveatVirtualKeyProvider",
	virtual_key_provider_key: "modelCatalog.overrides.scopeCaveatVirtualKeyProviderKey",
	user: "modelCatalog.overrides.scopeCaveatUser",
	user_provider: "modelCatalog.overrides.scopeCaveatUserProvider",
	user_provider_key: "modelCatalog.overrides.scopeCaveatUserProviderKey",
};

interface AttributeSheetProps {
	model: ModelDetails;
	/** Overrides referenced by `model.pricing_override_ids`, keyed by ID. */
	overrides?: Record<string, ModelPricingOverrideSummary>;
	onClose: () => void;
}

// Local row type for the extra-attributes editor. We keep these outside any
// schema because empty rows are valid during editing — we filter them at
// submit time. The id is a render-stable identifier (not persisted) so React
// keeps DOM nodes pinned to the right row across add/remove.
interface AttributeRow {
	id: string;
	key: string;
	value: string;
}

let rowIdCounter = 0;
function newRowId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	rowIdCounter += 1;
	return `row-${rowIdCounter}`;
}

function rowsFromAttributes(attrs?: Record<string, string>): AttributeRow[] {
	if (!attrs) return [];
	return Object.entries(attrs)
		.filter(([k]) => k !== "description")
		.map(([key, value]) => ({ id: newRowId(), key, value }));
}

function isLinkableSource(url: string) {
	return url.startsWith("http://") || url.startsWith("https://");
}

// Canonical reasoning-effort values offered when the provider does not declare
// its accepted levels via custom_provider_config.reasoning_effort_levels.
const DEFAULT_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh", "max"];

// Custom default-parameter keys the gateway refuses (mirrors the Go
// denylist): request-shape fields that must never be overridable, and the
// structured defaults that have their own dedicated inputs above.
const RESERVED_PARAM_KEYS = new Set([
	"model",
	"messages",
	"stream",
	"provider",
	"fallbacks",
	"tools",
	"tool_choice",
	"temperature",
	"top_p",
	"frequency_penalty",
	"max_tokens",
	"max_completion_tokens",
	"reasoning",
	"reasoning_effort",
	"reasoning_max_tokens",
]);

// Numeric fields of the defaults form: string while editing ("" = unset),
// parsed and validated at submit.
interface DefaultsFormState {
	temperature: string;
	top_p: string;
	frequency_penalty: string;
	max_tokens: string;
	reasoning_effort: string;
	reasoning_max_tokens: string;
}

const EMPTY_DEFAULTS_FORM: DefaultsFormState = {
	temperature: "",
	top_p: "",
	frequency_penalty: "",
	max_tokens: "",
	reasoning_effort: "",
	reasoning_max_tokens: "",
};

function defaultsToForm(dp?: ModelDefaultParameters): DefaultsFormState {
	if (!dp) return { ...EMPTY_DEFAULTS_FORM };
	const num = (v?: number) => (v === undefined || v === null ? "" : String(v));
	return {
		temperature: num(dp.temperature),
		top_p: num(dp.top_p),
		frequency_penalty: num(dp.frequency_penalty),
		max_tokens: num(dp.max_tokens),
		reasoning_effort: dp.reasoning_effort ?? "",
		reasoning_max_tokens: num(dp.reasoning_max_tokens),
	};
}

// Builds the wire payload from the form. Returns undefined when nothing is
// set — an omitted default_parameters clears the stored column.
function formToDefaults(
	form: DefaultsFormState,
	customRows: AttributeRow[],
): { defaults?: ModelDefaultParameters; error?: { key: string; params?: Record<string, string> } } {
	const out: ModelDefaultParameters = {};
	// Numeric default fields: edited as strings, assigned as numbers.
	// Integer fields (token caps) reject fractions up front rather than
	// surfacing a backend unmarshal error after the round-trip.
	type NumericDefaultKey = "temperature" | "top_p" | "frequency_penalty" | "max_tokens" | "reasoning_max_tokens";
	const integerFields: Partial<Record<NumericDefaultKey, boolean>> = {
		max_tokens: true,
		reasoning_max_tokens: true,
	};
	const numeric: Array<[keyof DefaultsFormState, NumericDefaultKey]> = [
		["temperature", "temperature"],
		["top_p", "top_p"],
		["frequency_penalty", "frequency_penalty"],
		["max_tokens", "max_tokens"],
		["reasoning_max_tokens", "reasoning_max_tokens"],
	];
	for (const [formKey, wireKey] of numeric) {
		const raw = form[formKey].trim();
		if (raw === "") continue;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			return { error: { key: "modelCatalog.attributes.validationInvalidNumber", params: { field: formKey } } };
		}
		if (integerFields[wireKey] && !Number.isInteger(parsed)) {
			return { error: { key: "modelCatalog.attributes.validationInvalidNumber", params: { field: formKey } } };
		}
		out[wireKey] = parsed;
	}
	if (form.reasoning_effort !== "") {
		out.reasoning_effort = form.reasoning_effort;
	}

	const cleaned = customRows.map((r) => ({ key: r.key.trim(), value: r.value })).filter((r) => r.key !== "" || r.value !== "");
	const custom: Record<string, string> = {};
	for (const r of cleaned) {
		if (RESERVED_PARAM_KEYS.has(r.key)) {
			return { error: { key: "modelCatalog.attributes.validationReservedParamKey", params: { key: r.key } } };
		}
		if (custom[r.key] !== undefined) {
			return { error: { key: "modelCatalog.attributes.validationDuplicateKey", params: { key: r.key } } };
		}
		custom[r.key] = r.value;
	}
	if (Object.keys(custom).length > 0) out.custom = custom;

	if (Object.keys(out).length === 0) return {};
	return { defaults: out };
}

function getPricingSourceUrl(configuredUrl: string | undefined, modelName: string) {
	if (configuredUrl) return configuredUrl;
	const url = new URL(DEFAULT_PRICING_SOURCE_URL);
	url.searchParams.set("model", modelName);
	return url.toString();
}

// formatPatchValue renders a patch value in its field's own unit: the way the
// pricing table does for token-priced fields, as a bare multiplier for the geo
// multiplier, and as a plain dollar amount for everything else (per-image,
// per-second, per-page, …).
function formatPatchValue(key: string, value: number): string {
	switch (pricingFieldUnit(key)) {
		case "token":
			return formatTokenPriceFull(value);
		case "character":
			return formatCharacterPriceFull(value);
		case "multiplier":
			return `${value}×`;
		default:
			return `$${value}`;
	}
}

export default function AttributeSheet({ model, overrides, onClose }: AttributeSheetProps) {
	const { t } = useI18n();
	const [isOpen, setIsOpen] = useState(true);
	const hasUpdateAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });

	const [upsertEntries, { isLoading }] = useUpsertModelCatalogEntriesMutation();

	const initialDescription = model.additional_attributes?.description ?? "";
	const [description, setDescription] = useState(initialDescription);

	// Overrides arrive as IDs into a response-level index; skip any that went
	// missing (e.g. deleted in another tab before this list refreshed).
	const matchingOverrides = useMemo(
		() => (model.pricing_override_ids ?? []).map((id) => overrides?.[id]).filter((o): o is ModelPricingOverrideSummary => !!o),
		[model.pricing_override_ids, overrides],
	);
	const appliedOverrideName = model.applied_override_id ? overrides?.[model.applied_override_id]?.name : undefined;

	const initialRows = useMemo(() => rowsFromAttributes(model.additional_attributes), [model.additional_attributes]);
	const stripIds = (rows: AttributeRow[]) => rows.map(({ key, value }) => ({ key, value }));
	const [initialRowsKey] = useState(() => JSON.stringify(stripIds(initialRows)));
	const [extraRows, setExtraRows] = useState<AttributeRow[]>(initialRows);

	// Request-parameter defaults. Numeric fields are edited as strings (""
	// = unset) and parsed at submit; custom rows reuse the AttributeRow shape.
	const [defaultsForm, setDefaultsForm] = useState<DefaultsFormState>(() => defaultsToForm(model.default_parameters));
	const initialCustomParamRows = useMemo(
		() => Object.entries(model.default_parameters?.custom ?? {}).map(([key, value]) => ({ id: newRowId(), key, value })),
		[model.default_parameters],
	);
	const [customParamRows, setCustomParamRows] = useState<AttributeRow[]>(initialCustomParamRows);
	const [initialDefaultsKey] = useState(() =>
		JSON.stringify(formToDefaults(defaultsToForm(model.default_parameters), initialCustomParamRows).defaults ?? null),
	);

	const handleDefaultsChange = (field: keyof DefaultsFormState, val: string) => setDefaultsForm((prev) => ({ ...prev, [field]: val }));
	const handleAddParamRow = () => setCustomParamRows((prev) => [...prev, { id: newRowId(), key: "", value: "" }]);
	const handleParamRowChange = (id: string, field: "key" | "value", val: string) =>
		setCustomParamRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
	const handleRemoveParamRow = (id: string) => setCustomParamRows((prev) => prev.filter((row) => row.id !== id));

	const defaultsDirty = JSON.stringify(formToDefaults(defaultsForm, customParamRows).defaults ?? null) !== initialDefaultsKey;
	const rowsDirty = JSON.stringify(stripIds(extraRows)) !== initialRowsKey;
	const isDirty = description !== initialDescription || rowsDirty || defaultsDirty;

	// Reasoning-effort options come from the provider's declared levels when
	// it is a custom provider that clamps; otherwise offer the canonical set.
	const { data: providerData } = useGetProviderQuery(model.provider);
	const effortOptions = useMemo(() => {
		const declared = providerData?.custom_provider_config?.reasoning_effort_levels;
		return declared && declared.length > 0 ? declared : DEFAULT_EFFORT_OPTIONS;
	}, [providerData]);
	const pricingSourceUrl = getPricingSourceUrl(bifrostConfig?.framework_config?.pricing_url, model.name);
	const canOpenPricingSource = isLinkableSource(pricingSourceUrl);

	const handleClose = () => {
		setIsOpen(false);
		setTimeout(() => onClose(), 150);
	};

	const handleAddRow = () => setExtraRows((prev) => [...prev, { id: newRowId(), key: "", value: "" }]);
	const handleRowChange = (id: string, field: "key" | "value", val: string) =>
		setExtraRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
	const handleRemoveRow = (id: string) => setExtraRows((prev) => prev.filter((row) => row.id !== id));

	const handleSubmit = async () => {
		if (!hasUpdateAccess) {
			toast.error(t("modelCatalog.attributes.noPermission"));
			return;
		}

		// Validate that extra rows have non-empty keys when they have any value.
		// Empty rows are fine — we drop them.
		const cleaned = extraRows.map((r) => ({ key: r.key.trim(), value: r.value })).filter((r) => r.key !== "" || r.value !== "");
		const missingKey = cleaned.find((r) => r.key === "");
		if (missingKey) {
			toast.error(t("modelCatalog.attributes.validationMissingKey"));
			return;
		}
		const dupKey = cleaned.find((r, i) => cleaned.findIndex((other) => other.key === r.key) !== i);
		if (dupKey) {
			toast.error(t("modelCatalog.attributes.validationDuplicateKey", { key: dupKey.key }));
			return;
		}
		// "description" is the special-cased field above — disallow it as an extra row.
		const reservedClash = cleaned.find((r) => r.key === "description");
		if (reservedClash) {
			toast.error(t("modelCatalog.attributes.validationReservedKey"));
			return;
		}

		const attributes: Record<string, string> = {};
		const desc = description.trim();
		if (desc !== "") attributes.description = desc;
		for (const r of cleaned) attributes[r.key] = r.value;

		// Validate + build the request-parameter defaults. Errors surface as
		// toasts, same as the attribute-row validation above.
		const { defaults, error: defaultsError } = formToDefaults(defaultsForm, customParamRows);
		if (defaultsError) {
			toast.error(t(defaultsError.key, defaultsError.params));
			return;
		}

		try {
			await upsertEntries([
				{
					model: model.name,
					provider: model.provider,
					additional_attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
					default_parameters: defaults,
				},
			]).unwrap();
			toast.success(t("modelCatalog.attributes.saved"));
			handleClose();
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
			<SheetContent
				className="flex w-full flex-col overflow-x-hidden pt-4"
				onInteractOutside={(e) => {
					if (isDirty) e.preventDefault();
				}}
				onEscapeKeyDown={(e) => {
					if (isDirty) e.preventDefault();
				}}
				data-testid="model-catalog-attribute-sheet"
			>
				<SheetHeader className="flex flex-col items-start p-0 px-8 py-4" headerClassName="mb-0 sticky -top-4 bg-surface-solid z-10">
					<SheetTitle>{t("modelCatalog.attributes.sheetTitle")}</SheetTitle>
					<SheetDescription>{t("modelCatalog.attributes.sheetDescription")}</SheetDescription>
				</SheetHeader>

				<div className="flex h-full flex-col gap-6">
					<div className="grow space-y-4 px-8">
						{/* Read-only provider / model header */}
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Label className="text-sm font-medium">{t("modelCatalog.attributes.providerLabel")}</Label>
								<div className="bg-muted/30 mt-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-sm">
									<RenderProviderIcon provider={model.provider as KnownProvider} size="sm" className="h-4 w-4" />
									<span>{ProviderLabels[model.provider as ProviderName] || model.provider}</span>
								</div>
							</div>
							<div>
								<Label className="text-sm font-medium">{t("modelCatalog.attributes.modelLabel")}</Label>
								<div className="bg-muted/30 mt-2 rounded-sm border px-3 py-2 font-mono text-sm">{model.name}</div>
							</div>
						</div>

						<DottedSeparator />

						{/* Pricing */}
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-3">
								<Label className="text-sm font-medium">{t("modelCatalog.pricing.pricingLabel")}</Label>
								{canOpenPricingSource ? (
									<a
										href={pricingSourceUrl}
										target="_blank"
										rel="noreferrer"
										className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
										data-testid="model-catalog-pricing-source-link"
									>
										{t("modelCatalog.pricing.source")}
										<ExternalLink className="h-3 w-3" />
									</a>
								) : (
									<span className="text-muted-foreground max-w-[260px] truncate text-right font-mono text-xs" title={pricingSourceUrl}>
										{pricingSourceUrl}
									</span>
								)}
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div className="bg-muted/30 rounded-sm border px-3 py-2">
									<p className="text-muted-foreground text-xs">{t("modelCatalog.pricing.input")}</p>
									<p className="mt-1 font-mono text-sm" data-testid="model-catalog-input-cost">
										<OverriddenPrice
											variant="full"
											base={model.input_cost_per_token}
											override={model.overridden_pricing?.input_cost_per_token}
											overrideName={appliedOverrideName}
										/>
									</p>
								</div>
								<div className="bg-muted/30 rounded-sm border px-3 py-2">
									<p className="text-muted-foreground text-xs">{t("modelCatalog.pricing.output")}</p>
									<p className="mt-1 font-mono text-sm" data-testid="model-catalog-output-cost">
										<OverriddenPrice
											variant="full"
											base={model.output_cost_per_token}
											override={model.overridden_pricing?.output_cost_per_token}
											overrideName={appliedOverrideName}
										/>
									</p>
								</div>
								<div className="bg-muted/30 rounded-sm border px-3 py-2">
									<p className="text-muted-foreground text-xs">{t("modelCatalog.pricing.cacheWrite")}</p>
									<p className="mt-1 font-mono text-sm" data-testid="model-catalog-cache-write-cost">
										<OverriddenPrice
											variant="full"
											base={model.cache_creation_input_token_cost}
											override={model.overridden_pricing?.cache_creation_input_token_cost}
											overrideName={appliedOverrideName}
										/>
									</p>
								</div>
								<div className="bg-muted/30 rounded-sm border px-3 py-2">
									<p className="text-muted-foreground text-xs">{t("modelCatalog.pricing.cacheRead")}</p>
									<p className="mt-1 font-mono text-sm" data-testid="model-catalog-cache-read-cost">
										<OverriddenPrice
											variant="full"
											base={model.cache_read_input_token_cost}
											override={model.overridden_pricing?.cache_read_input_token_cost}
											overrideName={appliedOverrideName}
										/>
									</p>
								</div>
							</div>
						</div>

						{matchingOverrides.length > 0 && (
							<>
								<DottedSeparator />

								{/* Pricing overrides */}
								<div className="space-y-3" data-testid="model-catalog-pricing-overrides">
									<div className="flex items-center justify-between gap-3">
										<Label className="text-sm font-medium">{t("modelCatalog.overrides.overridesLabel")}</Label>
										<Link
											to="/workspace/custom-pricing/overrides"
											className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
										>
											{t("modelCatalog.overrides.manage")}
											<ExternalLink className="h-3 w-3" />
										</Link>
									</div>
									{matchingOverrides.map((override) => {
										const caveat = SCOPE_CAVEATS[override.scope_kind];
										const patchEntries = Object.entries(override.patch).filter(([, value]) => value !== undefined && value !== null);
										return (
											<div
												key={override.id}
												className="bg-muted/30 space-y-2 rounded-sm border px-3 py-2"
												data-testid={`model-catalog-pricing-override-${override.id}`}
											>
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-sm font-medium">{override.name || override.id}</span>
													<Badge variant="secondary">{override.scope_kind}</Badge>
													{override.id === model.applied_override_id && (
														<Badge variant="outline">{t("modelCatalog.overrides.applied")}</Badge>
													)}
												</div>
												<p className="text-muted-foreground font-mono text-xs">
													{override.match_type === "wildcard" ? t("modelCatalog.overrides.matches") : t("modelCatalog.overrides.exact")}{" "}
													{override.pattern}
												</p>
												{caveat && <p className="text-muted-foreground text-xs">{t(caveat)}</p>}
												{override.request_types && override.request_types.length > 0 && (
													<div className="flex flex-wrap gap-1">
														{override.request_types.map((rt) => (
															<Badge key={rt} variant="outline" className="text-[10px]">
																{RequestTypeLabels[rt as keyof typeof RequestTypeLabels] ?? rt}
															</Badge>
														))}
													</div>
												)}
												{patchEntries.length > 0 && (
													<div className="space-y-1">
														{patchEntries.map(([key, value]) => (
															<div key={key} className="flex items-baseline justify-between gap-3 text-xs">
																<span className="text-muted-foreground">{fieldLabelByKey[key as PricingFieldKey] || key}</span>
																<span className="font-mono">{formatPatchValue(key, value as number)}</span>
															</div>
														))}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</>
						)}

						<DottedSeparator />

						{/* Description */}
						<div>
							<Label className="text-sm font-medium">{t("common.description")}</Label>
							<Textarea
								className="mt-2"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={4}
								placeholder={t("modelCatalog.attributes.descriptionPlaceholder")}
								data-testid="model-catalog-description-textarea"
							/>
						</div>

						<DottedSeparator />

						{/* Request parameter defaults */}
						<div className="space-y-3">
							<div>
								<Label className="text-sm font-medium">{t("modelCatalog.attributes.defaultsLabel")}</Label>
								<p className="text-muted-foreground mt-1 text-xs">{t("modelCatalog.attributes.defaultsDescription")}</p>
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs">{t("modelCatalog.attributes.defaultsReasoningEffort")}</Label>
									<Select
										value={defaultsForm.reasoning_effort || "__unset__"}
										onValueChange={(v) => handleDefaultsChange("reasoning_effort", v === "__unset__" ? "" : v)}
									>
										<SelectTrigger className="w-full" data-testid="model-catalog-defaults-reasoning-effort">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="__unset__">{t("modelCatalog.attributes.defaultsUnset")}</SelectItem>
											{effortOptions.map((level) => (
												<SelectItem key={level} value={level}>
													{level}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs" htmlFor="model-catalog-defaults-temperature">
										{t("modelCatalog.attributes.defaultsTemperature")}
									</Label>
									<Input
										id="model-catalog-defaults-temperature"
										type="number"
										step="0.1"
										value={defaultsForm.temperature}
										onChange={(e) => handleDefaultsChange("temperature", e.target.value)}
										placeholder={t("modelCatalog.attributes.defaultsUnset")}
										data-testid="model-catalog-defaults-temperature"
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs" htmlFor="model-catalog-defaults-top-p">
										{t("modelCatalog.attributes.defaultsTopP")}
									</Label>
									<Input
										id="model-catalog-defaults-top-p"
										type="number"
										step="0.05"
										value={defaultsForm.top_p}
										onChange={(e) => handleDefaultsChange("top_p", e.target.value)}
										placeholder={t("modelCatalog.attributes.defaultsUnset")}
										data-testid="model-catalog-defaults-top-p"
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs" htmlFor="model-catalog-defaults-frequency-penalty">
										{t("modelCatalog.attributes.defaultsFrequencyPenalty")}
									</Label>
									<Input
										id="model-catalog-defaults-frequency-penalty"
										type="number"
										step="0.1"
										value={defaultsForm.frequency_penalty}
										onChange={(e) => handleDefaultsChange("frequency_penalty", e.target.value)}
										placeholder={t("modelCatalog.attributes.defaultsUnset")}
										data-testid="model-catalog-defaults-frequency-penalty"
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs" htmlFor="model-catalog-defaults-max-tokens">
										{t("modelCatalog.attributes.defaultsMaxTokens")}
									</Label>
									<Input
										id="model-catalog-defaults-max-tokens"
										type="number"
										step="1"
										value={defaultsForm.max_tokens}
										onChange={(e) => handleDefaultsChange("max_tokens", e.target.value)}
										placeholder={t("modelCatalog.attributes.defaultsUnset")}
										data-testid="model-catalog-defaults-max-tokens"
									/>
								</div>
								<div className="space-y-1.5">
									<Label className="text-muted-foreground text-xs" htmlFor="model-catalog-defaults-reasoning-max-tokens">
										{t("modelCatalog.attributes.defaultsReasoningMaxTokens")}
									</Label>
									<Input
										id="model-catalog-defaults-reasoning-max-tokens"
										type="number"
										step="1"
										value={defaultsForm.reasoning_max_tokens}
										onChange={(e) => handleDefaultsChange("reasoning_max_tokens", e.target.value)}
										placeholder={t("modelCatalog.attributes.defaultsUnset")}
										data-testid="model-catalog-defaults-reasoning-max-tokens"
									/>
								</div>
							</div>

							{/* Custom default parameters */}
							<div className="space-y-2 pt-1">
								<div className="flex items-center justify-between">
									<Label className="text-sm font-medium">{t("modelCatalog.attributes.defaultsCustomLabel")}</Label>
									<Button type="button" variant="outline" size="sm" onClick={handleAddParamRow} data-testid="model-catalog-add-param-row">
										<Plus className="mr-1 h-3 w-3" />
										{t("modelCatalog.attributes.addButton")}
									</Button>
								</div>
								{customParamRows.length === 0 ? (
									<p className="text-muted-foreground text-xs">{t("modelCatalog.attributes.defaultsCustomNoRows")}</p>
								) : (
									<div className="space-y-2">
										{customParamRows.map((row, i) => (
											<div key={row.id} className="flex items-start gap-2">
												<Input
													value={row.key}
													onChange={(e) => handleParamRowChange(row.id, "key", e.target.value)}
													placeholder={t("modelCatalog.attributes.keyPlaceholder")}
													className="flex-1"
													data-testid={`model-catalog-param-key-${i}`}
												/>
												<Input
													value={row.value}
													onChange={(e) => handleParamRowChange(row.id, "value", e.target.value)}
													placeholder={t("modelCatalog.attributes.valuePlaceholder")}
													className="flex-1"
													data-testid={`model-catalog-param-value-${i}`}
												/>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													onClick={() => handleRemoveParamRow(row.id)}
													data-testid={`model-catalog-param-remove-${i}`}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
								)}
							</div>
						</div>

						<DottedSeparator />

						{/* Other attributes */}
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<Label className="text-sm font-medium">{t("modelCatalog.attributes.otherAttributesLabel")}</Label>
								<Button type="button" variant="outline" size="sm" onClick={handleAddRow} data-testid="model-catalog-add-attribute-row">
									<Plus className="mr-1 h-3 w-3" />
									{t("modelCatalog.attributes.addButton")}
								</Button>
							</div>
							{extraRows.length === 0 ? (
								<p className="text-muted-foreground text-xs">{t("modelCatalog.attributes.noAdditionalAttributes")}</p>
							) : (
								<div className="space-y-2">
									{extraRows.map((row, i) => (
										<div key={row.id} className="flex items-start gap-2">
											<Input
												value={row.key}
												onChange={(e) => handleRowChange(row.id, "key", e.target.value)}
												placeholder={t("modelCatalog.attributes.keyPlaceholder")}
												className="flex-1"
												data-testid={`model-catalog-attribute-key-${i}`}
											/>
											<Input
												value={row.value}
												onChange={(e) => handleRowChange(row.id, "value", e.target.value)}
												placeholder={t("modelCatalog.attributes.valuePlaceholder")}
												className="flex-1"
												data-testid={`model-catalog-attribute-value-${i}`}
											/>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => handleRemoveRow(row.id)}
												data-testid={`model-catalog-attribute-remove-${i}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					<div className="bg-surface-solid sticky bottom-0 shrink-0 border-t px-8 py-4">
						<div className="flex items-center justify-end gap-3">
							{!hasUpdateAccess && <p className="text-destructive text-sm">{t("modelCatalog.attributes.noPermission")}</p>}
							<Button type="button" variant="outline" onClick={handleClose} data-testid="model-catalog-attribute-cancel">
								{t("common.cancel")}
							</Button>
							<Button
								type="button"
								onClick={handleSubmit}
								disabled={isLoading || !isDirty || !hasUpdateAccess}
								data-testid="model-catalog-attribute-submit"
							>
								{isLoading ? t("common.saving") : t("modelCatalog.attributes.saveChanges")}
							</Button>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}