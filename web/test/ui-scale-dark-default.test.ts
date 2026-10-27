import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isUiScaleExemptPath } from "../src/lib/ui-scale";

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");

describe("桌面端默认 90% 显示", () => {
    test("≥1024px 根元素 zoom 0.9，铺满视口的容器按比例补回", () => {
        const css = read("../src/styles/ui-scale.css");
        expect(css).toContain("@media (min-width: 1024px)");
        expect(css).toContain("html:not([data-ui-scale-off]) {\n        zoom: 0.9;");
        for (const rule of ["height: calc(100dvh / 0.9);", "min-height: calc(100dvh / 0.9);", "height: calc(100vh / 0.9);"]) expect(css).toContain(rule);
        expect(read("../src/application.tsx")).toContain('import "./styles/ui-scale.css";');
        // 首屏样式同样缩放，避免加载完成后跳一下。
        expect(read("../index.html")).toContain("html:not([data-ui-scale-off]) {\n                    zoom: 0.9;");
    });

    test("画布编辑器、分享画布、开发实验页不参与整体缩放", () => {
        expect(isUiScaleExemptPath("/canvas/abc")).toBe(true);
        expect(isUiScaleExemptPath("/share/canvas/token")).toBe(true);
        expect(isUiScaleExemptPath("/dev/folder-preview")).toBe(true);
        for (const path of ["/", "/create", "/canvas", "/inspirations", "/inspiration/x", "/projects", "/settings/profile"]) expect(isUiScaleExemptPath(path)).toBe(false);
        const html = read("../index.html");
        expect(html).toContain('if (/^\\/canvas\\/[^/]+/.test(p) || p.indexOf("/share/canvas/") === 0 || p.indexOf("/dev/") === 0) {');
        expect(read("../src/application.tsx")).toContain("router.subscribe((state) => syncUiScaleForPath(state.location.pathname));");
    });

    test("把指针距离写回样式的地方先换成样式像素", () => {
        expect(read("../src/pages/home/index.tsx")).toContain("toLayoutPx(event.clientX - rect.left)");
        expect(read("../src/components/canvas/use-agent-launcher-position.ts")).toContain("const viewport = layoutViewport;");
        expect(read("../src/components/canvas/pet-launcher.tsx")).toContain("useState(layoutViewport)");
        expect(read("../src/pages/skills/workbench/index.tsx")).toContain("toLayoutPx(event.clientX - start.startX)");
        expect(read("../src/pages/assets/asset-library-panels.tsx")).toContain("toLayoutPx(event.clientX - drag.x)");
        expect(read("../src/components/workflow-graph-editor.tsx")).toContain("toLayoutPx(event.clientX - pan.x)");
        expect(read("../src/components/workflow-test-workbench.tsx")).toContain("toLayoutPx(rect.width)");
        expect(read("../src/lib/plugins/builtin/editor/editor-timeline-panel.tsx")).toContain("toLayoutPx(e.clientX - g.startClientX) / pxPerMs");
    });
});

describe("默认深色主题", () => {
    test("新用户默认深色；旧版本存的浅色默认值迁移一次到深色，之后手动选浅色会保留", async () => {
        const { DEFAULT_THEME, THEME_STORE_VERSION, migrateThemeStore, restoreThemeName } = await import("../src/stores/use-theme-store");
        expect(DEFAULT_THEME).toBe("dark");
        expect(THEME_STORE_VERSION).toBe(1);
        expect(migrateThemeStore({ theme: "light" }, 0).theme).toBe("dark");
        expect(migrateThemeStore({ theme: "light" }, 1).theme).toBe("light");
        expect(restoreThemeName("bogus")).toBe("dark");
        expect(restoreThemeName(undefined)).toBe("dark");
        expect(restoreThemeName("light")).toBe("light");
        const store = read("../src/stores/use-theme-store.ts");
        expect(store).toContain("theme: DEFAULT_THEME,");
        expect(store).toContain("version: THEME_STORE_VERSION,");
    });

    test("首屏脚本与 store 同一规则，默认深底，不先闪浅色", () => {
        const html = read("../index.html");
        expect(html).toContain('var t = s.version >= 1 && s.state && s.state.theme === "light" ? "light" : "dark";');
        expect(html).not.toContain('style="background:#ffffff"');
        expect(html).toContain("background: #0f0f11;");
        expect(read("../src/components/layout/app-providers.tsx")).toContain('document.documentElement.classList.remove("light-boot");');
    });
});
