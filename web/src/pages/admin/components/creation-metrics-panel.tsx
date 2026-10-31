import { Alert, Button } from "antd";
import dayjs from "dayjs";
import { Bot, Clapperboard, Clock3, Image as ImageIcon, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CreditIcon } from "@/constant/credits";
import { getCreationMetrics, type CreationLatency, type CreationMetrics, type CreationMetricsWindow, type CreationTaskMetrics } from "@/services/api/creation-metrics";
import { formatNumber } from "./analytics-trend-delta";

const windowOptions: ReadonlyArray<readonly [CreationMetricsWindow, string]> = [
    ["24h", "24 小时"],
    ["7d", "7 天"],
];

type MetricRow = readonly [label: string, value: string];

export function formatCreationSeconds(ms: number | null | undefined) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "--";
    return `${(ms / 1000).toFixed(1)} 秒`;
}

export function formatCreationLatency(latency: CreationLatency | undefined) {
    if (!latency?.samples) return "--";
    return `P50 ${formatCreationSeconds(latency.p50Ms)} · P95 ${formatCreationSeconds(latency.p95Ms)}`;
}

/** 没有已结束样本时不显示 0%，避免把“没有数据”读成“没有失败”。 */
export function formatCreationFailureRate(rate: number, finished: number) {
    if (!finished) return "--";
    return `${(rate * 100).toFixed(1)}%（已结束 ${formatNumber(finished)}）`;
}

export default function CreationMetricsPanel() {
    const [metricsWindow, setMetricsWindow] = useState<CreationMetricsWindow>("24h");
    const [data, setData] = useState<CreationMetrics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        getCreationMetrics(metricsWindow, controller.signal)
            .then((result) => {
                if (!controller.signal.aborted) setData(result);
            })
            .catch((reason: unknown) => {
                if (controller.signal.aborted) return;
                setError(reason instanceof Error ? reason.message : "读取创作体验数据失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [metricsWindow, reloadKey]);

    return <CreationMetricsView data={data && data.window === metricsWindow ? data : null} metricsWindow={metricsWindow} loading={loading} error={error} onWindowChange={setMetricsWindow} onRefresh={() => setReloadKey((value) => value + 1)} />;
}

export function CreationMetricsView({
    data,
    metricsWindow,
    loading,
    error,
    onWindowChange,
    onRefresh,
}: {
    data: CreationMetrics | null;
    metricsWindow: CreationMetricsWindow;
    loading: boolean;
    error: string;
    onWindowChange: (value: CreationMetricsWindow) => void;
    onRefresh: () => void;
}) {
    const alerts = data?.alerts ?? [];
    const alerted = new Set(alerts.map((alert) => alert.key));
    const toneFor = (...keys: string[]) => (keys.some((key) => alerted.has(key)) ? "warning" : "neutral");
    const queue = data?.interactiveQueue;
    const refunds = data?.refunds;

    return (
        <section className="mb-3 flex flex-col gap-3" aria-labelledby="admin-creation-metrics-title" aria-busy={loading}>
            <div className="admin-analytics-section-heading">
                <div>
                    <h2 id="admin-creation-metrics-title">创作体验</h2>
                    <p>创作页用户实际等待的时间与失败情况{data ? ` · 统计于 ${dayjs(data.generatedAt).format("MM-DD HH:mm")}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <div className="admin-analytics-trend-switch" role="group" aria-label="统计时间">
                        {windowOptions.map(([value, label]) => (
                            <button key={value} type="button" className={metricsWindow === value ? "is-active" : undefined} aria-pressed={metricsWindow === value} onClick={() => onWindowChange(value)}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <Button size="small" icon={<RefreshCw className="size-4" />} loading={loading} onClick={onRefresh}>
                        刷新
                    </Button>
                </div>
            </div>

            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="创作体验数据读取失败"
                    description={error}
                    action={
                        <Button size="small" onClick={onRefresh}>
                            重试
                        </Button>
                    }
                />
            ) : null}
            {alerts.map((alert) => (
                <Alert key={alert.key} type={alert.level === "critical" ? "error" : "warning"} showIcon title={alert.title} />
            ))}
            {data?.truncated ? <Alert type="info" showIcon title="统计时间内的记录过多，只统计了最近的一部分" /> : null}

            <div className="admin-analytics-health-grid">
                <CreationMetricCard
                    icon={<Bot className="size-4" />}
                    label="自动"
                    value={data ? `${formatNumber(data.agent.runs)} 轮` : "--"}
                    tone={toneFor("agent_first_feedback_p95", "agent_failure_rate")}
                    rows={[
                        ["失败率", data ? formatCreationFailureRate(data.agent.failureRate, data.agent.finished) : "--"],
                        ["首个反馈", formatCreationLatency(data?.agent.firstFeedback)],
                    ]}
                />
                <CreationTaskCard icon={<ImageIcon className="size-4" />} label="图片" stats={data?.image} tone={toneFor("image_failure_rate")} />
                <CreationTaskCard icon={<Clapperboard className="size-4" />} label="视频" stats={data?.video} tone={toneFor("video_failure_rate")} />
                <CreationTaskCard icon={<Sparkles className="size-4" />} label="Agent 出图" stats={data?.agentMedia} tone="neutral" />
                <CreationMetricCard
                    icon={<Clock3 className="size-4" />}
                    label="交互排队"
                    value={queue?.samples ? `P95 ${formatCreationSeconds(queue.p95Ms)}` : "--"}
                    tone={toneFor("interactive_queue_p95")}
                    rows={[
                        ["P50", queue?.samples ? formatCreationSeconds(queue.p50Ms) : "--"],
                        ["样本", queue ? `${formatNumber(queue.samples)} 个任务` : "--"],
                    ]}
                />
                <CreationMetricCard
                    icon={<CreditIcon className="size-4" />}
                    label="积分退回"
                    value={refunds ? `${formatNumber(refunds.stuckFrozen)} 笔仍冻结` : "--"}
                    tone={toneFor("auto_refund_stuck")}
                    rows={[
                        ["自动退回", refunds ? `${formatNumber(refunds.autoRefunded)} 笔` : "--"],
                        ["退回开关", refunds ? (refunds.autoRefundEnabled ? "已开启" : "未开启") : "--"],
                    ]}
                    detail="仍冻结：任务结束超过 30 分钟，积分还没有退回或结算"
                />
            </div>
        </section>
    );
}

function CreationTaskCard({ icon, label, stats, tone }: { icon: ReactNode; label: string; stats?: CreationTaskMetrics; tone: "warning" | "neutral" }) {
    return (
        <CreationMetricCard
            icon={icon}
            label={label}
            value={stats ? `${formatNumber(stats.count)} 个` : "--"}
            tone={tone}
            rows={[
                ["失败率", stats ? formatCreationFailureRate(stats.failureRate, stats.finished) : "--"],
                ["排队", formatCreationLatency(stats?.queueWait)],
                ["总耗时", formatCreationLatency(stats?.total)],
            ]}
        />
    );
}

function CreationMetricCard({ icon, label, value, tone, rows, detail }: { icon: ReactNode; label: string; value: string; tone: "warning" | "neutral"; rows: MetricRow[]; detail?: string }) {
    return (
        <article className="admin-analytics-health-card" data-tone={tone}>
            <div className="admin-analytics-health-card-heading">
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
            </div>
            <div className="admin-analytics-health-card-value">{value}</div>
            <dl className="mt-2 grid gap-1 text-xs leading-4">
                {rows.map(([rowLabel, rowValue]) => (
                    <div key={rowLabel} className="flex min-w-0 items-baseline justify-between gap-3">
                        <dt className="shrink-0" style={{ color: "var(--admin-text-muted)" }}>
                            {rowLabel}
                        </dt>
                        <dd className="m-0 min-w-0 truncate text-right tabular-nums" style={{ color: "var(--admin-text-secondary)" }} title={rowValue}>
                            {rowValue}
                        </dd>
                    </div>
                ))}
            </dl>
            {detail ? <div className="admin-analytics-health-card-meta">{detail}</div> : null}
        </article>
    );
}
