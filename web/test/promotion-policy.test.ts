import { expect, test } from "bun:test";
import { parsePromotionPolicy } from "../src/lib/promotion-policy";

const policy = { enabled: true, ratioBps: 500, freezeDays: 3, version: 2 };

test("policy decoding preserves explicit zero rates, disabled freezing and the version", () => {
    expect(parsePromotionPolicy(policy)).toEqual(policy);
    expect(parsePromotionPolicy({ enabled: false, ratioBps: 0, freezeDays: 0, version: 0 })).toEqual({ enabled: false, ratioBps: 0, freezeDays: 0, version: 0 });
    expect(parsePromotionPolicy({ ...policy, ratioBps: 10000, freezeDays: 365 })).toEqual({ ...policy, ratioBps: 10000, freezeDays: 365 });
});

test("malformed policy responses cannot turn missing rules into saveable defaults", () => {
    for (const value of [null, {}, { enabled: false }, { ...policy, enabled: "true" }, { ...policy, ratioBps: "500" }, { ...policy, ratioBps: undefined }, { ...policy, freezeDays: null }, { ...policy, version: undefined }]) {
        expect(() => parsePromotionPolicy(value)).toThrow();
    }
});

test("policy decoding rejects fractional, out of range and unsafe numbers", () => {
    for (const ratioBps of [-1, 10001, 0.1, NaN, Infinity]) expect(() => parsePromotionPolicy({ ...policy, ratioBps })).toThrow();
    for (const freezeDays of [-1, 366, 1.5, NaN, Infinity]) expect(() => parsePromotionPolicy({ ...policy, freezeDays })).toThrow();
    for (const version of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => parsePromotionPolicy({ ...policy, version })).toThrow();
});
