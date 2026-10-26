import { describe, expect, test } from "bun:test";

import { isGuestWorkspacePath } from "../src/lib/guest-workspace";

describe("guest workspace route access", () => {
    test("allows only the public creation workspace routes", () => {
        expect(isGuestWorkspacePath("/")).toBe(true);
        expect(isGuestWorkspacePath("/create")).toBe(true);
        expect(isGuestWorkspacePath("/inspiration")).toBe(true);
        expect(isGuestWorkspacePath("/inspiration/0f8b6c1e-0000-4000-8000-000000000000")).toBe(true);
        expect(isGuestWorkspacePath("/inspiration/a/b")).toBe(false);
        expect(isGuestWorkspacePath("/assets")).toBe(false);
        expect(isGuestWorkspacePath("/admin")).toBe(false);
        expect(isGuestWorkspacePath("/create/anything")).toBe(false);
    });
});
