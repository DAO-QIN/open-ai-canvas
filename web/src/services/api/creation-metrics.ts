import { http } from "./request";

export type CreationMetricsWindow = "24h" | "7d";

/** 分位数取最近秩，没有样本时为 null。 */
export type CreationLatency = {
    p50Ms: number | null;
    p95Ms: number | null;
    samples: number;
};

/** 创作页自动模式（Agent）的运行；cancelled 含拒绝审批，失败率 = failed / finished。 */
export type CreationRunMetrics = {
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    finished: number;
    failureRate: number;
    firstFeedback: CreationLatency;
};

/** 一组生成任务；finished 为成功、失败与取消之和，失败率 = failed / finished。 */
export type CreationTaskMetrics = {
    count: number;
    finished: number;
    failed: number;
    failureRate: number;
    queueWait: CreationLatency;
    total: CreationLatency;
};

/** value / threshold 的单位随 key：耗时为毫秒，失败率为 0-1 的比例，冻结订单为笔数。 */
export type CreationMetricAlert = {
    key: string;
    level: "warning" | "critical";
    title: string;
    value: number;
    threshold: number;
};

export type CreationMetrics = {
    generatedAt: string;
    window: CreationMetricsWindow;
    agent: CreationRunMetrics;
    image: CreationTaskMetrics;
    video: CreationTaskMetrics;
    agentMedia: CreationTaskMetrics;
    interactiveQueue: CreationLatency;
    refunds: { autoRefundEnabled: boolean; autoRefunded: number; stuckFrozen: number };
    alerts: CreationMetricAlert[];
    truncated: boolean;
};

export function getCreationMetrics(metricsWindow: CreationMetricsWindow, signal?: AbortSignal) {
    return http.get<CreationMetrics>("/admin/creation-metrics", { params: { window: metricsWindow }, signal });
}
