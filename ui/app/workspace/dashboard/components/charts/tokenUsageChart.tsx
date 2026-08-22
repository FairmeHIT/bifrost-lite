import { useI18n } from "@/lib/i18n/context";
import type { TokenHistogramResponse } from "@/lib/types/logs";
import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactNumber } from "@/lib/utils/numbers";
import { CHART_COLORS, CHART_GRID_CLASS, CHART_TICK_CLASS, CHART_TOOLTIP_CLASS, formatFullTimestamp, formatTimestamp } from "../../utils/chartUtils";
import { ChartErrorBoundary } from "./chartErrorBoundary";
import type { ChartType } from "./chartTypeToggle";

interface TokenUsageChartProps {
	data: TokenHistogramResponse | null;
	chartType: ChartType;
	startTime: number;
	endTime: number;
}

function CustomTooltip({ active, payload }: any) {
	const { t } = useI18n();
	if (!active || !payload || !payload.length) return null;

	const data = payload[0]?.payload;
	if (!data) return null;

	return (
		<div className={CHART_TOOLTIP_CLASS}>
			<div className="mb-1 text-xs text-muted-foreground">{formatFullTimestamp(data.timestamp)}</div>
			<div className="space-y-1 text-sm">
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full bg-blue-500" />
						<span className="text-muted-foreground">{t("dashboardCharts.input")}</span>
					</span>
					<span className="font-medium">{data.prompt_tokens.toLocaleString()}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full bg-emerald-500" />
						<span className="text-muted-foreground">{t("dashboardCharts.output")}</span>
					</span>
					<span className="font-medium">{data.completion_tokens.toLocaleString()}</span>
				</div>
				{data.cached_read_tokens > 0 && (
					<div className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cachedReadTokens }} />
							<span className="text-muted-foreground">{t("dashboardCharts.cached")}</span>
						</span>
						<span className="font-medium">{data.cached_read_tokens.toLocaleString()}</span>
					</div>
				)}
				<div className="flex items-center justify-between gap-4 border-t border-popover pt-1">
					<span className="text-muted-foreground">{t("dashboardCharts.total")}</span>
					<span className="font-medium">{data.total_tokens.toLocaleString()}</span>
				</div>
			</div>
		</div>
	);
}

function TokenUsageChartImpl({ data, chartType, startTime, endTime }: TokenUsageChartProps) {
	const { t } = useI18n();
	const chartData = useMemo(() => {
		if (!data?.buckets || !data.bucket_size_seconds) {
			return [];
		}

		return data.buckets.map((bucket, index) => ({
			...bucket,
			uncached_prompt_tokens: Math.max(bucket.prompt_tokens - bucket.cached_read_tokens, 0),
			index,
			formattedTime: formatTimestamp(bucket.timestamp, data.bucket_size_seconds),
		}));
	}, [data]);

	if (!data?.buckets || chartData.length === 0) {
		return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">{t("dashboardCharts.noData")}</div>;
	}

	const commonProps = {
		data: chartData,
		margin: { top: 6, right: 4, left: 4, bottom: 0 },
	};

	return (
		<ChartErrorBoundary resetKey={`${startTime}-${endTime}-${chartData.length}`}>
			<ResponsiveContainer width="100%" height="100%">
				{chartType === "bar" ? (
					<BarChart {...commonProps} barCategoryGap={1}>
						<CartesianGrid strokeDasharray="3 3" vertical={false} className={CHART_GRID_CLASS} />
						<XAxis
							dataKey="index"
							type="number"
							domain={[-0.5, chartData.length - 0.5]}
							tick={{ fontSize: 11, className: "fill-muted-foreground", dy: 5 }}
							tickLine={false}
							axisLine={false}
							tickFormatter={(idx) => chartData[Math.round(idx)]?.formattedTime || ""}
							interval="preserveStartEnd"
						/>
						<YAxis
							tick={{ fontSize: 11, className: "fill-muted-foreground" }}
							tickLine={false}
							axisLine={false}
							width={50}
							tickFormatter={(v) => formatCompactNumber(v)}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }} />
						<Bar
							isAnimationActive={false}
							dataKey="uncached_prompt_tokens"
							stackId="tokens"
							fill={CHART_COLORS.promptTokens}
							fillOpacity={0.9}
							radius={[0, 0, 0, 0]}
							barSize={30}
						/>
						<Bar
							isAnimationActive={false}
							dataKey="completion_tokens"
							stackId="tokens"
							fill={CHART_COLORS.completionTokens}
							fillOpacity={0.9}
							radius={[0, 0, 0, 0]}
							barSize={30}
						/>
						<Bar
							isAnimationActive={false}
							dataKey="cached_read_tokens"
							stackId="tokens"
							fill={CHART_COLORS.cachedReadTokens}
							fillOpacity={0.9}
							radius={[2, 2, 0, 0]}
							barSize={30}
						/>
					</BarChart>
				) : (
					<AreaChart {...commonProps}>
						<CartesianGrid strokeDasharray="3 3" vertical={false} className={CHART_GRID_CLASS} />
						<XAxis
							dataKey="index"
							type="number"
							domain={[-0.5, chartData.length - 0.5]}
							tick={{ fontSize: 11, className: "fill-muted-foreground" }}
							tickLine={false}
							axisLine={false}
							tickFormatter={(idx) => chartData[Math.round(idx)]?.formattedTime || ""}
							interval="preserveStartEnd"
						/>
						<YAxis
							tick={{ fontSize: 11, className: "fill-muted-foreground" }}
							tickLine={false}
							axisLine={false}
							width={50}
							tickFormatter={(v) => formatCompactNumber(v)}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} />
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="uncached_prompt_tokens"
							stackId="1"
							stroke={CHART_COLORS.promptTokens}
							fill={CHART_COLORS.promptTokens}
							fillOpacity={0.7}
						/>
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="completion_tokens"
							stackId="1"
							stroke={CHART_COLORS.completionTokens}
							fill={CHART_COLORS.completionTokens}
							fillOpacity={0.7}
						/>
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="cached_read_tokens"
							stackId="1"
							stroke={CHART_COLORS.cachedReadTokens}
							fill={CHART_COLORS.cachedReadTokens}
							fillOpacity={0.7}
						/>
					</AreaChart>
				)}
			</ResponsiveContainer>
		</ChartErrorBoundary>
	);
}
export const TokenUsageChart = memo(TokenUsageChartImpl);