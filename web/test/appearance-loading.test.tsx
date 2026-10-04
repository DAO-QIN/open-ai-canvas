import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppearanceBootstrapBoundary } from "../src/components/brand/appearance-bootstrap-boundary";
import { bootstrapAppearance, resolvePublicAppearance } from "../src/services/appearance-bootstrap";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE, normalizePublicAppearance, useAppearanceStore } from "../src/stores/use-appearance-store";

const original = useAppearanceStore.getState();
afterEach(() => useAppearanceStore.setState(original));

function coldStart() {
    useAppearanceStore.setState({ appearance: DEFAULT_PUBLIC_APPEARANCE, resolved: false, loadFailed: false });
}

test("the unresolved boundary renders neither branded children nor the built-in icon", () => {
    const html = renderToStaticMarkup(
        <AppearanceBootstrapBoundary>
            <p>影策 YINGCE STUDIO /logo.svg</p>
        </AppearanceBootstrapBoundary>,
    );
    expect(html).toContain("正在加载站点配置");
    expect(html).not.toContain("影策");
    expect(html).not.toContain("YINGCE STUDIO");
    expect(html).not.toContain("/logo.svg");
});

test("a delayed cold start remains unresolved until the configured identity arrives", async () => {
    coldStart();
    let release!: (value: ReturnType<typeof normalizePublicAppearance>) => void;
    const pending = new Promise<ReturnType<typeof normalizePublicAppearance>>((resolve) => {
        release = resolve;
    });
    const loading = bootstrapAppearance(async () => pending);
    expect(useAppearanceStore.getState().resolved).toBe(false);
    release(normalizePublicAppearance({ brandName: "影绘", logoConfigured: true, logoUrl: "/api/public/appearance/assets/logo?v=current" }));
    await loading;
    expect(useAppearanceStore.getState().resolved).toBe(true);
    expect(useAppearanceStore.getState().appearance.brandName).toBe("影绘");
});

test("failed cold start keeps the brand unresolved and a retry commits the actual identity", async () => {
    coldStart();
    await expect(
        bootstrapAppearance(async () => {
            throw new Error("offline");
        }),
    ).rejects.toThrow("offline");
    expect(useAppearanceStore.getState().resolved).toBe(false);
    expect(useAppearanceStore.getState().loadFailed).toBe(true);
    await bootstrapAppearance(async () => normalizePublicAppearance({ brandName: "影绘" }));
    expect(useAppearanceStore.getState().appearance.brandName).toBe("影绘");
    expect(useAppearanceStore.getState().loadFailed).toBe(false);
});

test("a timeout rejects instead of publishing built-in appearance", async () => {
    coldStart();
    await expect(
        resolvePublicAppearance(
            (signal) =>
                new Promise((_, reject) => {
                    signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
                }),
        ),
    ).rejects.toThrow("timeout");
    expect(useAppearanceStore.getState().resolved).toBe(false);
}, 6000);

test("initial bootstrap callers share one request and cannot overwrite a newer save", async () => {
    coldStart();
    let release!: (value: ReturnType<typeof normalizePublicAppearance>) => void;
    const pending = new Promise<ReturnType<typeof normalizePublicAppearance>>((resolve) => {
        release = resolve;
    });
    let calls = 0;
    const fetchAppearance = async () => {
        calls++;
        return pending;
    };
    const first = bootstrapAppearance(fetchAppearance);
    const second = bootstrapAppearance(fetchAppearance);
    expect(calls).toBe(1);
    commitPublicAppearance({ brandName: "最新品牌" });
    release(normalizePublicAppearance({ brandName: "旧品牌" }));
    await Promise.all([first, second]);
    expect(useAppearanceStore.getState().appearance.brandName).toBe("最新品牌");
});

test("a failed bootstrap cannot reset a brand already resolved in this tab", async () => {
    commitPublicAppearance({ brandName: "影绘" });
    await bootstrapAppearance(async () => {
        throw new Error("offline");
    });
    expect(useAppearanceStore.getState().appearance.brandName).toBe("影绘");
    expect(useAppearanceStore.getState().resolved).toBe(true);
});
