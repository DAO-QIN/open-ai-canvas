import { expect, test } from "bun:test";
import { getActiveUserScope, scopedLocalStorage } from "../src/lib/user-scope";
import { MediaPackage } from "../src/lib/media-package";
import { readAssetPackage } from "../src/pages/assets/asset-transfer";

test("升级仍可读取已有账号范围内的本地配置", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    const values = new Map([
        ["infinite-canvas:active-user-scope", "existing-account"],
        ["infinite-canvas:theme_store:user:existing-account", '{"state":{"theme":"dark"}}'],
        ["infinite-canvas:theme_store:user:another-account", '{"state":{"theme":"light"}}'],
    ]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null } } });
    try {
        expect(getActiveUserScope()).toBe("existing-account");
        expect(JSON.parse(scopedLocalStorage.getItem("infinite-canvas:theme_store")!).state.theme).toBe("dark");
    } finally {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else Reflect.deleteProperty(globalThis, "window");
    }
});

test("升级可导入原版本素材包并保留素材内容", async () => {
    const assets = [{ id: "existing-asset", kind: "image", name: "旧素材", data: { storageKey: "existing-image" } }];
    for (const app of ["infinite-canvas", "yingce"]) {
        const archive = new MediaPackage();
        const blob = await archive.finish("assets.json", { app, version: 1, assets, files: [] });
        expect(await readAssetPackage(new File([blob], "assets.zip", { type: "application/zip" }))).toEqual(assets);
    }
});
