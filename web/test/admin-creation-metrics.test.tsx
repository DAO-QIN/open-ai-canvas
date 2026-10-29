import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";

import { CreationMetricsView, formatCreationFailureRate, formatCreationLatency, formatCreationSeconds } from "../src/pages/admin/components/creation-metrics-panel";
import type { CreationLatency, CreationMetrics } from "../src/services/api/creation-metrics";

const latency = (p50Ms: number | null, p95Ms: number | null, samples: number): CreationLatency => ({ p50Ms, p95Ms, samples });

const metrics: CreationMetrics = {
    generatedAt: "2026-10-29T12:00:00+08:00",
    window: "24h",
    agent: { runs: 42, completed: 38, failed: 2, cancelled: 1, finished: 41, failureRate: 2 / 41, firstFeedback: latency(1840, 6200, 40) },
    image: { count: 120, finished: 118, failed: 3, failureRate: 3 / 118, queueWait: latency(300, 2100, 119), total: latency(14000, 31000, 118) },
    video: { count: 0, finished: 0, failed: 0, failureRate: 0, queueWait: latency(null, null, 0), total: latency(null, null, 0) },
    agentMedia: { count: 64, finished: 60, failed: 6, failureRate: 0.1, queueWait: latency(800, 4000, 62), total: latency(20000, 45000, 60) },
    interactiveQueue: latency(400, 3500, 300),
    refunds: { autoRefundEnabled: true, autoRefunded: 4, stuckFrozen: 1 },
    alerts: [
        { key: "agent_first_feedback_p95", level: "warning", title: "自动模式首个反馈 P95 为 6.2 秒，超过 5 秒", value: 6200, threshold: 5000 },
        { key: "auto_refund_stuck", level: "critical", title: "自动退回没有生效：1 笔订单在任务结束 30 分钟后仍冻结积分", value: 1, threshold: 0 },
    ],
    truncated: false,
};

function render(data: CreationMetrics | null, options: { loading?: boolean; error?: string } = {}) {
    return renderToStaticMarkup(
        <App>
            <CreationMetricsView data={data} metricsWindow="24h" loading={options.loading ?? false} error={options.error ?? ""} onWindowChange={() => {}} onRefresh={() => {}} />
        </App>,
    );
}

test("耗时按秒保留一位小数，没有样本时显示占位", () => {
    expect(formatCreationSeconds(1840)).toBe("1.8 秒");
    expect(formatCreationSeconds(0)).toBe("0.0 秒");
    expect(formatCreationSeconds(null)).toBe("--");
    expect(formatCreationLatency(latency(1840, 6200, 40))).toBe("P50 1.8 秒 · P95 6.2 秒");
    expect(formatCreationLatency(latency(null, null, 0))).toBe("--");
    expect(formatCreationFailureRate(3 / 118, 118)).toBe("2.5%（已结束 118）");
    expect(formatCreationFailureRate(0, 0)).toBe("--");
});

test("提醒排在卡片前面，四类创作卡片、交互排队与积分退回都展示", () => {
    const html = render(metrics);
    for (const label of ["创作体验", "自动", "图片", "视频", "Agent 出图", "交互排队", "积分退回", "24 小时", "7 天"]) expect(html).toContain(label);
    expect(html).toContain("42 轮");
    expect(html).toContain("P50 1.8 秒 · P95 6.2 秒");
    expect(html).toContain("4.9%（已结束 41）");
    expect(html).toContain("P95 3.5 秒");
    expect(html).toContain("1 笔仍冻结");
    expect(html).toContain("已开启");
    const firstAlert = html.indexOf("自动模式首个反馈 P95 为 6.2 秒，超过 5 秒");
    expect(firstAlert).toBeGreaterThan(-1);
    expect(firstAlert).toBeLessThan(html.indexOf("42 轮"));
    // 严重级别用错误样式，一般提醒用警告样式。
    expect(html).toContain("ant-alert-error");
    expect(html).toContain("ant-alert-warning");
    expect(html).toContain('aria-pressed="true"');
    // 视频没有已结束任务时失败率不显示 0%。
    expect(html).not.toContain("0.0%（已结束 0）");
});

test("界面文案只用中文，保留产品名 Agent", () => {
    const text = render(metrics).replace(/<[^>]+>/g, " ");
    const words = text.match(/[A-Za-z]{2,}/g) ?? [];
    expect(words.filter((word) => word !== "Agent")).toEqual([]);
});

test("数据未返回时显示占位，读取失败时就地提示并可重试", () => {
    const html = render(null, { loading: true, error: "网络连接已断开" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("创作体验数据读取失败");
    expect(html).toContain("网络连接已断开");
    // antd 会在两个汉字的纯文字按钮中间补空格。
    expect(html).toMatch(/重\s?试/);
    expect(html).not.toContain("统计于");
    expect(html.match(/--/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
});
