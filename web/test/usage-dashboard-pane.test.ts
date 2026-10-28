import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getCreditUsage, type CreditUsageReport } from "../src/services/api/wallet";
import { apiClient } from "../src/services/api/request";

const report: CreditUsageReport = { from: "2025-10-29", to: "2026-10-28", days: 365, timezoneOffset: 480, daily: [], categories: [] };

describe("usage dashboard contracts", () => {
    test("requests the private usage endpoint with the browser offset and abort signal", async () => {
        const originalRequest = apiClient.request;
        const controller = new AbortController();
        let seen: { url?: string; method?: string; params?: unknown; signal?: AbortSignal } = {};
        apiClient.request = (async (config: typeof seen) => {
            seen = config;
            return { data: { code: 0, data: report, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            await expect(getCreditUsage(480, controller.signal)).resolves.toEqual(report);
            expect(seen.method).toBe("get");
            expect(seen.url).toBe("/wallet/usage");
            expect(seen.params).toEqual({ tzOffset: 480 });
            expect(seen.signal).toBe(controller.signal);
        } finally {
            apiClient.request = originalRequest;
        }
    });

    test("settings page exposes the dashboard only when credits are enabled and links it from the wallet history", () => {
        const page = readFileSync(new URL("../src/pages/settings/index.tsx", import.meta.url), "utf8");
        expect(page).toContain('key: "usage", label: "用量看板"');
        expect(page).toContain('(section.key !== "usage" || creditsEnabled)');
        expect(page).toContain('lazy(() => import("./usage-dashboard-pane"))');
        const wallet = readFileSync(new URL("../src/components/layout/workspace-wallet-modal.tsx", import.meta.url), "utf8");
        expect(wallet).toContain('navigate(settingsPath("usage"))');
    });
});

// 组件测试需要 happy-dom 全局对象，放在独立进程里运行，避免污染其他测试文件。
test("用量看板与个人信息概览的真实组件渲染、切换、键盘与触屏查看、失败重试与刷新失败", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/usage-dashboard.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain(" 0 fail");
    expect(output).toMatch(/\b5 pass\b/);
}, 60000);
