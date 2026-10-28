import type { CommissionRecord } from "@/services/api/promotion";
import { commissionRemaining } from "@/lib/promotion-credits";

export type CommissionState = "pending" | "ready" | "done" | "unknown";

export function commissionStatus(record: CommissionRecord, serverNow: number): { label: string; tone: "neutral" | "success" | "warning"; state: CommissionState } {
    const remaining = commissionRemaining(record);
    if (remaining <= BigInt(0)) {
        return BigInt(record.transferredMicrocredits) === BigInt(record.amountMicrocredits) ? { label: "已领取", tone: "neutral", state: "done" } : { label: "已结束", tone: "neutral", state: "done" };
    }
    const availableAt = new Date(record.availableAt).getTime();
    if (!Number.isFinite(availableAt)) return { label: "待确认", tone: "warning", state: "unknown" };
    if (availableAt <= serverNow) return { label: "可领取", tone: "success", state: "ready" };
    return { label: `${countdownLabel(availableAt - serverNow)}后到账`, tone: "warning", state: "pending" };
}

/** 待到账倒计时：按天向上取整，最后一天按小时，避免显示「0 天」。 */
export function countdownLabel(ms: number): string {
    const hours = Math.max(1, Math.ceil(ms / 3_600_000));
    return hours > 24 ? `${Math.ceil(hours / 24)} 天` : `${hours} 小时`;
}

export function promotionDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 账单式列表左侧日期列：月-日 与 时:分 分两行。 */
export function promotionDateParts(value: string): { day: string; time: string } {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return { day: "—", time: "" };
    const pad = (part: number) => String(part).padStart(2, "0");
    return { day: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}
