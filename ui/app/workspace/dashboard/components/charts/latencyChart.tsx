import { useI18n } from "@/lib/i18n/context";
import type { LatencyHistogramResponse } from "@/lib/types/logs";
import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
	CHART_GRID_CLASS,
	CHART_TICK_CLASS,
	CHART_TOOLTIP_CLASS,
	formatFullTimestamp,
	formatLatency,
	formatTimestamp,
	LATENCY_COLORS,
} from "../../utils/chartUtils";
import { ChartErrorBoundary } from "./chartErrorBoundary";
import type { ChartType } from "./chartTypeToggle";

interface LatencyChartProps {
	data: LatencyHistogramResponse | null;
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
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.avg }} />
						<span className="text-muted-foreground">{t("dashboardCharts.avg")}</span>
					</span>
					<span className="font-medium">{formatLatency(data.avg_latency)}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p90 }} />
						<span className="text-muted-foreground">P90</span>
					</span>
					<span className="font-medium">{formatLatency(data.p90_latency)}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p95 }} />
						<span className="text-muted-foreground">P95</span>
					</span>
					<span className="font-medium">{formatLatency(data.p95_latency)}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: LATENCY_COLORS.p99 }} />
						<span className="text-muted-foreground">P99</span>
					</span>
					<span className="font-medium">{formatLatency(data.p99_latency)}</span>
				</div>
				<div className="flex items-center justify-between gap-4 border-t border-popover pt-1">
					<span className="text-muted-foreground">{t("dashboardCharts.requests")}</span>
					<span className="font-medium">{data.total_requests.toLocaleString()}</span>
				</div>
			</div>
		</div>
	);
}

function LatencyChartImpl({ data, chartType, startTime, endTime }: LatencyChartProps) {
	const { t } = useI18n();
	const chartData = useMemo(() => {
		if (!data?.buckets || !data.bucket_size_seconds) {
			return [];
		}

		return data.buckets.map((bucket, index) => ({
			...bucket,
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
							width={55}
							tickFormatter={formatLatency}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }} />
						<Bar
							isAnimationActive={false}
							dataKey="avg_latency"
							fill={LATENCY_COLORS.avg}
							fillOpacity={0.9}
							barSize={8}
							radius={[2, 2, 0, 0]}
						/>
						<Bar
							isAnimationActive={false}
							dataKey="p90_latency"
							fill={LATENCY_COLORS.p90}
							fillOpacity={0.9}
							barSize={8}
							radius={[2, 2, 0, 0]}
						/>
						<Bar
							isAnimationActive={false}
							dataKey="p95_latency"
							fill={LATENCY_COLORS.p95}
							fillOpacity={0.9}
							barSize={8}
							radius={[2, 2, 0, 0]}
						/>
						<Bar
							isAnimationActive={false}
							dataKey="p99_latency"
							fill={LATENCY_COLORS.p99}
							fillOpacity={0.9}
							barSize={8}
							radius={[2, 2, 0, 0]}
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
							width={55}
							tickFormatter={formatLatency}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }} />
						{/* Render P99 first (behind), then overlay in descending order so Avg is in front */}
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="p99_latency"
							stroke={LATENCY_COLORS.p99}
							fill={LATENCY_COLORS.p99}
							fillOpacity={0.15}
						/>
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="p95_latency"
							stroke={LATENCY_COLORS.p95}
							fill={LATENCY_COLORS.p95}
							fillOpacity={0.2}
						/>
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="p90_latency"
							stroke={LATENCY_COLORS.p90}
							fill={LATENCY_COLORS.p90}
							fillOpacity={0.25}
						/>
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="avg_latency"
							stroke={LATENCY_COLORS.avg}
							fill={LATENCY_COLORS.avg}
							fillOpacity={0.4}
						/>
					</AreaChart>
				)}
			</ResponsiveContainer>
		</ChartErrorBoundary>
	);
}
export const LatencyChart = memo(LatencyChartImpl);