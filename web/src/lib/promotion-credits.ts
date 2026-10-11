import type { TransferRequest } from "@/services/api/promotion";

const scale = BigInt(1_000_000);
export const MAX_PROMOTION_TRANSFER = BigInt("9007199254740991");

export function formatPromotionCredits(microcredits: string): string {
    const value = BigInt(microcredits);
    const sign = value < BigInt(0) ? "-" : "";
    const absolute = value < BigInt(0) ? -value : value;
    const fraction = (absolute % scale).toString().padStart(6, "0").replace(/0+$/, "");
    return `${sign}${(absolute / scale).toLocaleString("zh-CN")}${fraction ? `.${fraction}` : ""}`;
}

export function parsePromotionCredits(input: string): string {
    const value = input.trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("请输入正数积分，最多六位小数");
    const [integer, fraction = ""] = value.split(".");
    const microcredits = BigInt(integer) * scale + BigInt(fraction.padEnd(6, "0"));
    if (microcredits <= BigInt(0) || microcredits > MAX_PROMOTION_TRANSFER) throw new Error("转入积分须大于 0，且不能超过钱包上限");
    return microcredits.toString();
}

export function commissionRemaining(record: { amountMicrocredits: string; transferredMicrocredits: string; voidedMicrocredits: string }): bigint {
    return BigInt(record.amountMicrocredits) - BigInt(record.transferredMicrocredits) - BigInt(record.voidedMicrocredits);
}

function pendingKey(userID: string) {
    return `yingce:promotion-transfer:${userID}`;
}
export function readPendingPromotionTransfer(userID: string): TransferRequest | null {
    const raw = window.localStorage.getItem(pendingKey(userID));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
        !value ||
        typeof value !== "object" ||
        !("requestId" in value) ||
        !("amountMicrocredits" in value) ||
        typeof value.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(value.requestId) ||
        typeof value.amountMicrocredits !== "string" ||
        !/^[1-9]\d{0,15}$/.test(value.amountMicrocredits) ||
        BigInt(value.amountMicrocredits) > MAX_PROMOTION_TRANSFER
    ) {
        throw new Error("上次转入请求的本地记录损坏，请联系管理员核对后再操作");
    }
    return { requestId: value.requestId, amountMicrocredits: value.amountMicrocredits };
}
export function savePendingPromotionTransfer(userID: string, request: TransferRequest) {
    window.localStorage.setItem(pendingKey(userID), JSON.stringify(request));
}
export function clearPendingPromotionTransfer(userID: string) {
    window.localStorage.removeItem(pendingKey(userID));
}
