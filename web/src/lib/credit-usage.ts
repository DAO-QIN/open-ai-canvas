import type { CreditUsageCapability, CreditUsageCategory, CreditUsageModel, CreditUsageReport } from "@/services/api/wallet";

/**
 * 用量看板的纯计算：把服务端的稀疏日数据补成完整窗口，再派生热力图、周汇总、累计曲线与统计卡。
 * 日期一律按 "YYYY-MM-DD" 的日历日处理（UTC 零点表示），不受浏览器夏令时影响。
 */

export type UsageMetric = "total" | "agent";
export type UsageLevel = 0 | 1 | 2 | 3 | 4;

export type UsageDay = {
    date: string;
    /** 当前口径的消耗（微积分）。 */
    value: number;
    count: number;
    /** 周一为 0，周日为 6。 */
    weekday: number;
};

export type UsageCell = UsageDay & {
    level: UsageLevel;
    /** 在 days 中的下标；窗口前后的补位格为 -1。 */
    index: number;
};

export type UsageWeek = {
    cells: UsageCell[];
    /** 本周窗口内的合计。 */
    value: number;
    count: number;
    /** 本周第一天与最后一天（窗口内）。 */
    start: string;
    end: string;
};

export type UsageMonthLabel = { column: number; label: string };

export type UsageSummary = {
    totalMicrocredits: number;
    peakMicrocredits: number;
    peakDate: string | null;
    weeklyAverageMicrocredits: number;
    activeDays: number;
    longestStreak: number;
    /** 截至窗口最后一天（今天）的连续活跃天数。 */
    currentStreak: number;
    count: number;
};

export type UsageCategoryShare = {
    capability: CreditUsageCapability;
    value: number;
    count: number;
    /** 0–1 */
    share: number;
};

const DAY_MS = 86_400_000;

export const usageCapabilityLabels: Record<CreditUsageCapability, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
    other: "其他",
};

export function parseUsageDate(date: string) {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, (month || 1) - 1, day || 1);
}

export function formatUsageDate(time: number) {
    return new Date(time).toISOString().slice(0, 10);
}

/** 浏览器所在时区的 UTC 偏移分钟数（东八区为 480）。 */
export function browserTimezoneOffset(now = new Date()) {
    return -now.getTimezoneOffset();
}

/** 补齐 from..to 的每一天；缺失日期按 0 计。 */
export function buildUsageDays(report: Pick<CreditUsageReport, "from" | "to" | "daily">, metric: UsageMetric): UsageDay[] {
    const start = parseUsageDate(report.from);
    const end = parseUsageDate(report.to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const byDate = new Map(report.daily.map((day) => [day.date, day]));
    const days: UsageDay[] = [];
    for (let time = start; time <= end; time += DAY_MS) {
        const date = formatUsageDate(time);
        const source = byDate.get(date);
        days.push({
            date,
            value: Math.max(0, source ? (metric === "agent" ? source.agentMicrocredits : source.totalMicrocredits) : 0),
            count: Math.max(0, source ? (metric === "agent" ? source.agentCount : source.count) : 0),
            weekday: (new Date(time).getUTCDay() + 6) % 7,
        });
    }
    return days;
}

export function summarizeUsage(days: UsageDay[]): UsageSummary {
    let total = 0;
    let peak = 0;
    let peakDate: string | null = null;
    let activeDays = 0;
    let longestStreak = 0;
    let streak = 0;
    let count = 0;
    for (const day of days) {
        total += day.value;
        count += day.count;
        if (day.value > peak) {
            peak = day.value;
            peakDate = day.date;
        }
        if (day.value > 0) {
            activeDays += 1;
            streak += 1;
            longestStreak = Math.max(longestStreak, streak);
        } else {
            streak = 0;
        }
    }
    return {
        totalMicrocredits: total,
        peakMicrocredits: peak,
        peakDate,
        weeklyAverageMicrocredits: days.length > 0 ? total / (days.length / 7) : 0,
        activeDays,
        longestStreak,
        currentStreak: streak,
        count,
    };
}

/** 最近 n 天（含今天）的消耗合计。 */
export function recentUsageTotal(days: UsageDay[], n: number) {
    return days.slice(Math.max(0, days.length - n)).reduce((sum, day) => sum + day.value, 0);
}

function quantile(sorted: number[], ratio: number) {
    if (sorted.length === 0) return 0;
    const position = (sorted.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * 按有消耗日期的四分位数分 1–4 级，峰值总是最高一级；
 * 比按最大值线性分级更能区分大多数普通日子。
 */
export function usageLevelScale(values: number[]) {
    const positive = values.filter((value) => value > 0).sort((left, right) => left - right);
    const max = positive.at(-1) ?? 0;
    const [q1, q2, q3] = [0.25, 0.5, 0.75].map((ratio) => quantile(positive, ratio));
    return (value: number): UsageLevel => {
        if (!(value > 0)) return 0;
        if (value >= max) return 4;
        if (value <= q1) return 1;
        if (value <= q2) return 2;
        if (value <= q3) return 3;
        return 4;
    };
}

/** 以周一为首的列；窗口前后的补位格 index 为 -1、value 为 0。 */
export function buildUsageWeeks(days: UsageDay[]): UsageWeek[] {
    if (days.length === 0) return [];
    const levelOf = usageLevelScale(days.map((day) => day.value));
    const leading = days[0].weekday;
    const firstTime = parseUsageDate(days[0].date) - leading * DAY_MS;
    const cellCount = Math.ceil((leading + days.length) / 7) * 7;
    const weeks: UsageWeek[] = [];
    for (let offset = 0; offset < cellCount; offset += 1) {
        const index = offset - leading;
        const day = index >= 0 && index < days.length ? days[index] : null;
        const time = firstTime + offset * DAY_MS;
        const cell: UsageCell = day ? { ...day, level: levelOf(day.value), index } : { date: formatUsageDate(time), value: 0, count: 0, weekday: offset % 7, level: 0, index: -1 };
        if (offset % 7 === 0) weeks.push({ cells: [], value: 0, count: 0, start: "", end: "" });
        const week = weeks[weeks.length - 1];
        week.cells.push(cell);
        if (cell.index >= 0) {
            week.value += cell.value;
            week.count += cell.count;
            week.start ||= cell.date;
            week.end = cell.date;
        }
    }
    return weeks;
}

/** 每列第一次出现新月份时标注；首列若离下个月标签太近则省略，避免文字重叠。 */
export function buildUsageMonthLabels(weeks: UsageWeek[], minGap = 3): UsageMonthLabel[] {
    const labels: UsageMonthLabel[] = [];
    let previousMonth = -1;
    weeks.forEach((week, column) => {
        const firstDay = week.cells.find((cell) => cell.index >= 0);
        if (!firstDay) return;
        const month = Number(firstDay.date.slice(5, 7));
        if (month !== previousMonth) labels.push({ column, label: `${month}月` });
        previousMonth = month;
    });
    if (labels.length > 1 && labels[1].column - labels[0].column < minGap) labels.shift();
    return labels;
}

/** 逐日累计值，与 days 一一对应。 */
export function cumulativeUsage(days: UsageDay[]) {
    let running = 0;
    return days.map((day) => (running += day.value));
}

export function usageCategoryShares(categories: CreditUsageCategory[], metric: UsageMetric): UsageCategoryShare[] {
    const items = categories
        .map((category) => ({
            capability: category.capability,
            value: Math.max(0, metric === "agent" ? category.agentMicrocredits : category.totalMicrocredits),
            count: Math.max(0, metric === "agent" ? category.agentCount : category.count),
        }))
        .filter((item) => item.value > 0)
        .sort((left, right) => right.value - left.value);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    return items.map((item) => ({ ...item, share: total > 0 ? item.value / total : 0 }));
}

export type UsageModelShare = {
    /** 列表 key：类型 + 编码；合并行为 other-models。 */
    key: string;
    /** 前台模型名称，其次是编码；没有记录模型时为“未记录模型”。 */
    label: string;
    /** 原始编码；与名称不同时用作悬停提示。 */
    code: string;
    /** 合并行没有单一类型。 */
    capability: CreditUsageCapability | null;
    value: number;
    count: number;
    /** 0–1，占当前口径的模型总消耗。 */
    share: number;
    /** 平均每笔消耗（微积分）。 */
    average: number;
    /** 这一行包含的模型数，只有合并行大于 1。 */
    merged: number;
};

/** 用量看板按模型查看时单独列出的模型数。 */
export const USAGE_MODEL_LIMIT = 8;

/**
 * 按当前口径列出消耗最多的模型；超出 limit 的合并为“其他 N 个模型”，只多出一个时直接列出。
 * 同一编码在不同生成类型下分别成行（类型标签区分）。
 */
export function usageModelShares(models: CreditUsageModel[] | undefined, metric: UsageMetric, limit = USAGE_MODEL_LIMIT): UsageModelShare[] {
    type Row = Omit<UsageModelShare, "share" | "average">;
    const items: Row[] = (models ?? [])
        .map((item) => {
            const code = (item.model || "").trim();
            return {
                key: `${item.capability}:${code}`,
                label: (item.name || "").trim() || code || "未记录模型",
                code,
                capability: item.capability,
                value: Math.max(0, metric === "agent" ? item.agentMicrocredits : item.totalMicrocredits),
                count: Math.max(0, metric === "agent" ? item.agentCount : item.count),
                merged: 1,
            };
        })
        .filter((item) => item.value > 0)
        .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "zh-CN"));
    const total = items.reduce((sum, item) => sum + item.value, 0);
    const visible = items.length > limit + 1 ? items.slice(0, limit) : items;
    const rest = items.slice(visible.length);
    const rows: Row[] = [...visible];
    if (rest.length > 0) {
        rows.push({
            key: "other-models",
            label: `其他 ${rest.length} 个模型`,
            code: "",
            capability: null,
            value: rest.reduce((sum, item) => sum + item.value, 0),
            count: rest.reduce((sum, item) => sum + item.count, 0),
            merged: rest.length,
        });
    }
    return rows.map((item) => ({ ...item, share: total > 0 ? item.value / total : 0, average: item.count > 0 ? item.value / item.count : 0 }));
}

const compactFormatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

/** 统计卡用的紧凑积分数：万以上用“万”，百以上保留 1 位，其余保留 2 位。 */
export function formatUsageCredits(microcredits: number) {
    const value = microcredits / 1_000_000;
    if (!Number.isFinite(value) || value === 0) return "0";
    const magnitude = Math.abs(value);
    if (magnitude >= 10_000) return compactFormatter.format(value);
    return value.toLocaleString("zh-CN", { maximumFractionDigits: magnitude >= 100 ? 1 : 2 });
}

/** 提示与明细使用的精确积分数（最多 2 位小数）。 */
export function formatUsageCreditsExact(microcredits: number) {
    return (microcredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 2026-10-28 → 10月28日 周三 */
export function formatUsageDay(date: string, withWeekday = true) {
    const time = parseUsageDate(date);
    const value = new Date(time);
    const label = `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
    return withWeekday ? `${label} ${weekdayNames[(value.getUTCDay() + 6) % 7]}` : label;
}

/** 2025-10-29 → 2025年10月29日 */
export function formatUsageFullDate(date: string) {
    const value = new Date(parseUsageDate(date));
    return `${value.getUTCFullYear()}年${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
}
