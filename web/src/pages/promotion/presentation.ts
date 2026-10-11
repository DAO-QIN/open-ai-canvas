import type { CommissionRecord } from "@/services/api/promotion";
import { commissionRemaining } from "@/lib/promotion-credits";

export function commissionStatus(record: CommissionRecord, serverNow: number): { label: string; tone: "neutral" | "success" | "warning" } {
    const remaining = commissionRemaining(record);
    if (remaining <= BigInt(0)) {
        return BigInt(record.transferredMicrocredits) === BigInt(record.amountMicrocredits) ? { label: "已转入", tone: "neutral" } : { label: "已结束", tone: "neutral" };
    }
    const availableAt = new Date(record.availableAt).getTime();
    if (!Number.isFinite(availableAt)) return { label: "待确认", tone: "warning" };
    return availableAt > serverNow ? { label: "待解锁", tone: "warning" } : { label: "可转入", tone: "success" };
}

export function promotionDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
