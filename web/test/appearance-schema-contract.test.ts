import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { commitPublicAppearance, PUBLIC_APPEARANCE_SCHEMA_VERSION, readConfirmedAppearance, useAppearanceStore } from "../src/stores/use-appearance-store";
import { bootstrapAppearance } from "../src/services/appearance-bootstrap";

test("a real backend schema response is cached and restores the confirmed brand offline", async () => {
    const backend = readFileSync(new URL("../../backend/internal/app/appearance.go", import.meta.url), "utf8");
    const backendVersion = Number(backend.match(/appearanceSchemaVersion\s*=\s*(\d+)/)?.[1]);
    expect(PUBLIC_APPEARANCE_SCHEMA_VERSION).toBe(backendVersion);
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalState = useAppearanceStore.getState();
    const cache = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) } } });
    try {
        commitPublicAppearance({ schemaVersion: backendVersion, brandName: "影绘", revision: "live-response", faviconUrl: "/api/public/appearance/icons/current/favicon.ico" });
        expect(cache.size).toBe(1);
        expect(readConfirmedAppearance()?.brandName).toBe("影绘");
        useAppearanceStore.setState({ resolved: false, loadFailed: false });
        await bootstrapAppearance(async () => { throw new Error("offline"); });
        expect(useAppearanceStore.getState().appearance.faviconUrl).toContain("/icons/current/");
        expect(useAppearanceStore.getState().resolved).toBe(true);
        expect(useAppearanceStore.getState().loadFailed).toBe(false);
        const saved = [...cache.values()][0];
        commitPublicAppearance({ schemaVersion: backendVersion + 1, brandName: "Unknown schema", revision: "future" });
        expect([...cache.values()][0]).toBe(saved);
    } finally {
        useAppearanceStore.setState(originalState);
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
