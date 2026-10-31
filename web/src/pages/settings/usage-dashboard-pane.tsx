import { Button } from "antd";
import { History, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { UserAvatar } from "@/components/layout/user-avatar";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { Callout } from "@/components/ui/product/callout";
import { useCreditUsage } from "@/hooks/use-credit-usage";
import {
    buildUsageDays,
    buildUsageMonthLabels,
    buildUsageWeeks,
    formatUsageCredits,
    formatUsageCreditsExact,
    formatUsageDay,
    formatUsageFullDate,
    summarizeUsage,
    usageBreakdownBetween,
    usageCapabilityLabels,
    usageCategoryShares,
    usageModelShares,
    type UsageDay,
    type UsageMetric,
    type UsageModelShare,
    type UsageWeek,
} from "@/lib/credit-usage";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { useUserStore } from "@/stores/use-user-store";
import { UsageActivityChart, type UsageView } from "./usage-activity-chart";
import { UsageDashboardSkeleton } from "./usage-dashboard-skeleton";

const metricOptions: Array<{ value: UsageMetric; label: string }> = [
    { value: "total", label: "总用量" },
    { value: "agent", label: "Agent 用量" },
];

const viewOptions: Array<{ value: UsageView; label: string }> = [
    { value: "daily", label: "每日" },
    { value: "weekly", label: "每周" },
    { value: "cumulative", label: "累计" },
];

type UsageBreakdown = "capability" | "model";

const breakdownOptions: Array<{ value: UsageBreakdown; label: string }> = [
    { value: "capability", label: "按类型" },
    { value: "model", label: "按模型" },
];

const percentFormatter = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

/** 消耗构成对应的日期区间（含首尾）；index 是活动图里对应的单日 / 单周下标，累计视图为 null。 */
type UsagePeriod = { index: number | null; start: string; end: string; latest: boolean };

/** 每日看选中的一天，每周看选中那天所在的一周，没有选中时看最近一天 / 本周；累计看整个窗口。 */
function resolveUsagePeriod(view: UsageView, days: UsageDay[], weeks: UsageWeek[], selectedDate: string | null): UsagePeriod | null {
    if (days.length === 0) return null;
    if (view === "daily") {
        const found = selectedDate ? days.findIndex((day) => day.date === selectedDate) : -1;
        const index = found >= 0 ? found : days.length - 1;
        return { index, start: days[index].date, end: days[index].date, latest: index === days.length - 1 };
    }
    if (view === "weekly") {
        const found = selectedDate ? weeks.findIndex((week) => week.start <= selectedDate && selectedDate <= week.end) : -1;
        const index = found >= 0 ? found : weeks.length - 1;
        return { index, start: weeks[index].start, end: weeks[index].end, latest: index === weeks.length - 1 };
    }
    return { index: null, start: days[0].date, end: days[days.length - 1].date, latest: true };
}

function usagePeriodLabel(view: UsageView, period: UsagePeriod | null) {
    if (!period || view === "cumulative") return "最近 365 天";
    if (view === "daily") return period.latest ? `今天（${formatUsageDay(period.start)}）` : formatUsageDay(period.start);
    const range = period.start === period.end ? formatUsageDay(period.start, false) : `${formatUsageDay(period.start, false)} – ${formatUsageDay(period.end, false)}`;
    return period.latest ? `本周（${range}）` : range;
}

/** 用量看板：最近 365 个自然日的积分消耗统计、活动图与消耗构成。 */
export default function UsageDashboardPane() {
    const user = useUserStore((state) => state.user);
    const query = useCreditUsage(user?.id);
    const [metric, setMetric] = useState<UsageMetric>("total");
    const [view, setView] = useState<UsageView>("daily");
    // 活动图里选中的日期（每周视图存所选周的首日）；为空时看最近一天 / 本周。
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [breakdown, setBreakdown] = useState<UsageBreakdown>("capability");
    const report = query.data;
    const days = useMemo(() => (report ? buildUsageDays(report, metric) : []), [report, metric]);
    const weeks = useMemo(() => buildUsageWeeks(days), [days]);
    const monthLabels = useMemo(() => buildUsageMonthLabels(weeks), [weeks]);
    const summary = useMemo(() => summarizeUsage(days), [days]);
    const period = useMemo(() => resolveUsagePeriod(view, days, weeks, selectedDate), [view, days, weeks, selectedDate]);
    const breakdownSource = useMemo(() => (report && period ? usageBreakdownBetween(report, period.start, period.end) : null), [report, period]);
    const categories = useMemo(() => (breakdownSource ? usageCategoryShares(breakdownSource.categories, metric) : []), [breakdownSource, metric]);
    const models = useMemo(() => (breakdownSource ? usageModelShares(breakdownSource.models, metric) : []), [breakdownSource, metric]);

    if (!user) return null;
    if (query.isPending) return <UsageDashboardSkeleton />;

    const metricName = metric === "agent" ? "Agent " : "";
    const header = (
        <div className="settings-pane-header">
            <div className="min-w-0">
                <h2>用量看板</h2>
                <p>最近 365 天的积分消耗，按当前设备的时区偏移划分自然日；只计入实际扣费，不含冻结与退款。</p>
            </div>
            <div className="usage-header-actions">
                <Button icon={<History className="size-4" />} onClick={() => openWorkspaceWallet({ tab: "history" })}>
                    消耗明细
                </Button>
                <Button icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>
                    刷新
                </Button>
            </div>
        </div>
    );

    // 只有完全没有数据时才整块显示错误；刷新失败保留上一次的看板，顶部提示即可。
    if (!report) {
        return (
            <div className="usage-dashboard">
                {header}
                <Callout
                    tone="error"
                    title="用量数据加载失败"
                    role="alert"
                    action={
                        <Button size="small" onClick={() => void query.refetch()}>
                            重试
                        </Button>
                    }
                >
                    {query.error instanceof Error ? query.error.message : "请稍后重试"}
                </Callout>
            </div>
        );
    }

    const activeShare = days.length > 0 ? summary.activeDays / days.length : 0;
    const footer =
        view === "daily"
            ? summary.activeDays > 0
                ? `${days.length} 天中有 ${summary.activeDays} 天产生${metricName}消耗`
                : `最近 365 天还没有${metricName}积分消耗`
            : view === "weekly"
              ? "每列为一周（周一至周日）的合计"
              : `截至今天累计消耗 ${formatUsageCreditsExact(summary.totalMicrocredits)} 积分`;

    // 切换视图回到最近一天 / 本周 / 整个窗口。
    const changeView = (next: UsageView) => {
        setView(next);
        setSelectedDate(null);
    };
    const selectPeriod = (index: number) => setSelectedDate((view === "weekly" ? weeks[index]?.start : days[index]?.date) ?? null);
    const periodLabel = usagePeriodLabel(view, period);
    const emptyNote =
        summary.totalMicrocredits <= 0 || !period || view === "cumulative"
            ? `最近 365 天还没有${metricName}积分消耗，开始创作后这里会${breakdown === "model" ? "列出各模型的消耗" : "展示各类型的占比"}。`
            : view === "daily"
              ? `${period.latest ? "今天还" : periodLabel}没有${metricName}积分消耗，点击上方的格子查看其他日期。`
              : `${period.latest ? "本周还" : `${periodLabel} 这一周`}没有${metricName}积分消耗，点击上方的柱子查看其他周。`;

    return (
        <div className="usage-dashboard">
            {header}

            {query.isRefetchError ? (
                <Callout tone="warning" title="刷新失败，显示的是上一次的数据" role="status">
                    {query.error instanceof Error ? query.error.message : "请稍后重试"}
                </Callout>
            ) : null}

            <div className="usage-scope">
                <div className="usage-scope-identity">
                    <UserAvatar user={user} className="usage-scope-avatar" />
                    <div className="min-w-0">
                        <strong>
                            {user.displayName || user.username}
                            <span aria-hidden="true"> · </span>
                            最近 365 天
                        </strong>
                        <span>
                            {formatUsageFullDate(report.from)} – {formatUsageFullDate(report.to)}
                        </span>
                    </div>
                </div>
                <SegmentedControl ariaLabel="统计口径" value={metric} onChange={setMetric} options={metricOptions} className="usage-segmented" />
            </div>

            <ul className="usage-stats" aria-label={`${metricName}用量概览`}>
                <UsageStat label={`${metricName}总消耗`} value={formatUsageCredits(summary.totalMicrocredits)} unit="积分" hint={`共 ${summary.count.toLocaleString("zh-CN")} 笔`} />
                <UsageStat label="单日峰值" value={formatUsageCredits(summary.peakMicrocredits)} unit="积分" hint={summary.peakDate ? formatUsageDay(summary.peakDate) : "暂无消耗"} />
                <UsageStat label="周均消耗" value={formatUsageCredits(summary.weeklyAverageMicrocredits)} unit="积分" hint="按 52 周折算" />
                <UsageStat label="活跃天数" value={summary.activeDays.toLocaleString("zh-CN")} unit="天" hint={`占全年 ${percentFormatter.format(activeShare)}`} />
                <UsageStat label="最长连续活跃" value={summary.longestStreak.toLocaleString("zh-CN")} unit="天" hint={summary.currentStreak > 0 ? `当前连续 ${summary.currentStreak} 天` : "今天还没有消耗"} />
            </ul>

            <section className="usage-panel" aria-labelledby="usage-activity-title">
                <div className="usage-panel-header">
                    <div className="min-w-0">
                        <h3 id="usage-activity-title">积分活动</h3>
                        <p>{view === "daily" ? "颜色越亮，当天消耗越多；点击格子查看当天的消耗构成。" : view === "weekly" ? "柱高为当周消耗合计；点击柱子查看当周的消耗构成。" : "曲线为窗口内逐日累计。"}</p>
                    </div>
                    <SegmentedControl size="sm" ariaLabel="图表视图" value={view} onChange={changeView} options={viewOptions} className="usage-segmented" />
                </div>
                <UsageActivityChart view={view} days={days} weeks={weeks} monthLabels={monthLabels} selected={period?.index ?? null} onSelect={selectPeriod} />
                <div className="usage-panel-footer">
                    <span>{footer}</span>
                    {view === "daily" ? (
                        <span className="usage-legend" aria-hidden="true">
                            少
                            {[0, 1, 2, 3, 4].map((level) => (
                                <i key={level} className="usage-cell" data-level={level} />
                            ))}
                            多
                        </span>
                    ) : null}
                </div>
            </section>

            <section className="usage-panel" aria-labelledby="usage-breakdown-title">
                <div className="usage-panel-header">
                    <div className="min-w-0">
                        <h3 id="usage-breakdown-title">消耗构成</h3>
                        <p>{breakdown === "model" ? `按模型汇总${periodLabel}的${metricName}积分消耗，并给出平均每笔消耗。` : `按生成类型汇总${periodLabel}的${metricName}积分消耗。`}</p>
                    </div>
                    <SegmentedControl size="sm" ariaLabel="构成维度" value={breakdown} onChange={setBreakdown} options={breakdownOptions} className="usage-segmented" />
                </div>
                {breakdown === "model" ? (
                    <UsageModelList items={models} metricName={metricName} emptyNote={emptyNote} />
                ) : categories.length > 0 ? (
                    <>
                        <div className="usage-breakdown-bar" role="img" aria-label={categories.map((item) => `${usageCapabilityLabels[item.capability]} ${percentFormatter.format(item.share)}`).join("，")}>
                            {categories.map((item) => (
                                <span key={item.capability} className="usage-breakdown-segment" data-capability={item.capability} style={{ flexGrow: item.share }} />
                            ))}
                        </div>
                        <ul className="usage-breakdown-list">
                            {categories.map((item) => (
                                <li key={item.capability}>
                                    <span className="usage-breakdown-name">
                                        <i className="usage-breakdown-dot" data-capability={item.capability} aria-hidden="true" />
                                        {usageCapabilityLabels[item.capability]}
                                    </span>
                                    <span className="usage-breakdown-count">{item.count.toLocaleString("zh-CN")} 笔</span>
                                    <span className="usage-breakdown-value">{formatUsageCreditsExact(item.value)} 积分</span>
                                    <span className="usage-breakdown-share">{percentFormatter.format(item.share)}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <p className="usage-empty-note">{emptyNote}</p>
                )}
            </section>
        </div>
    );
}

/** 模型排行：每行一个模型，条长按最多的那一行归一，便于横向比较。 */
function UsageModelList({ items, metricName, emptyNote }: { items: UsageModelShare[]; metricName: string; emptyNote: string }) {
    if (items.length === 0) {
        return <p className="usage-empty-note">{emptyNote}</p>;
    }
    const max = items.reduce((value, item) => Math.max(value, item.value), 0);
    return (
        <ol className="usage-model-list" aria-label={`${metricName}模型消耗排行`}>
            {items.map((item) => (
                <li key={item.key} className="usage-model-row">
                    <span className="usage-model-name">
                        <i className="usage-breakdown-dot" data-capability={item.capability ?? "other"} aria-hidden="true" />
                        <span className="usage-model-label" title={item.code && item.code !== item.label ? item.code : undefined}>
                            {item.label}
                        </span>
                        {item.capability && usageCapabilityLabels[item.capability] !== item.label ? <span className="usage-model-tag">{usageCapabilityLabels[item.capability]}</span> : null}
                    </span>
                    <span className="usage-model-bar" aria-hidden="true">
                        <i data-capability={item.capability ?? "other"} style={{ width: `${max > 0 ? Math.max(2, (item.value / max) * 100).toFixed(2) : 0}%` }} />
                    </span>
                    <span className="usage-model-meta">
                        <span>{item.count.toLocaleString("zh-CN")} 笔</span>
                        <span>平均每笔 {formatUsageCreditsExact(item.average)}</span>
                        <strong>{formatUsageCreditsExact(item.value)} 积分</strong>
                    </span>
                    <span className="usage-model-share">{percentFormatter.format(item.share)}</span>
                </li>
            ))}
        </ol>
    );
}

function UsageStat({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) {
    return (
        <li className="usage-stat">
            <span className="usage-stat-label">{label}</span>
            <span className="usage-stat-value">
                {value}
                <small>{unit}</small>
            </span>
            <span className="usage-stat-hint">{hint}</span>
        </li>
    );
}
