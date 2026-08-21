import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/context";
import { BaseProvider, RequestType } from "@/lib/types/config";
import { isRequestTypeDisabled } from "@/lib/utils/validation";
import { Settings2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Control, useFormContext } from "react-hook-form";

interface AllowedRequestsFieldsProps {
	control: Control<any>;
	namePrefix?: string;
	pathOverridesPrefix?: string;
	providerType?: BaseProvider;
	disabled?: boolean;
}

// Provider-specific endpoint paths
const ProviderEndpoints: Partial<Record<BaseProvider, Partial<Record<RequestType, string>>>> = {
	openai: {
		list_models: "/v1/models",
		text_completion: "/v1/completions",
		text_completion_stream: "/v1/completions",
		chat_completion: "/v1/chat/completions",
		chat_completion_stream: "/v1/chat/completions",
		responses: "/v1/responses",
		responses_stream: "/v1/responses",
		embedding: "/v1/embeddings",
		speech: "/v1/audio/speech",
		speech_stream: "/v1/audio/speech",
		transcription: "/v1/audio/transcriptions",
		transcription_stream: "/v1/audio/transcriptions",
		image_generation: "/v1/images/generations",
		image_generation_stream: "/v1/images/generations",
		image_edit: "/v1/images/edits",
		image_edit_stream: "/v1/images/edits",
		image_variation: "/v1/images/variations",
		count_tokens: "/v1/responses/tokens",
	},
	anthropic: {
		chat_completion: "/v1/messages",
		chat_completion_stream: "/v1/messages",
		responses: "/v1/messages",
		responses_stream: "/v1/messages",
	},
	cohere: {
		chat_completion: "/v2/chat",
		chat_completion_stream: "/v2/chat",
		responses: "/v2/chat",
		responses_stream: "/v2/chat",
		embedding: "/v2/embed",
	},
};

// Helper function to get the appropriate placeholder
const getPlaceholder = (providerType: BaseProvider | undefined, requestKey: RequestType): string => {
	if (providerType && ProviderEndpoints[providerType]?.[requestKey]) {
		return ProviderEndpoints[providerType][requestKey]!;
	}
	return ProviderEndpoints["openai"]?.[requestKey] ?? "";
};

const getRequestTypes = (
	t: (path: string, params?: Record<string, string | number>) => string,
): Array<{ key: RequestType; label: string }> => [
	{ key: "list_models", label: t("providers.requestTypes.listModels") },
	{ key: "text_completion", label: t("providers.requestTypes.textCompletion") },
	{ key: "text_completion_stream", label: t("providers.requestTypes.textCompletionStream") },
	{ key: "chat_completion", label: t("providers.requestTypes.chatCompletion") },
	{ key: "chat_completion_stream", label: t("providers.requestTypes.chatCompletionStream") },
	{ key: "responses", label: t("providers.requestTypes.responses") },
	{ key: "responses_stream", label: t("providers.requestTypes.responsesStream") },
	{ key: "responses_retrieve", label: t("providers.requestTypes.responsesRetrieve") },
	{ key: "responses_delete", label: t("providers.requestTypes.responsesDelete") },
	{ key: "responses_cancel", label: t("providers.requestTypes.responsesCancel") },
	{ key: "responses_input_items", label: t("providers.requestTypes.responsesInputItems") },
	{ key: "embedding", label: t("providers.requestTypes.embedding") },
	{ key: "speech", label: t("providers.requestTypes.speech") },
	{ key: "speech_stream", label: t("providers.requestTypes.speechStream") },
	{ key: "transcription", label: t("providers.requestTypes.transcription") },
	{ key: "transcription_stream", label: t("providers.requestTypes.transcriptionStream") },
	{ key: "image_generation", label: t("providers.requestTypes.imageGeneration") },
	{ key: "image_generation_stream", label: t("providers.requestTypes.imageGenerationStream") },
	{ key: "image_edit", label: t("providers.requestTypes.imageEdit") },
	{ key: "image_edit_stream", label: t("providers.requestTypes.imageEditStream") },
	{ key: "image_variation", label: t("providers.requestTypes.imageVariation") },
	{ key: "count_tokens", label: t("providers.requestTypes.countTokens") },
];

// Path overrides replace the default path verbatim; these request paths embed the
// response ID, so an override can never produce a valid URL for them.
const PathOverrideUnsupported = new Set<RequestType>([
	"responses_retrieve",
	"responses_delete",
	"responses_cancel",
	"responses_input_items",
]);

export function AllowedRequestsFields({
	control,
	namePrefix = "allowed_requests",
	pathOverridesPrefix = "request_path_overrides",
	providerType,
	disabled = false,
}: AllowedRequestsFieldsProps) {
	const { t } = useI18n();
	const requestTypes = useMemo(() => getRequestTypes(t), [t]);
	const leftColumn = requestTypes.slice(0, requestTypes.length / 2);
	const rightColumn = requestTypes.slice(requestTypes.length / 2);
	const { getValues, setValue } = useFormContext();

	// Reset disabled fields when providerType changes
	useEffect(() => {
		requestTypes.forEach(({ key }) => {
			const fieldName = `${namePrefix}.${key}`;
			setValue(fieldName, !isRequestTypeDisabled(providerType, key), { shouldDirty: true });
		});
	}, [providerType, namePrefix, setValue, getValues]);

	const isPathOverrideDisabled = useMemo(() => providerType === "gemini" || providerType === "bedrock", [providerType]);

	const renderRequestField = (requestType: { key: RequestType; label: string }) => {
		const isDisabled = isRequestTypeDisabled(providerType, requestType.key);
		const placeholder = getPlaceholder(providerType, requestType.key);

		return (
			<FormField
				key={requestType.key}
				control={control}
				name={`${namePrefix}.${requestType.key}`}
				render={({ field: allowedField }) => (
					<FormItem
						className={`flex flex-row items-center justify-between rounded-lg border p-3 ${isDisabled ? "bg-muted/30 opacity-60" : ""}`}
					>
						<div className="space-y-0.5">
							<FormLabel className={isDisabled ? "cursor-not-allowed" : ""}>{requestType.label}</FormLabel>
						</div>
						<div className="flex items-center gap-2">
							{/* Settings icon for path override - only show when enabled */}
							{allowedField.value &&
								!isDisabled &&
								!isPathOverrideDisabled &&
								!disabled &&
								!PathOverrideUnsupported.has(requestType.key) && (
									<FormField
										control={control}
										name={`${pathOverridesPrefix}.${requestType.key}`}
										render={({ field: pathField }) => (
											<Popover>
												<PopoverTrigger asChild>
													<button
														type="button"
														className="text-muted-foreground hover:text-foreground transition-colors"
														aria-label={t("providers.allowedRequests.customizePathAria")}
													>
														<Settings2 className="h-4 w-4" />
													</button>
												</PopoverTrigger>
												<PopoverContent className="w-80" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
													<div className="space-y-2">
														<h4 className="text-sm font-medium">{t("providers.allowedRequests.customPathTitle")}</h4>
														<p className="text-muted-foreground text-xs">{t("providers.allowedRequests.customPathDescription")}</p>
														<Input placeholder={placeholder} {...pathField} value={pathField.value || ""} className="h-9" />
													</div>
												</PopoverContent>
											</Popover>
										)}
									/>
								)}

							<FormControl>
								{isDisabled ? (
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<div>
													<Switch checked={isDisabled ? false : allowedField.value} disabled={true} size="md" />
												</div>
											</TooltipTrigger>
											<TooltipContent>
												<p>{t("providers.allowedRequests.notSupportedBy", { providerType: providerType ?? "" })}</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								) : (
									<Switch checked={allowedField.value} onCheckedChange={allowedField.onChange} size="md" disabled={disabled} />
								)}
							</FormControl>
						</div>
					</FormItem>
				)}
			/>
		);
	};

	return (
		<div className="space-y-4">
			<div>
				<div className="text-sm font-medium">{t("providers.allowedRequests.heading")}</div>
				<p className="text-muted-foreground text-xs">
					{t("providers.allowedRequests.description")} {!isPathOverrideDisabled ? t("providers.allowedRequests.pathOverrideHint") : ""}
				</p>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-3">{leftColumn.map(renderRequestField)}</div>
				<div className="space-y-3">{rightColumn.map(renderRequestField)}</div>
			</div>
		</div>
	);
}