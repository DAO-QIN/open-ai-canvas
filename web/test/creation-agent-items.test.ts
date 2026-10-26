import { describe, expect, test } from "bun:test";
import { mergeCreationAgentItems, type CreationAgentItem } from "../src/services/api/creation-agent";

const item = (id: string, seq: number, position: number, data: Record<string, unknown> = {}): CreationAgentItem => ({ id, seq, position, type: "message", data, createdAt: "2026-10-26T00:00:00Z" });

describe("mergeCreationAgentItems", () => {
    test("keeps the newest version of each item at its first position", () => {
        const merged = mergeCreationAgentItems([item("a", 1, 1, { v: 1 }), item("b", 2, 2)], [item("a", 3, 3, { v: 2 }), item("c", 4, 4)]);
        expect(merged.map((value) => [value.id, value.seq, value.position])).toEqual([
            ["a", 3, 1],
            ["b", 2, 2],
            ["c", 4, 4],
        ]);
        expect(merged[0].data).toEqual({ v: 2 });
    });

    test("ignores stale versions", () => {
        const merged = mergeCreationAgentItems([item("a", 5, 1, { v: 5 })], [item("a", 4, 1, { v: 4 })]);
        expect(merged[0].data).toEqual({ v: 5 });
    });
});
