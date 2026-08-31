import { useI18n } from "@/lib/i18n/context";
import type { ThroughputHistogramResponse } from "@/lib/types/logs";
import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
	CHART_GRID_CLASS,
	CHART_TICK_CLASS,
	CHART_TOOLTIP_CLASS,
	formatFullTimestamp,
	formatTimestamp,
	formatTokensPerSecond,
	THROUGHPUT_COLOR,
} from "../../utils/chartUtils";
import { ChartErrorBoundary } from "./chartErrorBoundary";
import type { ChartType } from "./chartTypeToggle";

interface ThroughputChartProps {
	data: ThroughputHistogramResponse | null;
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
			<div className="text-muted-foreground mb-1 text-xs">{formatFullTimestamp(data.timestamp)}</div>
			<div className="space-y-1 text-sm">
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: THROUGHPUT_COLOR }} />
						<span className="text-muted-foreground">{t("dashboardCharts.throughput")}</span>
					</span>
					<span className="font-medium">{formatTokensPerSecond(data.tokens_per_second)}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">{t("dashboardCharts.completionTokens")}</span>
					<span className="font-medium">{data.total_completion_tokens.toLocaleString()}</span>
				</div>
				<div className="border-popover flex items-center justify-between gap-4 border-t pt-1">
					<span className="text-muted-foreground">{t("dashboardCharts.requests")}</span>
					<span className="font-medium">{data.total_requests.toLocaleString()}</span>
				</div>
			</div>
		</div>
	);
}

function ThroughputChartImpl({ data, chartType, startTime, endTime }: ThroughputChartProps) {
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
		return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">{t("common.noData")}</div>;
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
							width={70}
							tickFormatter={formatTokensPerSecond}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }} />
						<Bar
							isAnimationActive={false}
							dataKey="tokens_per_second"
							fill={THROUGHPUT_COLOR}
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
							width={70}
							tickFormatter={formatTokensPerSecond}
							domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
							allowDataOverflow={false}
						/>
						<Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }} />
						<Area
							isAnimationActive={false}
							type="monotone"
							dataKey="tokens_per_second"
							stroke={THROUGHPUT_COLOR}
							fill={THROUGHPUT_COLOR}
							fillOpacity={0.4}
						/>
					</AreaChart>
				)}
			</ResponsiveContainer>
		</ChartErrorBoundary>
	);
}
export const ThroughputChart = memo(ThroughputChartImpl);