import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { commissionStatus } from "../src/pages/promotion/presentation";
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
    expect(commissionStatus(record, unlockedAt - 1).label).toBe("待解锁");
    expect(commissionStatus(record, unlockedAt).label).toBe("可转入");
    expect(commissionStatus({ ...record, availableAt: "invalid" }, unlockedAt).label).toBe("待确认");
});

test("partial transfers and ended rewards never claim that all credits reached the wallet", () => {
    expect(commissionStatus({ ...record, transferredMicrocredits: "25000000" }, unlockedAt).label).toBe("可转入");
    expect(commissionStatus({ ...record, transferredMicrocredits: "60000000" }, unlockedAt).label).toBe("已转入");
    expect(commissionStatus({ ...record, transferredMicrocredits: "25000000", voidedMicrocredits: "35000000" }, unlockedAt).label).toBe("已结束");
    expect(commissionStatus({ ...record, voidedMicrocredits: "60000000" }, unlockedAt).label).toBe("已结束");
});

test("one remaining microcredit remains available even beyond JS safe integers", () => {
    const large = { ...record, amountMicrocredits: "11000000000000000000", transferredMicrocredits: "10999999999999999999" };
    expect(commissionStatus(large, unlockedAt).label).toBe("可转入");
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
    expect(html).toContain("1.234567");
    expect(html).toContain("receipt-1");
    expect(html).not.toContain("internal-request-123");
});
