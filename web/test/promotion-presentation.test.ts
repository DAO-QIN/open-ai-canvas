import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { commissionStatus, countdownLabel, promotionDateParts } from "../src/pages/promotion/presentation";
import { CommissionItem, TransferItem } from "../src/pages/promotion/record-items";
import type { CommissionRecord } from "../src/services/api/promotion";

const record: CommissionRecord = {
    id: "commission-1",
    paymentOrderId: "order-1",
    inviterId: "inviter-1",
    baseMicrocredits: "1200000000",
    amountMicrocredits: "60000000",
    transferredMicrocredits: "0",
    voidedMicrocredits: "0",
    ratioBps: 500,
    freezeDays: 3,
    policyVersion: 1,
    profileVersion: 0,
    availableAt: "2026-10-14T00:00:00Z",
    createdAt: "2026-10-11T00:00:00Z",
};
const unlockedAt = new Date(record.availableAt).getTime();

test("commission display unlocks exactly at the server deadline and does not rely on the current policy", () => {
    expect(commissionStatus(record, unlockedAt - 1)).toMatchObject({ state: "pending", label: "1 小时后到账" });
    expect(commissionStatus(record, unlockedAt)).toMatchObject({ state: "ready", label: "可领取" });
    expect(commissionStatus({ ...record, availableAt: "invalid" }, unlockedAt)).toMatchObject({ state: "unknown", label: "待确认" });
});

test("pending rewards count down in whole days, then hours, never showing zero", () => {
    expect(commissionStatus(record, unlockedAt - 3 * 86_400_000).label).toBe("3 天后到账");
    expect(commissionStatus(record, unlockedAt - (2 * 86_400_000 + 1)).label).toBe("3 天后到账");
    expect(countdownLabel(25 * 3_600_000)).toBe("2 天");
    expect(countdownLabel(24 * 3_600_000)).toBe("24 小时");
    expect(countdownLabel(1)).toBe("1 小时");
    expect(countdownLabel(0)).toBe("1 小时");
});

test("partial transfers and ended rewards never claim that all credits reached the wallet", () => {
    expect(commissionStatus({ ...record, transferredMicrocredits: "25000000" }, unlockedAt).label).toBe("可领取");
    expect(commissionStatus({ ...record, transferredMicrocredits: "60000000" }, unlockedAt)).toMatchObject({ state: "done", label: "已领取" });
    expect(commissionStatus({ ...record, transferredMicrocredits: "25000000", voidedMicrocredits: "35000000" }, unlockedAt).label).toBe("已结束");
    expect(commissionStatus({ ...record, voidedMicrocredits: "60000000" }, unlockedAt).label).toBe("已结束");
});

test("one remaining microcredit remains available even beyond JS safe integers", () => {
    const large = { ...record, amountMicrocredits: "11000000000000000000", transferredMicrocredits: "10999999999999999999" };
    expect(commissionStatus(large, unlockedAt).label).toBe("可领取");
});

test("ledger date column splits local month-day and time, and tolerates invalid input", () => {
    const parts = promotionDateParts("2026-10-27T21:14:00");
    expect(parts).toEqual({ day: "10-27", time: "21:14" });
    expect(promotionDateParts("invalid")).toEqual({ day: "—", time: "" });
});

test("consumer reward details retain accurate remaining credits without administrative fields", () => {
    const html = renderToStaticMarkup(createElement(CommissionItem, { record: { ...record, transferredMicrocredits: "25000000", voidedMicrocredits: "35000000", voidReason: "internal-audit-reason" }, serverNow: unlockedAt }));
    expect(html).toContain("已结束");
    expect(html).toContain("25 积分");
    expect(html).toContain("0 积分");
    expect(html).not.toContain("作废");
    expect(html).not.toContain("internal-audit-reason");
    expect(html).not.toContain(record.inviterId);
});

test("transfer activity shows an arrival receipt without exposing the request ID", () => {
    const html = renderToStaticMarkup(createElement(TransferItem, { transfer: { id: "receipt-1", requestId: "internal-request-123", amountMicrocredits: "1234567", createdAt: record.createdAt } }));
    expect(html).toContain("已到账");
    expect(html).toContain("领进钱包");
    expect(html).toContain("1.234567");
    expect(html).toContain("receipt-1");
    expect(html).not.toContain("internal-request-123");
});
