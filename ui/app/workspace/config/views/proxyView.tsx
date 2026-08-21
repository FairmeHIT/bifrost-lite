import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useI18n } from "@/lib/i18n/context";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateProxyConfigMutation } from "@/lib/store";
import { DefaultGlobalProxyConfig, GlobalProxyConfig } from "@/lib/types/config";
import { globalProxyConfigSchema } from "@/lib/types/schemas";
import { cn } from "@/lib/utils";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export default function ProxyView() {
	const { t } = useI18n();
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const proxyConfig = bifrostConfig?.proxy_config;
	const [updateProxyConfig, { isLoading }] = useUpdateProxyConfigMutation();

	const form = useForm<GlobalProxyConfig>({
		resolver: zodResolver(globalProxyConfigSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: DefaultGlobalProxyConfig,
	});

	useEffect(() => {
		if (proxyConfig) {
			form.reset({
				...DefaultGlobalProxyConfig,
				...proxyConfig,
			});
		}
	}, [proxyConfig, form]);

	const watchedEnabled = form.watch("enabled");
	const watchedType = form.watch("type");

	const onSubmit = async (data: GlobalProxyConfig) => {
		try {
			await updateProxyConfig(data).unwrap();
			toast.success(t("config.proxy.updatedToast"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const isTypeUnsupported = watchedType === "socks5" || watchedType === "tcp";

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">{t("config.proxy.title")}</h2>
						<p className="text-muted-foreground text-sm">{t("config.proxy.description")}</p>
					</div>

					<fieldset disabled={!hasSettingsUpdateAccess} className="space-y-4">
						{/* Enable Proxy */}
						<div className="flex items-center justify-between space-x-2 rounded-sm border p-4">
							<div className="space-y-0.5">
								<FormLabel className="text-sm font-medium">{t("config.proxy.enableProxy")}</FormLabel>
								<p className="text-muted-foreground text-sm">{t("config.proxy.enableProxyDesc")}</p>
							</div>
							<FormField
								control={form.control}
								name="enabled"
								render={({ field }) => (
									<FormItem>
										<FormControl>
											<Switch checked={field.value} onCheckedChange={field.onChange} />
										</FormControl>
									</FormItem>
								)}
							/>
						</div>

						{/* Proxy Configuration Section */}
						<div className={cn("space-y-4 rounded-sm border p-4 transition-opacity", !watchedEnabled && "pointer-events-none opacity-50")}>
							<h3 className="text-lg font-medium">{t("config.proxy.proxyConfiguration")}</h3>

							{/* Proxy Type */}
							<FormField
								control={form.control}
								name="type"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("config.proxy.proxyType")}</FormLabel>
										<Select onValueChange={field.onChange} value={field.value} disabled={!watchedEnabled}>
											<FormControl>
												<SelectTrigger className="w-48">
													<SelectValue placeholder={t("config.proxy.selectType")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="http">{t("config.proxy.httpHttps")}</SelectItem>
												<SelectItem value="socks5" disabled>
													{t("config.proxy.socks5")}{" "}
													<Badge variant="outline" className="ml-2 text-xs">
														{t("config.proxy.comingSoon")}
													</Badge>
												</SelectItem>
												<SelectItem value="tcp" disabled>
													{t("config.proxy.tcp")}{" "}
													<Badge variant="outline" className="ml-2 text-xs">
														{t("config.proxy.comingSoon")}
													</Badge>
												</SelectItem>
											</SelectContent>
										</Select>
										<FormDescription>{t("config.proxy.proxyTypeDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{isTypeUnsupported && watchedEnabled && (
								<Alert variant="destructive">
									<AlertTriangle className="h-4 w-4" />
									<AlertDescription>{t("config.proxy.unsupportedTypeAlert", { type: watchedType.toUpperCase() })}</AlertDescription>
								</Alert>
							)}

							{/* Proxy URL */}
							<FormField
								control={form.control}
								name="url"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("config.proxy.proxyUrl")}</FormLabel>
										<FormControl>
											<Input placeholder={t("config.proxy.proxyUrlPlaceholder")} disabled={!watchedEnabled} {...field} />
										</FormControl>
										<FormDescription>{t("config.proxy.proxyUrlDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Authentication Section */}
							<div className="bg-muted/20 space-y-4 rounded-sm border p-4">
								<h4 className="text-sm font-medium">{t("config.proxy.authentication")}</h4>
								<div className="grid grid-cols-2 gap-4">
									<FormField
										control={form.control}
										name="username"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("config.proxy.username")}</FormLabel>
												<FormControl>
													<Input placeholder={t("config.proxy.usernamePlaceholder")} disabled={!watchedEnabled} {...field} value={field.value || ""} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="password"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("config.proxy.password")}</FormLabel>
												<FormControl>
													<Input
														type="password"
														placeholder={t("config.proxy.passwordPlaceholder")}
														disabled={!watchedEnabled}
														{...field}
														value={field.value || ""}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							</div>

							{/* Advanced Settings */}
							<div className="bg-muted/20 space-y-4 rounded-sm border p-4">
								<h4 className="text-sm font-medium">{t("config.proxy.advancedSettings")}</h4>

								{/* No Proxy */}
								<FormField
									control={form.control}
									name="no_proxy"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("config.proxy.noProxyHosts")}</FormLabel>
											<FormControl>
												<Textarea
													placeholder={t("config.proxy.noProxyPlaceholder")}
													className="h-20"
													disabled={!watchedEnabled}
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormDescription>{t("config.proxy.noProxyDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Timeout */}
								<FormField
									control={form.control}
									name="timeout"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("config.proxy.connectionTimeout")}</FormLabel>
											<FormControl>
												<Input
													type="number"
													min={0}
													max={300}
													placeholder="30"
													className="w-32"
													disabled={!watchedEnabled}
													{...field}
													value={field.value ?? ""}
													onChange={(e) => field.onChange(e.target.value !== "" ? parseInt(e.target.value, 10) : undefined)}
												/>
											</FormControl>
											<FormDescription>{t("config.proxy.connectionTimeoutDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* CA Certificate */}
								<FormField
									control={form.control}
									name="ca_cert_pem"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("config.proxy.caCertificate")}</FormLabel>
											<FormControl>
												<Textarea
													placeholder={t("config.proxy.caCertificatePlaceholder")}
													className="font-mono text-xs"
													rows={6}
													disabled={!watchedEnabled}
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormDescription>{t("config.proxy.caCertificateDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Skip TLS Verify */}
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<FormLabel className="text-sm font-medium">{t("config.proxy.skipTlsVerify")}</FormLabel>
										<p className="text-muted-foreground text-sm">{t("config.proxy.skipTlsVerifyDesc")}</p>
									</div>
									<FormField
										control={form.control}
										name="skip_tls_verify"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={!watchedEnabled} />
												</FormControl>
											</FormItem>
										)}
									/>
								</div>
							</div>
						</div>

						{/* Entity Enablement Section */}
						<div className={cn("space-y-4 rounded-sm border p-4 transition-opacity", !watchedEnabled && "pointer-events-none opacity-50")}>
							<div className="space-y-1">
								<h3 className="text-lg font-medium">{t("config.proxy.enableProxyFor")}</h3>
								<p className="text-muted-foreground text-sm">{t("config.proxy.enableProxyForDesc")}</p>
							</div>

							{/* SCIM - Enterprise only */}
							{IS_ENTERPRISE && (
								<div className="flex items-center justify-between rounded-sm border p-4">
									<div className="space-y-0.5">
										<div className="flex items-center gap-2">
											<FormLabel className="text-sm font-medium">{t("config.proxy.scim")}</FormLabel>
											<Badge variant="secondary">{t("config.proxy.enterprise")}</Badge>
										</div>
										<p className="text-muted-foreground text-sm">{t("config.proxy.scimDesc")}</p>
									</div>
									<FormField
										control={form.control}
										name="enable_for_scim"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={!watchedEnabled} />
												</FormControl>
											</FormItem>
										)}
									/>
								</div>
							)}

							{/* Inference - Coming Soon */}
							<div className="flex items-center justify-between rounded-sm border p-4 opacity-60">
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<FormLabel className="text-sm font-medium">{t("config.proxy.inference")}</FormLabel>
										<Badge variant="outline">{t("config.proxy.comingSoon")}</Badge>
									</div>
									<p className="text-muted-foreground text-sm">{t("config.proxy.inferenceDesc")}</p>
								</div>
								<Switch disabled checked={false} />
							</div>

							{/* API - Coming Soon */}
							<div className="flex items-center justify-between rounded-sm border p-4 opacity-60">
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<FormLabel className="text-sm font-medium">{t("config.proxy.api")}</FormLabel>
										<Badge variant="outline">{t("config.proxy.comingSoon")}</Badge>
									</div>
									<p className="text-muted-foreground text-sm">{t("config.proxy.apiDesc")}</p>
								</div>
								<Switch disabled checked={false} />
							</div>

							{!IS_ENTERPRISE && (
								<Alert>
									<Info className="h-4 w-4" />
									<AlertDescription>{t("config.proxy.scimEnterpriseAlert")}</AlertDescription>
								</Alert>
							)}
						</div>
					</fieldset>
					<div className="flex justify-end pt-2">
						<Tooltip>
							<TooltipTrigger asChild>
								<span tabIndex={!hasSettingsUpdateAccess ? 0 : undefined}>
									<Button
										type="submit"
										disabled={!form.formState.isDirty || !form.formState.isValid || isLoading || !hasSettingsUpdateAccess}
									>
										{isLoading ? t("common.saving") : t("config.proxy.saveChanges")}
									</Button>
								</span>
							</TooltipTrigger>
							{!hasSettingsUpdateAccess && <TooltipContent>{t("config.proxy.noPermission")}</TooltipContent>}
						</Tooltip>
					</div>
				</form>
			</Form>
		</div>
	);
}