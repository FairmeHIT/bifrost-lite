import { useI18n } from "@/lib/i18n/context";
import type { CostHistogramResponse } from "@/lib/types/logs";
import { formatCurrencyNumber } from "@/lib/utils/numbers";
import { memo, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
	CHART_GRID_CLASS,
	CHART_TICK_CLASS,
	CHART_TOOLTIP_CLASS,
	computeDisplaySeries,
	formatCost,
	formatFullTimestamp,
	formatTimestamp,
	getModelColor,
	OTHER_SERIES_COLOR,
	OTHER_SERIES_KEY,
	OTHER_SERIES_LABEL,
} from "../../utils/chartUtils";
import { ChartErrorBoundary } from "./chartErrorBoundary";
import type { ChartType } from "./chartTypeToggle";

interface CostChartProps {
	data: CostHistogramResponse | null;
	chartType: ChartType;
	startTime: number;
	endTime: number;
	selectedModel: string;
}

function CustomTooltip({ active, payload, selectedModel, displayModels }: any) {
	const { t } = useI18n();
	if (!active || !payload || !payload.length) return null;

	const data = payload[0]?.payload;
	if (!data) return null;

	return (
		<div className={CHART_TOOLTIP_CLASS}>
			<div className="text-muted-foreground mb-1 text-xs">{formatFullTimestamp(data.timestamp)}</div>
			<div className="space-y-1 text-sm">
				{selectedModel === "all" ? (
					<>
						{displayModels.map((model: string, idx: number) => {
							const isOther = model === OTHER_SERIES_KEY;
							const cost = isOther ? (data[OTHER_SERIES_KEY] ?? 0) : data.by_model?.[model] || 0;
							if (cost === 0) return null;
							return (
								<div key={model} className="flex items-center justify-between gap-4">
									<span className="flex items-center gap-1.5">
										<span className="h-2 w-2 rounded-full" style={{ backgroundColor: isOther ? OTHER_SERIES_COLOR : getModelColor(idx) }} />
										<span className="text-muted-foreground max-w-[120px] truncate">{isOther ? OTHER_SERIES_LABEL : model}</span>
									</span>
									<span className="font-medium" style={{ color: isOther ? OTHER_SERIES_COLOR : getModelColor(idx) }}>
										{formatCost(cost)}
									</span>
								</div>
							);
						})}
						<div className="border-popover flex items-center justify-between gap-4 border-t pt-1">
							<span className="text-muted-foreground">{t("dashboardCharts.total")}</span>
							<span className="text-popover-foreground font-medium">{formatCost(data.total_cost)}</span>
						</div>
					</>
				) : (
					<div className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: getModelColor(0) }} />
							<span className="text-muted-foreground">{selectedModel}</span>
						</span>
						<span className="text-popover-foreground font-medium">{formatCost(data.by_model?.[selectedModel] || 0)}</span>
					</div>
				)}
			</div>
		</div>
	);
}

function CostChartImpl({ data, chartType, startTime, endTime, selectedModel }: CostChartProps) {
	const { t } = useI18n();
	const { chartData, displayModels } = useMemo(() => {
		if (!data?.buckets || !data.bucket_size_seconds) {
			return { chartData: [], displayModels: [] };
		}

		let models: string[];
		let hasOther = false;
		if (selectedModel === "all") {
			models = computeDisplaySeries(data.buckets, data.models, (b, m) => b.by_model?.[m] ?? 0);
			hasOther = models[models.length - 1] === OTHER_SERIES_KEY;
		} else {
			models = [selectedModel];
		}
		const topSet = new Set(models);

		const processed = data.buckets.map((bucket, index) => {
			const item: any = {
				...bucket,
				index,
				formattedTime: formatTimestamp(bucket.timestamp, data.bucket_size_seconds),
			};
			if (hasOther && bucket.by_model) {
				let otherSum = 0;
				for (const model of data.models) {
					if (!topSet.has(model)) otherSum += bucket.by_model[model] ?? 0;
				}
				item[OTHER_SERIES_KEY] = otherSum;
			}
			models.forEach((model, idx) => {
				item[`model_${idx}`] = model === OTHER_SERIES_KEY ? (item[OTHER_SERIES_KEY] ?? 0) : (bucket.by_model?.[model] ?? 0);
			});
			return item;
		});

		return { chartData: processed, displayModels: models };
	}, [data, selectedModel]);

	if (!data?.buckets || chartData.length === 0) {
		return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">{t("common.noData")}</div>;
	}

	const commonProps = {
		data: chartData,
		margin: { top: 6, right: 4, left: 4, bottom: 0 },
	};

	return (
		<ChartErrorBoundary resetKey={`${startTime}-${endTime}-${chartData.length}-${selectedModel}`}>
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
							tickFormatter={(v) => formatCurrencyNumber(v)}
							domain={[0, (dataMax: number) => Math.max(dataMax, 0.01)]}
							allowDataOverflow={false}
						/>
						<Tooltip
							content={<CustomTooltip selectedModel={selectedModel} displayModels={displayModels} />}
							cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }}
						/>
						{displayModels.map((model, idx) => (
							<Bar
								isAnimationActive={false}
								key={model}
								dataKey={`model_${idx}`}
								stackId="cost"
								fill={model === OTHER_SERIES_KEY ? OTHER_SERIES_COLOR : getModelColor(idx)}
								fillOpacity={0.9}
								barSize={30}
								radius={idx === displayModels.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
							/>
						))}
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
							tickFormatter={(v) => formatCurrencyNumber(v)}
							domain={[0, (dataMax: number) => Math.max(dataMax, 0.01)]}
							allowDataOverflow={false}
						/>
						<Tooltip
							content={<CustomTooltip selectedModel={selectedModel} displayModels={displayModels} />}
							cursor={{ fill: "var(--primary)", fillOpacity: 0.12 }}
						/>
						{displayModels.map((model, idx) => {
							const color = model === OTHER_SERIES_KEY ? OTHER_SERIES_COLOR : getModelColor(idx);
							return (
								<Area
									isAnimationActive={false}
									key={model}
									type="monotone"
									dataKey={`model_${idx}`}
									stackId="1"
									stroke={color}
									fill={color}
									fillOpacity={0.7}
								/>
							);
						})}
					</AreaChart>
				)}
			</ResponsiveContainer>
		</ChartErrorBoundary>
	);
}

export const CostChart = memo(CostChartImpl);