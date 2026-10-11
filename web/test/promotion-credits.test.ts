import { afterEach, expect, test } from "bun:test";
import { clearPendingPromotionTransfer, commissionRemaining, formatPromotionCredits, parsePromotionCredits, readPendingPromotionTransfer, savePendingPromotionTransfer } from "../src/lib/promotion-credits";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("promotion amounts preserve precision beyond JS safe integers", () => {
    expect(formatPromotionCredits("11000000000000000000")).toBe("11,000,000,000,000");
    expect(formatPromotionCredits("1234567")).toBe("1.234567");
    expect(formatPromotionCredits("1")).toBe("0.000001");
    expect(parsePromotionCredits("1.234567")).toBe("1234567");
    expect(parsePromotionCredits("9007199254.740991")).toBe("9007199254740991");
    for (const value of ["0", "-1", "1e3", "NaN", "1.1234567", "9007199254.740992"]) expect(() => parsePromotionCredits(value)).toThrow();
    expect(commissionRemaining({ amountMicrocredits: "100000000", transferredMicrocredits: "40000000", voidedMicrocredits: "60000000" })).toBe(BigInt(0));
});

test("pending requests survive refresh and stay isolated by account", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            },
        },
    });
    const request = { requestId: "stable_request_123", amountMicrocredits: "1234567" };
    savePendingPromotionTransfer("alice", request);
    expect(readPendingPromotionTransfer("alice")).toEqual(request);
    expect(readPendingPromotionTransfer("bob")).toBeNull();
    savePendingPromotionTransfer("bob", { ...request, requestId: "bob_request_123" });
    clearPendingPromotionTransfer("alice");
    expect(readPendingPromotionTransfer("alice")).toBeNull();
    expect(readPendingPromotionTransfer("bob")?.requestId).toBe("bob_request_123");
    values.set("yingce:promotion-transfer:bob", JSON.stringify({ ...request, amountMicrocredits: "9999999999999999" }));
    expect(() => readPendingPromotionTransfer("bob")).toThrow();
    values.set("yingce:promotion-transfer:bob", JSON.stringify({ amountMicrocredits: "1234567" }));
    expect(() => readPendingPromotionTransfer("bob")).toThrow();
});
