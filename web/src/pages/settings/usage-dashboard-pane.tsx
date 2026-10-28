import { Button } from "antd";
import { History, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { UserAvatar } from "@/components/layout/user-avatar";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { Callout } from "@/components/ui/product/callout";
import { useCreditUsage } from "@/hooks/use-credit-usage";
import { buildUsageDays, buildUsageMonthLabels, buildUsageWeeks, formatUsageCredits, formatUsageCreditsExact, formatUsageDay, formatUsageFullDate, summarizeUsage, usageCapabilityLabels, usageCategoryShares, type UsageMetric } from "@/lib/credit-usage";
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

const percentFormatter = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

/** 用量看板：最近 365 个自然日的积分消耗统计、活动图与消耗构成。 */
export default function UsageDashboardPane() {
    const user = useUserStore((state) => state.user);
    const query = useCreditUsage(user?.id);
    const [metric, setMetric] = useState<UsageMetric>("total");
    const [view, setView] = useState<UsageView>("daily");
    const report = query.data;
    const days = useMemo(() => (report ? buildUsageDays(report, metric) : []), [report, metric]);
    const weeks = useMemo(() => buildUsageWeeks(days), [days]);
    const monthLabels = useMemo(() => buildUsageMonthLabels(weeks), [weeks]);
    const summary = useMemo(() => summarizeUsage(days), [days]);
    const categories = useMemo(() => (report ? usageCategoryShares(report.categories, metric) : []), [report, metric]);

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
                        <p>{view === "daily" ? "颜色越亮，当天消耗越多。" : view === "weekly" ? "柱高为当周消耗合计。" : "曲线为窗口内逐日累计。"}</p>
                    </div>
                    <SegmentedControl size="sm" ariaLabel="图表视图" value={view} onChange={setView} options={viewOptions} className="usage-segmented" />
                </div>
                <UsageActivityChart view={view} days={days} weeks={weeks} monthLabels={monthLabels} />
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
                        <p>按生成类型汇总最近 365 天的{metricName}积分消耗。</p>
                    </div>
                </div>
                {categories.length > 0 ? (
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
                    <p className="usage-empty-note">最近 365 天还没有{metricName}积分消耗，开始创作后这里会展示各类型的占比。</p>
                )}
            </section>
        </div>
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
