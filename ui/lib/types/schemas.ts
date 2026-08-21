import { KnownProvidersNames } from "@/lib/constants/logs";
import { t } from "@/lib/i18n";
import { isRedacted } from "@/lib/utils/validation";
import { z } from "zod";

// Global error map - turns Zod's default messages into readable, human-friendly ones.
// Individual schemas can still override by passing their own message.
z.config({
	customError: (issue) => {
		if (issue.code === "invalid_type") {
			// Field is missing / undefined
			if (issue.input === undefined || issue.input === null) {
				return t("schemas.required");
			}
			const expected = issue.expected;
			const received = typeof issue.input;
			if (expected === "number") return t("schemas.validNumber");
			if (expected === "string") return t("schemas.validText");
			if (expected === "boolean") return t("schemas.validBoolean");
			return t("schemas.expectedReceived", { expected, received });
		}
		if (issue.code === "too_small") {
			if (issue.origin === "string" && issue.minimum === 1) {
				return t("schemas.required");
			}
			if (issue.origin === "number") {
				return t("schemas.minNumber", { min: Number(issue.minimum) });
			}
			if (issue.origin === "array" && issue.minimum === 1) {
			return t("schemas.atLeastOneItem");
			}
		}
		if (issue.code === "too_big") {
			if (issue.origin === "number") {
				return t("schemas.maxNumber", { max: Number(issue.maximum) });
			}
			if (issue.origin === "string") {
				return t("schemas.maxChars", { max: Number(issue.maximum) });
			}
		}
		if (issue.code === "invalid_format") {
			if (issue.format === "url") return t("schemas.validUrl");
			if (issue.format === "email") return t("schemas.validEmail");
		}
		return undefined; // fall back to Zod default
	},
});

// Base Zod schemas matching the TypeScript types

// Known provider schema
export const knownProviderSchema = z.enum(KnownProvidersNames as unknown as [string, ...string[]]);

// Custom provider name schema (branded type simulation)
export const customProviderNameSchema = z.string().min(1,  { error: () => t("schemas.customProviderNameIsRequired") });

// Model provider name schema (union of known and custom providers)
export const modelProviderNameSchema = z.union([knownProviderSchema, customProviderNameSchema]);

// SecretVar schema - matches the Go SecretVar type from schemas/secretvar.go
export const _secretVarBase = z.object({
	value: z.string().optional(),
	ref: z.string().optional(),
	type: z.enum(["plain_text", "env", "vault"]).optional(),
});

// Extending the base schema
export const secretVarSchema = Object.assign(_secretVarBase, {
	required: (message: string) => _secretVarBase.refine((v) => !!v?.value?.trim() || !!v?.ref?.trim(), message),
});

// Helper to check if a secretVar field has a value or secret reference
function isSecretVarSet(v: { value?: string; ref?: string } | undefined): boolean {
	if (!v) return false;
	return !!v.value?.trim() || !!v.ref?.trim();
}

// Azure key config schema
export const azureKeyConfigSchema = z
	.object({
		_auth_type: z.enum(["api_key", "entra_id", "default_credential"]).optional(),
		endpoint: secretVarSchema.optional(),
		client_id: secretVarSchema.optional(),
		client_secret: secretVarSchema.optional(),
		tenant_id: secretVarSchema.optional(),
		scopes: z.array(z.string()).optional(),
	})
	.refine((data) => isSecretVarSet(data.endpoint), {
		error: () => t("schemas.endpointIsRequired"),
		path: ["endpoint"],
	})
	.refine(
		(data) => {
			// When using Entra ID, all three fields are required
			if (data._auth_type === "entra_id") {
				return isSecretVarSet(data.client_id) && isSecretVarSet(data.client_secret) && isSecretVarSet(data.tenant_id);
			}
			// Otherwise, if any Entra ID field is set, all three must be set
			const hasClientId = isSecretVarSet(data.client_id);
			const hasClientSecret = isSecretVarSet(data.client_secret);
			const hasTenantId = isSecretVarSet(data.tenant_id);
			const anyEntraField = hasClientId || hasClientSecret || hasTenantId;
			if (!anyEntraField) return true;
			return hasClientId && hasClientSecret && hasTenantId;
		},
		{
			error: () => t("schemas.clientIDClientSecretAndTenantIDAreAllRequiredForEntraIDAuthentication"),
			path: ["client_id"],
		},
	);

// Vertex key config schema
export const vertexKeyConfigSchema = z
	.object({
		_auth_type: z.enum(["service_account", "service_account_json", "api_key"]).optional(),
		project_id: secretVarSchema.optional(),
		project_number: secretVarSchema.optional(),
		region: secretVarSchema.optional(),
		auth_credentials: secretVarSchema.optional(),
		force_single_region: z.boolean().optional(),
	})
	.refine((data) => isSecretVarSet(data.project_id), {
		error: () => t("schemas.projectIDIsRequired"),
		path: ["project_id"],
	})
	.refine((data) => isSecretVarSet(data.region), {
		error: () => t("schemas.regionIsRequired"),
		path: ["region"],
	})
	.refine(
		(data) => {
			// When using service_account_json auth, auth_credentials is required
			if (data._auth_type === "service_account_json") {
				return isSecretVarSet(data.auth_credentials);
			}
			return true;
		},
		{
			error: () => t("schemas.authCredentialsIsRequiredForServiceAccountJSONAuthentication"),
			path: ["auth_credentials"],
		},
	);

// S3 bucket configuration for Bedrock batch operations
export const s3BucketConfigSchema = z.object({
	bucket_name: z.string().min(1,  { error: () => t("schemas.bucketNameIsRequired") }),
	prefix: z.string().optional(),
	is_default: z.boolean().optional(),
});

export const batchS3ConfigSchema = z.object({
	buckets: z.array(s3BucketConfigSchema).optional(),
});

// Interface VPC endpoint hosts, one per AWS endpoint service Bifrost dials for Bedrock.
export const bedrockEndpointsSchema = z.object({
	runtime: secretVarSchema.optional(),
	control_plane: secretVarSchema.optional(),
	mantle: secretVarSchema.optional(),
	agent_runtime: secretVarSchema.optional(),
	s3: secretVarSchema.optional(),
});

// Bedrock key config schema
export const bedrockKeyConfigSchema = z
	.object({
		_auth_type: z.enum(["iam_role", "explicit", "api_key"]).optional(),
		access_key: secretVarSchema.optional(),
		secret_key: secretVarSchema.optional(),
		session_token: secretVarSchema.optional(),
		region: secretVarSchema.optional(),
		role_arn: secretVarSchema.optional(),
		external_id: secretVarSchema.optional(),
		session_name: secretVarSchema.optional(),
		batch_role_arn: secretVarSchema.optional(),
		arn: secretVarSchema.optional(),
		project_id: secretVarSchema.optional(),
		batch_s3_config: batchS3ConfigSchema.optional(),
		endpoints: bedrockEndpointsSchema.optional(),
	})
	.refine(
		(data) => {
			// Region is required for Bedrock
			return isSecretVarSet(data.region);
		},
		{
			error: () => t("schemas.regionIsRequired"),
			path: ["region"],
		},
	)
	.refine(
		(data) => {
			// When using explicit credentials, both access_key and secret_key are required
			if (data._auth_type === "explicit") {
				return isSecretVarSet(data.access_key) && isSecretVarSet(data.secret_key);
			}
			// Otherwise, if either is set both must be set
			const hasAccessKey = isSecretVarSet(data.access_key);
			const hasSecretKey = isSecretVarSet(data.secret_key);
			if (!hasAccessKey && !hasSecretKey) return true;
			return hasAccessKey && hasSecretKey;
		},
		{
			error: () => t("schemas.bothAccessKeyAndSecretKeyAreRequiredForExplicitCredentials"),
			path: ["access_key"],
		},
	);

// Bedrock Mantle key config schema (SigV4 credentials; no ARN / batch S3 config)
export const bedrockMantleKeyConfigSchema = z
	.object({
		_auth_type: z.enum(["iam_role", "explicit", "api_key"]).optional(),
		access_key: secretVarSchema.optional(),
		secret_key: secretVarSchema.optional(),
		session_token: secretVarSchema.optional(),
		region: secretVarSchema.optional(),
		role_arn: secretVarSchema.optional(),
		external_id: secretVarSchema.optional(),
		session_name: secretVarSchema.optional(),
		project_id: secretVarSchema.optional(),
		endpoints: bedrockEndpointsSchema.optional(),
	})
	.refine((data) => isSecretVarSet(data.region), {
		error: () => t("schemas.regionIsRequired"),
		path: ["region"],
	})
	.refine(
		(data) => {
			// Explicit auth must carry both keys; a region-only config fails at request time.
			if (data._auth_type === "explicit") {
				return isSecretVarSet(data.access_key) && isSecretVarSet(data.secret_key);
			}
			// If either access_key or secret_key is set, both must be set.
			const hasAccessKey = isSecretVarSet(data.access_key);
			const hasSecretKey = isSecretVarSet(data.secret_key);
			// IAM-role path: both keys empty is valid, but a lone session token cannot sign SigV4.
			if (!hasAccessKey && !hasSecretKey) return !isSecretVarSet(data.session_token);
			return hasAccessKey && hasSecretKey;
		},
		{
			error: () => t("schemas.bothAccessKeyAndSecretKeyAreRequiredForExplicitCredentials"),
			path: ["access_key"],
		},
	);

// VLLM key config schema
export const vllmKeyConfigSchema = z
	.object({
		url: secretVarSchema.optional(),
		model_name: z.string().trim().min(1,  { error: () => t("schemas.modelNameIsRequired") }),
	})
	.refine((data) => isSecretVarSet(data.url), {
		error: () => t("schemas.serverURLIsRequired"),
		path: ["url"],
	});

export const replicateKeyConfigSchema = z.object({
	use_deployments_endpoint: z.boolean(),
});

// Ollama key config schema
export const ollamaKeyConfigSchema = z
	.object({
		url: secretVarSchema.optional(),
	})
	.refine((data) => isSecretVarSet(data.url), {
		error: () => t("schemas.serverURLIsRequired"),
		path: ["url"],
	});

// SGL key config schema
export const sglKeyConfigSchema = z
	.object({
		url: secretVarSchema.optional(),
	})
	.refine((data) => isSecretVarSet(data.url), {
		error: () => t("schemas.serverURLIsRequired"),
		path: ["url"],
	});

// Model family enum schema — must mirror schemas.ModelFamily in Go.
export const modelFamilySchema = z.enum([
	"anthropic",
	"openai",
	"mistral",
	"cohere",
	"gemini",
	"gemma",
	"llama",
	"imagen",
	"veo",
	"nova",
	"titan",
]);

// AliasConfig schema — mirrors schemas.AliasConfig with the embedded
// provider sub-configs flattened to top-level optional fields (matches Go's
// embedded-pointer-struct JSON output).
const aliasConfigObjectSchema = z.object({
	model_id: z.string().trim().min(1,  { error: () => t("schemas.modelIDIsRequired") }),
	model_name: z.string().trim().optional(),
	model_family: modelFamilySchema.optional(),
	description: z.string().optional(),
	region: secretVarSchema.optional(),
	// Azure overrides
	api_version: z.string().optional(),
	anthropic_version: z.string().optional(),
	endpoint: secretVarSchema.optional(),
	// Shared per-alias project override (Vertex / Bedrock / Bedrock Mantle)
	project_id: secretVarSchema.optional(),
	// Vertex overrides
	project_number: secretVarSchema.optional(),
	force_single_region: z.boolean().optional(),
	// Bedrock overrides
	inference_profile_arn: secretVarSchema.optional(),
	// Replicate overrides
	use_deployments_endpoint: z.boolean().optional(),
	use_anthropic_endpoints: z.boolean().optional(),
});

// The Go server emits the legacy string wire shape (`{"my-alias": "model-id"}`)
// for aliases that only carry ModelID — see AliasConfig.MarshalJSON. Accept
// both shapes here so edit-time validation doesn't reject hydrated state.
export const aliasConfigSchema = z.preprocess(
	(value) => (typeof value === "string" ? { model_id: value } : value),
	aliasConfigObjectSchema,
);

// Model provider key schema
export const modelProviderKeySchema = z
	.object({
		id: z.string().min(1,  { error: () => t("schemas.idIsRequired") }),
		name: z.string().min(1,  { error: () => t("schemas.nameIsRequired") }),
		value: secretVarSchema.optional(),
		models: z.array(z.string()).optional().default(["*"]),
		blacklisted_models: z.array(z.string()).default([]).optional(),
		weight: z
			.union([z.number(), z.string()])
			.transform((val, ctx) => {
				if (typeof val === "number") return val;
				if (val.trim() === "") return 1.0;
				// Use Number() rather than parseFloat() so that strings like "0.5abc"
				// are rejected outright instead of silently parsing to 0.5.
				const num = Number(val);
				if (!Number.isFinite(num)) {
					ctx.addIssue({
						code: "custom",
						error: () => t("schemas.weightMustBeAValidNumberBetween0And1"),
					});
					return z.NEVER;
				}
				return num;
			})
			.pipe(z.number().min(0,  { error: () => t("schemas.weightMustBeEqualToOrGreaterThan0") }).max(1,  { error: () => t("schemas.weightMustBeEqualToOrLessThan1") })),
		aliases: z.record(z.string(), aliasConfigSchema).optional(),
		azure_key_config: azureKeyConfigSchema.optional(),
		vertex_key_config: vertexKeyConfigSchema.optional(),
		bedrock_key_config: bedrockKeyConfigSchema.optional(),
		bedrock_mantle_key_config: bedrockMantleKeyConfigSchema.optional(),
		vllm_key_config: vllmKeyConfigSchema.optional(),
		replicate_key_config: replicateKeyConfigSchema.optional(),
		ollama_key_config: ollamaKeyConfigSchema.optional(),
		sgl_key_config: sglKeyConfigSchema.optional(),
		use_for_batch_api: z.boolean().optional(),
		use_anthropic_endpoints: z.boolean().optional(),
		enabled: z.boolean().optional(),
	})
	.refine(
		(data) => {
			// Providers with dedicated config that never need a top-level API key
			if (data.vllm_key_config || data.replicate_key_config || data.ollama_key_config || data.sgl_key_config) {
				return true;
			}
			// Bedrock Mantle authenticates via SigV4 (its key config) or a Bearer key — only require
			// a top-level API key when the user explicitly chose the api_key auth method.
			if (data.bedrock_mantle_key_config) {
				if (data.bedrock_mantle_key_config._auth_type === "api_key") {
					return isSecretVarSet(data.value);
				}
				return true;
			}
			// Azure requires API key only when using api_key auth
			if (data.azure_key_config) {
				if (data.azure_key_config._auth_type === "api_key") {
					return isSecretVarSet(data.value);
				}
				return true;
			}
			// Bedrock only requires API key when using api_key auth
			if (data.bedrock_key_config) {
				if (data.bedrock_key_config._auth_type === "api_key") {
					return isSecretVarSet(data.value);
				}
				return true;
			}
			// Vertex requires API key only when using api_key auth
			if (data.vertex_key_config) {
				if (data.vertex_key_config._auth_type === "api_key") {
					return isSecretVarSet(data.value);
				}
				return true;
			}
			// Otherwise, value is required
			return isSecretVarSet(data.value);
		},
		{
			error: () => t("schemas.aPIKeyIsRequired"),
			path: ["value"],
		},
	);

// Network config schema
export const networkConfigSchema = z
	.object({
		base_url: z.union([z.string().url( { error: () => t("schemas.mustBeAValidURL") }), z.string().length(0)]).optional(),
		extra_headers: z.record(z.string(), z.string()).optional(),
		default_request_timeout_in_seconds: z
			.number()
			.min(1,  { error: () => t("schemas.timeoutMustBeGreaterThan0Seconds") })
			.max(3600,  { error: () => t("schemas.timeoutMustBeLessThan3600Seconds") }),
		max_retries: z.number().min(0,  { error: () => t("schemas.maxRetriesMustBeGreaterThan0") }).max(10,  { error: () => t("schemas.maxRetriesMustBeLessThan10") }),
		retry_backoff_initial: z.number().min(100),
		retry_backoff_max: z.number().min(100),
		insecure_skip_verify: z.boolean().optional(),
		ca_cert_pem: secretVarSchema.optional(),
		stream_idle_timeout_in_seconds: z
			.number()
			.int( { error: () => t("schemas.streamIdleTimeoutMustBeAWholeNumberOfSeconds") })
			.min(5,  { error: () => t("schemas.streamIdleTimeoutMustBeAtLeast5Seconds") })
			.max(3600,  { error: () => t("schemas.streamIdleTimeoutMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		keep_alive_timeout_in_seconds: z
			.number()
			.int( { error: () => t("schemas.keepAliveTimeoutMustBeAWholeNumberOfSeconds") })
			.min(1,  { error: () => t("schemas.keepAliveTimeoutMustBeAtLeast1Second") })
			.max(3600,  { error: () => t("schemas.keepAliveTimeoutMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		max_conns_per_host: z
			.number()
			.int( { error: () => t("schemas.maxConnectionsMustBeAWholeNumber") })
			.min(1,  { error: () => t("schemas.maxConnectionsMustBeAtLeast1") })
			.max(10000,  { error: () => t("schemas.maxConnectionsMustBeAtMost10000") })
			.optional(),
		enforce_http2: z.boolean().optional(),
		http2_ping_interval_in_seconds: z
			.number()
			.int( { error: () => t("schemas.hTTP2PingIntervalMustBeAWholeNumberOfSeconds") })
			.min(0,  { error: () => t("schemas.hTTP2PingIntervalMustBeAtLeast0Seconds") })
			.max(3600,  { error: () => t("schemas.hTTP2PingIntervalMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		allow_private_network: z.boolean().optional(),
	})
	.refine((d) => d.retry_backoff_initial <= d.retry_backoff_max, {
		error: () => t("schemas.retryBackoffRelation"),
		path: ["retry_backoff_initial"],
	});

// Network form schema - more lenient for form inputs
export const networkFormConfigSchema = z
	.object({
		base_url: z
			.union([
				z
					.string()
					.url( { error: () => t("schemas.mustBeAValidURL") })
					.refine((url) => url.startsWith("https://") || url.startsWith("http://"), {
						error: () => t("schemas.mustBeAValidHTTPOrHTTPSURL"),
					}),
				z.string().length(0),
			])
			.optional(),
		extra_headers: z.record(z.string(), z.string()).optional(),
		default_request_timeout_in_seconds: z.coerce
			.number( { error: () => t("schemas.timeoutMustBeANumber") })
			.min(1,  { error: () => t("schemas.timeoutMustBeGreaterThan0Seconds") })
			.max(172800,  { error: () => t("schemas.timeoutMustBeLessThan172800SecondsIE48Hours") }),
		max_retries: z.coerce
			.number( { error: () => t("schemas.maxRetriesMustBeANumber") })
			.min(0,  { error: () => t("schemas.maxRetriesMustBeGreaterThan0") })
			.max(10,  { error: () => t("schemas.maxRetriesMustBeLessThan10") }),
		retry_backoff_initial: z.coerce
			.number( { error: () => t("schemas.retryBackoffInitialMustBeANumber") })
			.min(100,  { error: () => t("schemas.retryBackoffInitialMustBeAtLeast100ms") })
			.max(1000000,  { error: () => t("schemas.retryBackoffInitialMustBeAtMost1000000ms") }),
		retry_backoff_max: z.coerce
			.number( { error: () => t("schemas.retryBackoffMaxMustBeANumber") })
			.min(100,  { error: () => t("schemas.retryBackoffMaxMustBeAtLeast100ms") })
			.max(1000000,  { error: () => t("schemas.retryBackoffMaxMustBeAtMost1000000ms") }),
		insecure_skip_verify: z.boolean().optional(),
		ca_cert_pem: secretVarSchema.optional(),
		stream_idle_timeout_in_seconds: z.coerce
			.number( { error: () => t("schemas.streamIdleTimeoutMustBeANumber") })
			.int( { error: () => t("schemas.streamIdleTimeoutMustBeAWholeNumberOfSeconds") })
			.min(5,  { error: () => t("schemas.streamIdleTimeoutMustBeAtLeast5Seconds") })
			.max(3600,  { error: () => t("schemas.streamIdleTimeoutMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		keep_alive_timeout_in_seconds: z.coerce
			.number( { error: () => t("schemas.keepAliveTimeoutMustBeANumber") })
			.int( { error: () => t("schemas.keepAliveTimeoutMustBeAWholeNumberOfSeconds") })
			.min(1,  { error: () => t("schemas.keepAliveTimeoutMustBeAtLeast1Second") })
			.max(3600,  { error: () => t("schemas.keepAliveTimeoutMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		max_conns_per_host: z.coerce
			.number( { error: () => t("schemas.maxConnectionsMustBeANumber") })
			.int( { error: () => t("schemas.maxConnectionsMustBeAWholeNumber") })
			.min(1,  { error: () => t("schemas.maxConnectionsMustBeAtLeast1") })
			.max(10000,  { error: () => t("schemas.maxConnectionsMustBeAtMost10000") })
			.optional(),
		enforce_http2: z.boolean().optional(),
		http2_ping_interval_in_seconds: z.coerce
			.number( { error: () => t("schemas.hTTP2PingIntervalMustBeANumber") })
			.int( { error: () => t("schemas.hTTP2PingIntervalMustBeAWholeNumberOfSeconds") })
			.min(0,  { error: () => t("schemas.hTTP2PingIntervalMustBeAtLeast0Seconds") })
			.max(3600,  { error: () => t("schemas.hTTP2PingIntervalMustBeAtMost3600SecondsIE60Minutes") })
			.optional(),
		allow_private_network: z.boolean().optional(),
	})
	.refine((d) => d.retry_backoff_initial <= d.retry_backoff_max, {
		error: () => t("schemas.initialBackoffMustBeLessThanOrEqualToMaxBackoff"),
		path: ["retry_backoff_initial"],
	});

// Concurrency and buffer size schema
export const concurrencyAndBufferSizeSchema = z.object({
	concurrency: z.number().min(1,  { error: () => t("schemas.concurrencyMustBeGreaterThan0") }).max(100,  { error: () => t("schemas.concurrencyMustBeLessThanOrEqualTo100") }),
	buffer_size: z.number().min(1,  { error: () => t("schemas.bufferSizeMustBeGreaterThan0") }).max(1000,  { error: () => t("schemas.bufferSizeMustBeLessThanOrEqualTo1000") }),
});

// Proxy type schema
export const proxyTypeSchema = z.enum(["none", "http", "socks5", "environment"]);

// Proxy config schema
export const proxyConfigSchema = z
	.object({
		type: proxyTypeSchema,
		url: secretVarSchema.optional(),
		username: secretVarSchema.optional(),
		password: secretVarSchema.optional(),
		ca_cert_pem: secretVarSchema.optional(),
	})
	.refine(
		(data) =>
			!(data.type === "http" || data.type === "socks5") ||
			data.url?.type === "env" ||
			data.url?.type === "vault" ||
			(data.url?.value && data.url.value.trim().length > 0),
		{
			error: () => t("schemas.proxyURLIsRequiredWhenUsingHTTPOrSOCKS5Proxy"),
			path: ["url"],
		},
	)
	.refine(
		(data) => {
			if ((data.type === "http" || data.type === "socks5") && data.url?.value?.trim()) {
				if (isRedacted(data.url.value)) {
					return true;
				}
				try {
					new URL(data.url.value);
					return true;
				} catch {
					return false;
				}
			}
			return true;
		},
		{
			error: () => t("schemas.mustBeAValidURLEGHttpProxyExampleCom8080"),
			path: ["url"],
		},
	);

// Proxy form schema - more lenient for form inputs with conditional validation
export const proxyFormConfigSchema = z
	.object({
		type: proxyTypeSchema,
		url: secretVarSchema.optional(),
		username: secretVarSchema.optional(),
		password: secretVarSchema.optional(),
		ca_cert_pem: secretVarSchema.optional(),
	})
	.refine(
		(data) => {
			if (data.type === "none") {
				return true;
			}
			// URL is required when proxy type is http or socks5
			if (data.type === "http" || data.type === "socks5") {
				// Env-backed URLs may have empty resolved value before env resolution.
				if (!!(data.url?.type && data.url?.type !== "plain_text") || data.url?.ref) return true;
				// Literal URLs must be non-empty.
				if (!data.url?.value || data.url.value.trim().length === 0) return false;
			}
			return true;
		},
		{
			error: () => t("schemas.proxyURLIsRequiredWhenUsingHTTPOrSOCKS5Proxy"),
			path: ["url"],
		},
	)
	.refine(
		(data) => {
			// URL must be valid format when provided and proxy type requires it
			if ((data.type === "http" || data.type === "socks5") && data.url?.value && data.url.value.trim().length > 0) {
				if (isRedacted(data.url.value)) {
					return true;
				}
				try {
					new URL(data.url.value);
					return true;
				} catch {
					return false;
				}
			}
			return true;
		},
		{
			error: () => t("schemas.mustBeAValidURLEGHttpProxyExampleCom8080"),
			path: ["url"],
		},
	);

// OpenAI Config tab
export const openaiConfigFormSchema = z.object({
	disable_store: z.boolean(),
});

export type OpenAIConfigFormSchema = z.infer<typeof openaiConfigFormSchema>;

// Allowed requests schema
export const allowedRequestsSchema = z.object({
	text_completion: z.boolean(),
	text_completion_stream: z.boolean(),
	chat_completion: z.boolean(),
	chat_completion_stream: z.boolean(),
	responses: z.boolean(),
	responses_stream: z.boolean(),
	responses_retrieve: z.boolean().optional(),
	responses_delete: z.boolean().optional(),
	responses_cancel: z.boolean().optional(),
	responses_input_items: z.boolean().optional(),
	embedding: z.boolean(),
	speech: z.boolean(),
	speech_stream: z.boolean(),
	transcription: z.boolean(),
	transcription_stream: z.boolean(),
	image_generation: z.boolean(),
	image_generation_stream: z.boolean(),
	image_edit: z.boolean(),
	image_edit_stream: z.boolean(),
	image_variation: z.boolean(),
	ocr: z.boolean().optional(),
	ocr_stream: z.boolean().optional(),
	rerank: z.boolean(),
	video_generation: z.boolean(),
	video_retrieve: z.boolean(),
	video_download: z.boolean(),
	video_delete: z.boolean(),
	video_list: z.boolean(),
	video_remix: z.boolean(),
	count_tokens: z.boolean(),
	list_models: z.boolean(),
	websocket_responses: z.boolean(),
	realtime: z.boolean(),
});

// Custom provider config schema
export const customProviderConfigSchema = z
	.object({
		base_provider_type: knownProviderSchema,
		is_key_less: z.boolean().optional(),
		allowed_requests: allowedRequestsSchema.optional(),
		request_path_overrides: z.record(z.string(), z.string().optional()).optional(),
	})
	.refine(
		(data) => {
			if (data.base_provider_type === "bedrock") {
				return !data.is_key_less;
			}
			return true;
		},
		{
			error: () => t("schemas.isKeylessIsNotAllowedForBedrock"),
			path: ["is_key_less"],
		},
	);

// Form-specific custom provider config schema
export const formCustomProviderConfigSchema = z
	.object({
		base_provider_type: z.string().min(1,  { error: () => t("schemas.baseProviderTypeIsRequired") }),
		is_key_less: z.boolean().optional(),
		allowed_requests: allowedRequestsSchema.optional(),
		request_path_overrides: z.record(z.string(), z.string().optional()).optional(),
	})
	.refine(
		(data) => {
			if (data.base_provider_type === "bedrock") {
				return !data.is_key_less;
			}
			return true;
		},
		{
			error: () => t("schemas.isKeylessIsNotAllowedForBedrock"),
			path: ["is_key_less"],
		},
	);

// Full model provider config schema
export const modelProviderConfigSchema = z.object({
	keys: z.array(modelProviderKeySchema).min(1,  { error: () => t("schemas.atLeastOneKeyIsRequired") }),
	network_config: networkConfigSchema.optional(),
	concurrency_and_buffer_size: concurrencyAndBufferSizeSchema.optional(),
	proxy_config: proxyConfigSchema.optional(),
	send_back_raw_request: z.boolean().optional(),
	send_back_raw_response: z.boolean().optional(),
	store_raw_request_response: z.boolean().optional(),
	custom_provider_config: customProviderConfigSchema.optional(),
});

// Model provider schema
export const modelProviderSchema = modelProviderConfigSchema.extend({
	name: modelProviderNameSchema,
});

// Form-specific model provider config schema
export const formModelProviderConfigSchema = z.object({
	keys: z.array(modelProviderKeySchema).min(1,  { error: () => t("schemas.atLeastOneKeyIsRequired") }),
	network_config: networkConfigSchema.optional(),
	concurrency_and_buffer_size: concurrencyAndBufferSizeSchema.optional(),
	proxy_config: proxyConfigSchema.optional(),
	send_back_raw_request: z.boolean().optional(),
	send_back_raw_response: z.boolean().optional(),
	store_raw_request_response: z.boolean().optional(),
	custom_provider_config: formCustomProviderConfigSchema.optional(),
});

// Flexible model provider schema for form data - allows any string for name
export const formModelProviderSchema = formModelProviderConfigSchema.extend({
	name: z.string().min(1,  { error: () => t("schemas.providerNameIsRequired") }),
});

// Add provider request schema
export const addProviderRequestSchema = z.object({
	provider: modelProviderNameSchema,
	keys: z.array(modelProviderKeySchema).min(1,  { error: () => t("schemas.atLeastOneKeyIsRequired") }),
	network_config: networkConfigSchema.optional(),
	concurrency_and_buffer_size: concurrencyAndBufferSizeSchema.optional(),
	proxy_config: proxyConfigSchema.optional(),
	send_back_raw_request: z.boolean().optional(),
	send_back_raw_response: z.boolean().optional(),
	store_raw_request_response: z.boolean().optional(),
	custom_provider_config: customProviderConfigSchema.optional(),
	openai_config: openaiConfigFormSchema.optional(),
});

// Update provider request schema
export const updateProviderRequestSchema = z.object({
	keys: z.array(modelProviderKeySchema).min(1,  { error: () => t("schemas.atLeastOneKeyIsRequired") }),
	network_config: networkConfigSchema,
	concurrency_and_buffer_size: concurrencyAndBufferSizeSchema,
	proxy_config: proxyConfigSchema,
	send_back_raw_request: z.boolean().optional(),
	send_back_raw_response: z.boolean().optional(),
	store_raw_request_response: z.boolean().optional(),
	custom_provider_config: customProviderConfigSchema.optional(),
	openai_config: openaiConfigFormSchema.optional(),
});

// Cache config schema
const baseCacheConfigSchema = z.object({
	ttl: z.number().int().min(1).default(3600),
	threshold: z.number().min(0).max(1).default(0.8),
	conversation_history_threshold: z.number().int().min(0).optional(),
	exclude_system_prompt: z.boolean().optional(),
	cache_by_model: z.boolean().default(false),
	cache_by_provider: z.boolean().default(false),
	vector_store_namespace: z.string().min(1).optional(),
	default_cache_key: z.string().min(1).optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
});

const directCacheConfigSchema = baseCacheConfigSchema
	.extend({
		dimension: z.literal(1),
		keys: z.array(modelProviderKeySchema).optional(),
	})
	.strict();

const providerBackedCacheConfigSchema = baseCacheConfigSchema
	.extend({
		provider: modelProviderNameSchema,
		keys: z.array(modelProviderKeySchema).optional(),
		embedding_model: z.string().min(1,  { error: () => t("schemas.embeddingModelIsRequired") }),
		dimension: z.number().int().min(2,  { error: () => t("schemas.dimensionMustBeGreaterThan1ForProviderBackedSemanticCache") }),
	})
	.strict();

export const cacheConfigSchema = z.union([directCacheConfigSchema, providerBackedCacheConfigSchema]);

// Core config schema
export const coreConfigSchema = z.object({
	drop_excess_requests: z.boolean().default(false),
	initial_pool_size: z.number().min(1).default(10),
	prometheus_labels: z.array(z.string()).default([]),
	enable_logging: z.boolean().default(true),
	disable_content_logging: z.boolean().default(false),
	enforce_auth_on_inference: z.boolean().default(false),
	hide_deleted_virtual_keys_in_filters: z.boolean().default(false),
	allowed_origins: z.array(z.string()).default(["*"]),
	max_request_body_size_mb: z.number().min(1).default(100),
	mcp_agent_depth: z.number().min(1).default(10),
	mcp_tool_execution_timeout: z.number().min(1).default(30),
	mcp_code_mode_binding_level: z.enum(["server", "tool"]).default("server"),
	mcp_disable_auto_tool_inject: z.boolean().default(false),
	mcp_enable_temp_token_auth: z.boolean().default(false),
});

// Bifrost config schema
export const bifrostConfigSchema = z.object({
	client_config: coreConfigSchema,
	is_db_connected: z.boolean(),
	is_cache_connected: z.boolean(),
	is_logs_connected: z.boolean(),
});

// Network and proxy form schema - combined for the NetworkFormFragment
export const networkAndProxyFormSchema = z.object({
	network_config: networkFormConfigSchema.optional(),
	proxy_config: proxyFormConfigSchema.optional(),
});

// Proxy-only form schema for the ProxyFormFragment
export const proxyOnlyFormSchema = z.object({
	proxy_config: proxyFormConfigSchema.optional(),
});

// Network-only form schema for the NetworkFormFragment
export const networkOnlyFormSchema = z.object({
	network_config: networkFormConfigSchema.optional(),
});

// Performance form schema for the PerformanceFormFragment (concurrency/buffer only; raw request/response are in Debugging tab)
export const performanceFormSchema = z.object({
	concurrency_and_buffer_size: z
		.object({
			concurrency: z
				.number({ error: () => t("schemas.concurrencyMustBeANumber") })
				.min(1,  { error: () => t("schemas.concurrencyMustBeGreaterThan0") })
				.max(100000,  { error: () => t("schemas.concurrencyMustBeLessThan100000") }),
			buffer_size: z
				.number({ error: () => t("schemas.bufferSizeMustBeANumber") })
				.min(1,  { error: () => t("schemas.bufferSizeMustBeGreaterThan0") })
				.max(100000,  { error: () => t("schemas.bufferSizeMustBeLessThan100000") }),
		})
		.refine((data) => data.concurrency <= data.buffer_size, {
			error: () => t("schemas.concurrencyMustBeLessThanOrEqualToBufferSize"),
			path: ["concurrency"],
		}),
});

// Debugging tab (raw request/response toggles)
export const debuggingFormSchema = z.object({
	send_back_raw_request: z.boolean(),
	send_back_raw_response: z.boolean(),
	store_raw_request_response: z.boolean(),
});

export type DebuggingFormSchema = z.infer<typeof debuggingFormSchema>;

// Beta Headers tab
export const betaHeadersFormSchema = z.object({
	beta_header_overrides: z.record(z.string(), z.boolean()).optional(),
});

export type BetaHeadersFormSchema = z.infer<typeof betaHeadersFormSchema>;

// OTEL Configuration Schema
export const otelConfigSchema = z
	.object({
		// Per-profile enable toggle. A disabled profile exports nothing and is not validated.
		enabled: z.boolean().default(true),
		// Trace export toggle. When false the profile is metrics-only; collector_url isn't required.
		traces_enabled: z.boolean().default(true),
		service_name: z.string().optional(),
		collector_url: secretVarSchema.default({ value: "" }),
		trace_type: z
			.enum(["genai_extension", "vercel", "open_inference"], {
				error: () => t("schemas.pleaseSelectATraceType"),
			})
			.default("genai_extension"),
		// Common headers go to both endpoints; per-signal headers override on collision.
		headers: z.record(z.string(), secretVarSchema).optional(),
		trace_headers: z.record(z.string(), secretVarSchema).optional(),
		metrics_headers: z.record(z.string(), secretVarSchema).optional(),
		protocol: z
			.enum(["http", "grpc"], {
				error: () => t("schemas.pleaseSelectAProtocol"),
			})
			.default("http"),
		// TLS configuration
		tls_ca_cert: z.string().optional(),
		insecure: z.boolean().default(true),
		// Bounds a single trace export. gRPC exports have no other timeout, so an
		// endpoint that accepts the connection but never replies would otherwise block
		// an export goroutine indefinitely.
		export_timeout: z.number().int().min(1).max(60).default(5),
		// Metrics push configuration
		metrics_enabled: z.boolean().default(false),
		metrics_endpoint: secretVarSchema.optional(),
		metrics_push_interval: z.number().int().min(1).max(300).default(15),
		request_headers: z.array(z.string()).default([]),
		disable_content_logging: z.boolean().default(false),
		group_traces_by_session: z.boolean().default(false),
		disable_root_span_content: z.boolean().default(false),
	})
	.superRefine((data, ctx) => {
		// A disabled profile is not sent anywhere, so skip all validation for it.
		if (data.enabled === false) return;

		const protocol = data.protocol;
		const hostPortRegex = /^(?!https?:\/\/)([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\]|\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

		// Helper to validate URL format
		const validateHttpUrl = (url: string, path: string[]) => {
			try {
				const u = new URL(url);
				if (!(u.protocol === "http:" || u.protocol === "https:")) {
					ctx.addIssue({
						code: "custom",
						path,
						error: () => t("schemas.mustBeAValidHTTPOrHTTPSURL"),
					});
					return false;
				}
				return true;
			} catch {
				ctx.addIssue({
					code: "custom",
					path,
					error: () => t("schemas.mustBeAValidHTTPOrHTTPSURL"),
				});
				return false;
			}
		};

		// Helper to validate host:port format
		const validateHostPort = (value: string, path: string[], example: string) => {
			const match = value.match(hostPortRegex);
			if (!match) {
				ctx.addIssue({
					code: "custom",
					path,
					message: t("schemas.grpcFormat", { example }),
				});
				return false;
			}
			const port = Number(match[2]);
			if (!(port >= 1 && port <= 65535)) {
				ctx.addIssue({
					code: "custom",
					path,
					error: () => t("schemas.portMustBeBetween1And65535"),
				});
				return false;
			}
			return true;
		};

		// collector_url is required and validated only when traces are enabled.
		if (data.traces_enabled) {
			if (!isSecretVarSet(data.collector_url)) {
				ctx.addIssue({
					code: "custom",
					path: ["collector_url"],
					error: () => t("schemas.collectorAddressIsRequired"),
				});
			}

			// Validate collector_url format — skip format check for env var references
			const collectorUrl = (data.collector_url?.value || "").trim();
			if (collectorUrl && (data.collector_url?.type === "plain_text" || !data.collector_url?.type) && protocol === "http") {
				validateHttpUrl(collectorUrl, ["collector_url"]);
			} else if (collectorUrl && (data.collector_url?.type === "plain_text" || !data.collector_url?.type) && protocol === "grpc") {
				validateHostPort(collectorUrl, ["collector_url"], "otel-collector:4317");
			}
		}

		// Validate metrics_endpoint when metrics_enabled is true
		if (data.metrics_enabled) {
			const metricsEndpoint = (data.metrics_endpoint?.value || "").trim();
			if (!isSecretVarSet(data.metrics_endpoint)) {
				ctx.addIssue({
					code: "custom",
					path: ["metrics_endpoint"],
					error: () => t("schemas.metricsEndpointIsRequiredWhenMetricsPushIsEnabled"),
				});
			} else if (metricsEndpoint && (data.metrics_endpoint?.type === "plain_text" || !data.metrics_endpoint?.type) && protocol === "http") {
				validateHttpUrl(metricsEndpoint, ["metrics_endpoint"]);
			} else if (metricsEndpoint && (data.metrics_endpoint?.type === "plain_text" || !data.metrics_endpoint?.type) && protocol === "grpc") {
				validateHostPort(metricsEndpoint, ["metrics_endpoint"], "otel-collector:4317");
			}
		}
	});

// OTEL form schema for the OtelFormFragment. The plugin itself is gated by `enabled`;
// it carries one or more export profiles, each independently enable-able.
export const otelFormSchema = z.object({
	enabled: z.boolean().default(true),
	profiles: z.array(otelConfigSchema).min(1,  { error: () => t("schemas.atLeastOneProfileIsRequired") }),
});

// Maxim Configuration Schema
export const maximConfigSchema = z.object({
	api_key: z.string().default(""),
	log_repo_id: z.string().optional(),
	request_headers: z.array(z.string()).default([]),
});

// Maxim form schema for the MaximFormFragment
export const maximFormSchema = z
	.object({
		enabled: z.boolean().default(true),
		maxim_config: maximConfigSchema,
	})
	.superRefine((data, ctx) => {
		if (data.enabled) {
			const apiKey = (data.maxim_config.api_key || "").trim();
			if (!apiKey) {
				ctx.addIssue({
					code: "custom",
					path: ["maxim_config", "api_key"],
					error: () => t("schemas.aPIKeyIsRequired2"),
				});
			} else if (!apiKey.startsWith("sk_mx_")) {
				ctx.addIssue({
					code: "custom",
					path: ["maxim_config", "api_key"],
					error: () => t("schemas.aPIKeyMustStartWithSk_mx_"),
				});
			}
		}
	});

// Prometheus Push Gateway Configuration Schema
export const prometheusConfigSchema = z
	.object({
		push_gateway_url: secretVarSchema.optional(),
		job_name: z.string().default("bifrost"),
		instance_id: z.string().optional(),
		push_interval: z.number().min(1).max(300).default(15),
		basic_auth_username: secretVarSchema.optional(),
		basic_auth_password: secretVarSchema.optional(),
	})
	.superRefine((data, ctx) => {
		// Validate push_gateway_url format — skip for env var references
		const url = (data.push_gateway_url?.value || "").trim();
		if (url && (data.push_gateway_url?.type === "plain_text" || !data.push_gateway_url?.type)) {
			try {
				const u = new URL(url);
				if (!(u.protocol === "http:" || u.protocol === "https:")) {
					ctx.addIssue({
						code: "custom",
						path: ["push_gateway_url"],
						error: () => t("schemas.mustBeAValidHTTPOrHTTPSURL"),
					});
				}
			} catch {
				ctx.addIssue({
					code: "custom",
					path: ["push_gateway_url"],
					error: () => t("schemas.mustBeAValidURLEGHttpPushgateway9091"),
				});
			}
		}

		// Validate basic auth: if one credential is provided, both must be provided
		const hasUsername = isSecretVarSet(data.basic_auth_username);
		const hasPassword = isSecretVarSet(data.basic_auth_password);
		if (hasUsername && !hasPassword) {
			ctx.addIssue({
				code: "custom",
				path: ["basic_auth_password"],
				error: () => t("schemas.passwordIsRequiredWhenUsernameIsProvided"),
			});
		}
		if (hasPassword && !hasUsername) {
			ctx.addIssue({
				code: "custom",
				path: ["basic_auth_username"],
				error: () => t("schemas.usernameIsRequiredWhenPasswordIsProvided"),
			});
		}
	});

// Prometheus form schema for the PrometheusFormFragment.
export const prometheusFormSchema = z
	.object({
		metrics_enabled: z.boolean().default(true),
		push_gateway_enabled: z.boolean().default(false),
		prometheus_config: prometheusConfigSchema,
	})
	.superRefine((data, ctx) => {
		if (data.push_gateway_enabled) {
			const urlIsSet = isSecretVarSet(data.prometheus_config.push_gateway_url);
			if (!urlIsSet) {
				ctx.addIssue({
					code: "custom",
					path: ["prometheus_config", "push_gateway_url"],
					error: () => t("schemas.pushGatewayURLIsRequiredWhenThePushGatewayIsEnabled"),
				});
			}
		}
	});

// MCP Client update schema
export const mcpClientUpdateSchema = z
	.object({
		is_code_mode_client: z.boolean().optional(),
		is_ping_available: z.boolean().optional(),
		needs_session_stickiness: z.boolean().optional(),
		allow_on_all_virtual_keys: z.boolean().optional(),
		disabled: z.boolean().optional(),
		name: z
			.string()
			.min(1,  { error: () => t("schemas.nameIsRequired") })
			.refine((val) => !val.includes("-"), {
				error: () => t("schemas.clientNameCannotContainHyphens"),
			})
			.refine((val) => !val.includes(" "), {
				error: () => t("schemas.clientNameCannotContainSpaces"),
			})
			.refine((val) => !/^[0-9]/.test(val), {
				error: () => t("schemas.clientNameCannotStartWithANumber"),
			}),
		headers: z.record(z.string(), secretVarSchema).optional().nullable(),
		per_user_header_keys: z
			.array(z.string().trim().min(1,  { error: () => t("schemas.headerNameCannotBeEmpty") }))
			.optional()
			.refine(
				(headers) => {
					if (!headers) return true;
					const normalized = headers.map((h) => h.trim().toLowerCase());
					return normalized.length === new Set(normalized).size;
				},
				{ error: () => t("schemas.duplicateHeaderNamesAreNotAllowed") },
			),
		tools_to_execute: z
			.array(z.string())
			.optional()
			.refine(
				(tools) => {
					if (!tools || tools.length === 0) return true;
					const hasWildcard = tools.includes("*");
					return !hasWildcard || tools.length === 1;
				},
				{ error: () => t("schemas.wildcardCannotBeCombinedWithOtherToolNames") },
			)
			.refine(
				(tools) => {
					if (!tools) return true;
					return tools.length === new Set(tools).size;
				},
				{ error: () => t("schemas.duplicateToolNamesAreNotAllowed") },
			),
		tools_to_auto_execute: z
			.array(z.string())
			.optional()
			.refine(
				(tools) => {
					if (!tools || tools.length === 0) return true;
					const hasWildcard = tools.includes("*");
					return !hasWildcard || tools.length === 1;
				},
				{ error: () => t("schemas.wildcardCannotBeCombinedWithOtherToolNames") },
			)
			.refine(
				(tools) => {
					if (!tools) return true;
					return tools.length === new Set(tools).size;
				},
				{ error: () => t("schemas.duplicateToolNamesAreNotAllowed") },
			),
		tool_pricing: z.record(z.string(), z.number().min(0,  { error: () => t("schemas.costMustBeNonNegative") })).optional(),
		tool_sync_interval: z.number().optional(), // -1 = disabled, 0 = use global, >0 = custom interval in minutes
		tool_execution_timeout: z.number().int().min(0).optional(), // 0 = use global, >0 = per-server timeout in seconds
		allowed_extra_headers: z
			.array(z.string())
			.optional()
			.refine(
				(headers) => {
					if (!headers || headers.length === 0) return true;
					const hasWildcard = headers.includes("*");
					return !hasWildcard || headers.length === 1;
				},
				{ error: () => t("schemas.wildcardCannotBeCombinedWithSpecificHeaderNames") },
			),
		oauth_config: z
			.object({
				client_id: secretVarSchema.optional(),
				client_secret: secretVarSchema.optional(),
				authorize_url: z
					.string()
					.optional()
					.refine((val) => !val || /^https?:\/\/.+$/.test(val), { error: () => t("schemas.authorizeURLMustStartWithHttpOrHttps") }),
				token_url: z
					.string()
					.optional()
					.refine((val) => !val || /^https?:\/\/.+$/.test(val), { error: () => t("schemas.tokenURLMustStartWithHttpOrHttps") }),
				registration_url: z
					.string()
					.optional()
					.refine((val) => !val || /^https?:\/\/.+$/.test(val), { error: () => t("schemas.registrationURLMustStartWithHttpOrHttps") }),
				scopes: z.array(z.string()).optional(),
				resource: z.string().optional(),
			})
			.optional(),
		token_exchange: z
			.object({
				audience: z.string().trim().min(1,  { error: () => t("schemas.audienceIsRequired") }),
				use_idp_credentials: z.boolean().optional(),
				client_id: secretVarSchema.optional(),
				client_secret: secretVarSchema.optional(),
				authorization_server_url: z
					.string()
					.optional()
					.refine((val) => !val || /^https?:\/\/.+$/.test(val), {
						error: () => t("schemas.authorizationServerURLMustStartWithHttpOrHttps"),
					}),
				scopes: z.array(z.string()).optional(),
			})
			.optional(),
		tls_config: z
			.object({
				insecure_skip_verify: z.boolean().optional(),
				ca_cert_pem: secretVarSchema.optional(),
			})
			.optional(),
	})
	.superRefine((data, ctx) => {
		// per_user_header_keys is only ever set on the form for per_user_headers
		// auth clients (undefined otherwise), so an empty array here means the
		// admin cleared every entry, not that the field doesn't apply.
		if (data.per_user_header_keys !== undefined && data.per_user_header_keys.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["per_user_header_keys"],
				error: () => t("schemas.declareAtLeastOneHeaderNameUsersMustSupply"),
			});
		}
	});

// Global proxy type schema
export const globalProxyTypeSchema = z.enum(["http", "socks5", "tcp"]);

// Global proxy configuration schema
export const globalProxyConfigSchema = z
	.object({
		enabled: z.boolean(),
		type: globalProxyTypeSchema,
		url: z.string(),
		username: z.string().optional(),
		password: z.string().optional(),
		ca_cert_pem: z.string().optional(),
		no_proxy: z.string().optional(),
		timeout: z.number().min(0).optional(),
		skip_tls_verify: z.boolean().optional(),
		enable_for_scim: z.boolean(),
		enable_for_inference: z.boolean(),
		enable_for_api: z.boolean(),
	})
	.refine(
		(data) => {
			// URL is required when proxy is enabled
			if (data.enabled && (!data.url || data.url.trim().length === 0)) {
				return false;
			}
			return true;
		},
		{
			error: () => t("schemas.proxyURLIsRequiredWhenProxyIsEnabled"),
			path: ["url"],
		},
	)
	.refine(
		(data) => {
			// Validate URL format when provided and enabled
			if (data.enabled && data.url && data.url.trim().length > 0) {
				try {
					new URL(data.url);
					return true;
				} catch {
					return false;
				}
			}
			return true;
		},
		{
			error: () => t("schemas.mustBeAValidURLEGHttpProxyExampleCom8080"),
			path: ["url"],
		},
	);

// Global proxy form schema for the ProxyView
export const globalProxyFormSchema = z.object({
	proxy_config: globalProxyConfigSchema,
});

// Global header filter configuration schema
// Controls which headers with the x-bf-eh-* prefix are forwarded to LLM providers
export const globalHeaderFilterConfigSchema = z.object({
	allowlist: z.array(z.string()).optional(), // If non-empty, only these headers are allowed
	denylist: z.array(z.string()).optional(), // Headers to always block
});

// Global header filter form schema for the HeaderFilterView
export const globalHeaderFilterFormSchema = z.object({
	header_filter_config: globalHeaderFilterConfigSchema,
});

// Routing rule creation schema
export const routingRuleSchema = z
	.object({
		name: z.string().min(1,  { error: () => t("schemas.ruleNameIsRequired") }).max(255,  { error: () => t("schemas.ruleNameMustBeLessThan255Characters") }),
		description: z.string().max(1000,  { error: () => t("schemas.descriptionMustBeLessThan1000Characters") }).optional(),
		cel_expression: z.string().optional(),
		provider: z.string().min(1,  { error: () => t("schemas.providerIsRequired") }),
		model: z.string().optional(),
		fallbacks: z.array(z.string()).optional().default([]),
		scope: z.enum(["global", "team", "customer", "virtual_key"]),
		scope_id: z.string().optional(),
		priority: z.number().min(0,  { error: () => t("schemas.priorityMustBe0OrGreater") }).max(1000,  { error: () => t("schemas.priorityMustBe1000OrLess") }),
		enabled: z.boolean().default(true),
		chain_rule: z.boolean().default(false),
	})
	.refine((data) => data.scope === "global" || (data.scope_id != null && data.scope_id.trim() !== ""), {
		error: () => t("schemas.scopeIDIsRequiredWhenScopeIsNotGlobal"),
		path: ["scope_id"],
	});

// Budget override form schema (BudgetOverrideDialog)
export const budgetOverrideFormSchema = z
	.object({
		amount: z.number( { error: () => t("schemas.additionalBudgetMustBeGreaterThan0") }).positive( { error: () => t("schemas.additionalBudgetMustBeGreaterThan0") }),
		mode: z.enum(["cycles", "forever"]),
		cycles: z.number().optional(),
	})
	.refine((data) => data.mode !== "cycles" || (data.cycles !== undefined && Number.isSafeInteger(data.cycles) && data.cycles > 0), {
		error: () => t("schemas.resetCyclesMustBeAPositiveWholeNumber"),
		path: ["cycles"],
	});

// Export type inference helpers
export type SecretVar = z.infer<typeof secretVarSchema>;
export type MCPClientUpdateSchema = z.infer<typeof mcpClientUpdateSchema>;
export type ModelProviderKeySchema = z.infer<typeof modelProviderKeySchema>;
export type NetworkConfigSchema = z.infer<typeof networkConfigSchema>;
export type NetworkFormConfigSchema = z.infer<typeof networkFormConfigSchema>;
export type ProxyFormConfigSchema = z.infer<typeof proxyFormConfigSchema>;
export type NetworkAndProxyFormSchema = z.infer<typeof networkAndProxyFormSchema>;
export type ProxyOnlyFormSchema = z.infer<typeof proxyOnlyFormSchema>;
export type OtelConfigSchema = z.infer<typeof otelConfigSchema>;
export type OtelFormSchema = z.infer<typeof otelFormSchema>;
export type MaximConfigSchema = z.infer<typeof maximConfigSchema>;
export type MaximFormSchema = z.infer<typeof maximFormSchema>;
export type PrometheusConfigSchema = z.infer<typeof prometheusConfigSchema>;
export type PrometheusFormSchema = z.infer<typeof prometheusFormSchema>;
export type NetworkOnlyFormSchema = z.infer<typeof networkOnlyFormSchema>;
export type PerformanceFormSchema = z.infer<typeof performanceFormSchema>;
export type CustomProviderConfigSchema = z.infer<typeof customProviderConfigSchema>;
export type GlobalProxyConfigSchema = z.infer<typeof globalProxyConfigSchema>;
export type GlobalProxyFormSchema = z.infer<typeof globalProxyFormSchema>;
export type GlobalHeaderFilterConfigSchema = z.infer<typeof globalHeaderFilterConfigSchema>;
export type GlobalHeaderFilterFormSchema = z.infer<typeof globalHeaderFilterFormSchema>;
export type RoutingRuleSchema = z.infer<typeof routingRuleSchema>;
export type BudgetOverrideFormSchema = z.infer<typeof budgetOverrideFormSchema>;