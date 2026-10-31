import { describe, expect, test } from "bun:test";

import {
    browserTimezoneOffset,
    buildUsageDays,
    buildUsageMonthLabels,
    buildUsageWeeks,
    cumulativeUsage,
    formatUsageCredits,
    formatUsageCreditsExact,
    formatUsageDay,
    recentUsageTotal,
    summarizeUsage,
    USAGE_MODEL_LIMIT,
    usageCategoryShares,
    usageLevelScale,
    usageModelShares,
} from "../src/lib/credit-usage";
import type { CreditUsageModel, CreditUsageReport } from "../src/services/api/wallet";

const report: CreditUsageReport = {
    from: "2025-10-29",
    to: "2026-10-28",
    days: 365,
    timezoneOffset: 480,
    daily: [
        { date: "2026-08-03", totalMicrocredits: 13_000_000, agentMicrocredits: 0, count: 4, agentCount: 0 },
        { date: "2026-10-01", totalMicrocredits: 34_000_000, agentMicrocredits: 30_000_000, count: 9, agentCount: 6 },
        { date: "2026-10-02", totalMicrocredits: 1_000_000, agentMicrocredits: 1_000_000, count: 1, agentCount: 1 },
        { date: "2026-10-28", totalMicrocredits: 2_500_000, agentMicrocredits: 0, count: 2, agentCount: 0 },
    ],
    categories: [
        { capability: "video", totalMicrocredits: 30_000_000, agentMicrocredits: 25_000_000, count: 3, agentCount: 2 },
        { capability: "image", totalMicrocredits: 20_500_000, agentMicrocredits: 6_000_000, count: 12, agentCount: 5 },
        { capability: "text", totalMicrocredits: 0, agentMicrocredits: 0, count: 0, agentCount: 0 },
    ],
    models: [
        { model: "veo-3", name: "Veo 3", capability: "video", totalMicrocredits: 30_000_000, agentMicrocredits: 25_000_000, count: 3, agentCount: 2 },
        { model: "nano-banana-pro", name: "Nano Banana Pro", capability: "image", totalMicrocredits: 20_500_000, agentMicrocredits: 6_000_000, count: 12, agentCount: 5 },
    ],
};

describe("credit usage dashboard math", () => {
    test("fills every day in the 365-day window and keeps the requested metric", () => {
        const total = buildUsageDays(report, "total");
        expect(total).toHaveLength(365);
        expect(total[0]).toEqual({ date: "2025-10-29", value: 0, count: 0, weekday: 2 });
        expect(total.at(-1)).toEqual({ date: "2026-10-28", value: 2_500_000, count: 2, weekday: 2 });
        const agent = buildUsageDays(report, "agent");
        expect(agent.find((day) => day.date === "2026-10-01")?.value).toBe(30_000_000);
        expect(agent.find((day) => day.date === "2026-08-03")?.value).toBe(0);
    });

    test("summarizes total, peak, weekly average, active days and longest streak", () => {
        const summary = summarizeUsage(buildUsageDays(report, "total"));
        expect(summary.totalMicrocredits).toBe(50_500_000);
        expect(summary.peakMicrocredits).toBe(34_000_000);
        expect(summary.peakDate).toBe("2026-10-01");
        expect(summary.weeklyAverageMicrocredits).toBeCloseTo(50_500_000 / (365 / 7));
        expect(summary.activeDays).toBe(4);
        expect(summary.longestStreak).toBe(2);
        expect(summary.currentStreak).toBe(1);
        expect(summary.count).toBe(16);
        const empty = summarizeUsage(buildUsageDays({ ...report, daily: [] }, "total"));
        expect(empty).toEqual({ totalMicrocredits: 0, peakMicrocredits: 0, peakDate: null, weeklyAverageMicrocredits: 0, activeDays: 0, longestStreak: 0, currentStreak: 0, count: 0 });
        const agent = summarizeUsage(buildUsageDays(report, "agent"));
        expect([agent.totalMicrocredits, agent.activeDays, agent.longestStreak, agent.currentStreak]).toEqual([31_000_000, 2, 2, 0]);
    });

    test("lays out Monday-first week columns with padding outside the window", () => {
        const weeks = buildUsageWeeks(buildUsageDays(report, "total"));
        expect(weeks).toHaveLength(53);
        expect(weeks.every((week) => week.cells.length === 7)).toBe(true);
        // 2025-10-29 是周三，前面补两天。
        expect(weeks[0].cells.slice(0, 2).map((cell) => cell.index)).toEqual([-1, -1]);
        expect(weeks[0].cells[2]).toMatchObject({ date: "2025-10-29", index: 0, weekday: 2 });
        expect(weeks[0].start).toBe("2025-10-29");
        const last = weeks.at(-1)!;
        expect(last.cells[2]).toMatchObject({ date: "2026-10-28", index: 364 });
        expect(last.cells.slice(3).every((cell) => cell.index === -1 && cell.value === 0)).toBe(true);
        expect(last.end).toBe("2026-10-28");
        expect(weeks.reduce((sum, week) => sum + week.value, 0)).toBe(50_500_000);
        expect(weeks.find((week) => week.start <= "2026-10-01" && week.end >= "2026-10-01")?.value).toBe(35_000_000);
    });

    test("ranks heat levels by quartile and always gives the peak the top level", () => {
        const levelOf = usageLevelScale([0, 2, 12, 34]);
        expect([0, 2, 12, 34].map(levelOf)).toEqual([0, 1, 2, 4]);
        expect(usageLevelScale([5])(5)).toBe(4);
        expect(usageLevelScale([])(0)).toBe(0);
        const spread = usageLevelScale([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([1, 3, 5, 7, 8].map(spread)).toEqual([1, 2, 3, 4, 4]);
    });

    test("labels each new month once and drops a cramped leading label", () => {
        const weeks = buildUsageWeeks(buildUsageDays(report, "total"));
        const labels = buildUsageMonthLabels(weeks);
        expect(labels[0]).toEqual({ column: 1, label: "11月" });
        expect(labels.map((label) => label.label)).toEqual(["11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月"]);
        expect(new Set(labels.map((label) => label.column)).size).toBe(labels.length);
    });

    test("accumulates daily values and totals recent days", () => {
        const days = buildUsageDays(report, "total");
        const cumulative = cumulativeUsage(days);
        expect(cumulative).toHaveLength(365);
        expect(cumulative.at(-1)).toBe(50_500_000);
        expect(cumulative[0]).toBe(0);
        expect(recentUsageTotal(days, 30)).toBe(37_500_000);
        expect(recentUsageTotal(days, 1)).toBe(2_500_000);
    });

    test("computes category shares for the selected metric and drops empty categories", () => {
        const total = usageCategoryShares(report.categories, "total");
        expect(total.map((item) => item.capability)).toEqual(["video", "image"]);
        expect(total[0].share).toBeCloseTo(30 / 50.5);
        const agent = usageCategoryShares(report.categories, "agent");
        expect(agent.map((item) => [item.capability, item.value, item.count])).toEqual([
            ["video", 25_000_000, 2],
            ["image", 6_000_000, 5],
        ]);
    });

    test("ranks models for the selected metric with front-end names, code fallback and per-call average", () => {
        const total = usageModelShares(report.models, "total");
        expect(total.map((item) => [item.key, item.label, item.code, item.capability, item.value, item.count])).toEqual([
            ["video:veo-3", "Veo 3", "veo-3", "video", 30_000_000, 3],
            ["image:nano-banana-pro", "Nano Banana Pro", "nano-banana-pro", "image", 20_500_000, 12],
        ]);
        expect(total[0].share).toBeCloseTo(30 / 50.5);
        expect(total[0].average).toBe(10_000_000);
        expect(total[1].average).toBeCloseTo(20_500_000 / 12);
        const agent = usageModelShares(report.models, "agent");
        expect(agent.map((item) => [item.key, item.value, item.count, item.average])).toEqual([
            ["video:veo-3", 25_000_000, 2, 12_500_000],
            ["image:nano-banana-pro", 6_000_000, 5, 1_200_000],
        ]);
        expect(agent[0].share).toBeCloseTo(25 / 31);

        // 名称缺失退回编码，编码也没有时显示“未记录模型”；同一编码在不同类型下分开成行；当前口径为 0 的不列出。
        const fallback = usageModelShares(
            [
                { model: " gpt-image-1 ", name: " ", capability: "image", totalMicrocredits: 2_000_000, agentMicrocredits: 0, count: 1, agentCount: 0 },
                { model: "", name: "", capability: "audio", totalMicrocredits: 1_000_000, agentMicrocredits: 0, count: 2, agentCount: 0 },
                { model: "gpt-image-1", name: "", capability: "other", totalMicrocredits: 500_000, agentMicrocredits: 0, count: 1, agentCount: 0 },
                { model: "idle", name: "Idle", capability: "text", totalMicrocredits: 0, agentMicrocredits: 0, count: 0, agentCount: 0 },
            ],
            "total",
        );
        expect(fallback.map((item) => [item.key, item.label, item.code, item.average])).toEqual([
            ["image:gpt-image-1", "gpt-image-1", "gpt-image-1", 2_000_000],
            ["audio:", "未记录模型", "", 500_000],
            ["other:gpt-image-1", "gpt-image-1", "gpt-image-1", 500_000],
        ]);
        expect(usageModelShares(undefined, "total")).toEqual([]);
    });

    test("lists the top models and folds the long tail, unless only one model would be folded", () => {
        // 15 个模型，消耗 15、14 … 1 积分，合计 120 积分。
        const models: CreditUsageModel[] = Array.from({ length: 15 }, (_, index) => ({
            model: `model-${index + 1}`,
            name: `模型 ${index + 1}`,
            capability: "image",
            totalMicrocredits: (15 - index) * 1_000_000,
            agentMicrocredits: 0,
            count: 15 - index,
            agentCount: 0,
        }));
        expect(USAGE_MODEL_LIMIT).toBe(12);
        const folded = usageModelShares(models, "total");
        expect(folded.map((item) => item.label)).toEqual([...Array.from({ length: 12 }, (_, index) => `模型 ${index + 1}`), "其他 3 个模型"]);
        expect(folded[12]).toMatchObject({ key: "other-models", code: "", capability: null, value: 6_000_000, count: 6, merged: 3, average: 1_000_000 });
        expect(folded[12].share).toBeCloseTo(6 / 120);
        expect(folded.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
        // 恰好多出一个时直接列出，不显示“其他 1 个模型”。
        const thirteen = usageModelShares(models.slice(0, 13), "total");
        expect(thirteen).toHaveLength(13);
        expect(thirteen[12].label).toBe("模型 13");
        expect(usageModelShares(models, "total", 2).map((item) => item.label)).toEqual(["模型 1", "模型 2", "其他 13 个模型"]);
    });

    test("formats credits compactly for cards and precisely for tooltips", () => {
        expect(formatUsageCredits(0)).toBe("0");
        expect(formatUsageCredits(900_000)).toBe("0.9");
        expect(formatUsageCredits(48_000_000)).toBe("48");
        expect(formatUsageCredits(1_234_567)).toBe("1.23");
        expect(formatUsageCredits(456_780_000)).toBe("456.8");
        expect(formatUsageCredits(12_345_000_000)).toBe("1.2万");
        expect(formatUsageCreditsExact(12_345_678_900)).toBe("12,345.68");
        expect(formatUsageDay("2026-10-28")).toBe("10月28日 周三");
        expect(formatUsageDay("2026-10-28", false)).toBe("10月28日");
        expect(browserTimezoneOffset(new Date())).toBe(-new Date().getTimezoneOffset());
    });
});
