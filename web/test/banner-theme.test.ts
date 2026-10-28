import { describe, expect, test } from "bun:test";

import {
    BANNER_EFFECT_DEFAULT,
    BANNER_EFFECTS,
    BANNER_GLOW_PEAK,
    BANNER_INK_CONTRAST,
    BANNER_RING_PEAK,
    BANNER_TEXT_SCRIM,
    BANNER_THEME_PRESETS,
    bannerColorHex,
    bannerHasCustomTheme,
    bannerInkColor,
    bannerThemeContrast,
    bannerThemeStyle,
    normalizeBannerEffect,
} from "@/lib/announcements/banner-theme";
import { bannerTitleContrastRatio } from "@/lib/announcements/banner-title";

async function readSource(relativePath: string) {
    return Bun.file(new URL(relativePath, import.meta.url)).text();
}

/** 从 Go 的 `var X = map[string]struct{}{...}` 字面量里取出键集合。 */
function goMapKeys(source: string, variable: string) {
    const start = source.indexOf(`var ${variable} = map[string]struct{}{`);
    if (start < 0) throw new Error(`未找到 ${variable}`);
    const end = source.indexOf("\n}", start);
    return Array.from(source.slice(start, end).matchAll(/"([a-z0-9-]+)"/g)).map((match) => match[1]);
}

describe("颜色归一化", () => {
    test("十六进制与 rgb() 统一成大写 #RRGGBB，无法解析时为空", () => {
        expect(bannerColorHex("#02c6c4")).toBe("#02C6C4");
        expect(bannerColorHex(" #abc ")).toBe("#AABBCC");
        expect(bannerColorHex("rgb(13, 16, 53)")).toBe("#0D1035");
        expect(bannerColorHex("red")).toBe("");
        expect(bannerColorHex("")).toBe("");
        expect(bannerColorHex(undefined)).toBe("");
    });

    test("任一颜色有效即视为自定义配色", () => {
        expect(bannerHasCustomTheme({ bgColor: "", glowColor: "" })).toBe(false);
        expect(bannerHasCustomTheme({ bgColor: "#001328" })).toBe(true);
        expect(bannerHasCustomTheme({ glowColor: "not-a-color" })).toBe(false);
        expect(bannerHasCustomTheme(null)).toBe(false);
    });
});

describe("背景动效", () => {
    test("未知或空值按光晕流动处理，大小写与空格归一化", () => {
        expect(normalizeBannerEffect(undefined)).toBe(BANNER_EFFECT_DEFAULT);
        expect(normalizeBannerEffect("")).toBe("aurora");
        expect(normalizeBannerEffect(" STATIC ")).toBe("static");
        expect(normalizeBannerEffect("rainbow")).toBe("aurora");
    });

    test("前后端动效白名单与默认值一致", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(new Set(goMapKeys(goSource, "bannerEffects"))).toEqual(new Set(BANNER_EFFECTS.map((item) => item.key)));
        expect(goSource).toContain(`bannerEffectDefault = "${BANNER_EFFECT_DEFAULT}"`);
    });

    test("静止动效只停背景光晕，减少动态效果仍全部停用", async () => {
        const css = await readSource("../src/components/layout/banner-announcement.css");
        expect(css).toMatch(/\.notice-banner\[data-effect="static"\] \.notice-banner-aurora \{\s*animation: none;/);
        expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    });
});

describe("自定义配色写到通知条上的变量", () => {
    test("跟随类型时不写变量，交给 data-notice-type 选择预设", () => {
        expect(bannerThemeStyle(undefined)).toBeUndefined();
        expect(bannerThemeStyle({ bgColor: "", glowColor: "", bgEffect: "static" })).toBeUndefined();
    });

    test("两种颜色都设置时同时写底色、光晕与按钮文字色", () => {
        const style = bannerThemeStyle({ bgColor: "#001328", glowColor: "#02c6c4" }) as Record<string, string>;
        expect(style["--nb-base"]).toBe("#001328");
        expect(style["--nb-glow"]).toBe("#02C6C4");
        expect(style["--nb-ink"]).toBe(bannerInkColor("#02C6C4"));
    });

    test("只设置一种颜色时，另一种继续跟随类型", () => {
        const baseOnly = bannerThemeStyle({ bgColor: "#130A33" }) as Record<string, string>;
        expect(Object.keys(baseOnly)).toEqual(["--nb-base"]);
        const glowOnly = bannerThemeStyle({ glowColor: "#FF5FA8" }) as Record<string, string>;
        expect(Object.keys(glowOnly).sort()).toEqual(["--nb-glow", "--nb-ink"]);
    });
});

describe("按钮文字色", () => {
    test("任何光晕色压暗后在白色按钮上都达到目标对比度（与类型预设同一深度）", () => {
        expect(BANNER_INK_CONTRAST).toBeGreaterThanOrEqual(11.5);
        for (const glow of ["#FFFFFF", "#FFFF00", "#02C6C4", "#7D87FF", "#FF4F9A", "#FFA23A", "#3DDC84"]) {
            const ink = bannerInkColor(glow);
            expect(bannerTitleContrastRatio(ink, "#FFFFFF")).toBeGreaterThanOrEqual(BANNER_INK_CONTRAST);
        }
    });

    test("本身够深的颜色原样使用，无效颜色返回空", () => {
        expect(bannerInkColor("#101010")).toBe("#101010");
        expect(bannerInkColor("oops")).toBe("");
    });
});

describe("推荐配色", () => {
    test("键唯一、颜色合法，且白字在底色与光晕最亮处都清晰", () => {
        const keys = BANNER_THEME_PRESETS.map((preset) => preset.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(BANNER_THEME_PRESETS.length).toBeGreaterThanOrEqual(6);
        for (const preset of BANNER_THEME_PRESETS) {
            expect(bannerColorHex(preset.base)).toBe(preset.base);
            expect(bannerColorHex(preset.glow)).toBe(preset.glow);
            const contrast = bannerThemeContrast(preset.base, preset.glow);
            expect(contrast?.base ?? 0).toBeGreaterThanOrEqual(7);
            expect(contrast?.peak ?? 0).toBeGreaterThanOrEqual(4.5);
        }
    });

    test("对比度检查能发现偏亮的底色与光晕", () => {
        expect(bannerThemeContrast("#FFD700", "#FFFFFF")?.base ?? 99).toBeLessThan(4.5);
        expect(bannerThemeContrast("#0D1035", "#FFFFFF")?.peak ?? 99).toBeLessThan(4.5);
        expect(bannerThemeContrast("", "#FFFFFF")).toBeNull();
    });

    test("光环峰值与文字区压光层和 CSS 一致，对比度检查不会和实际效果脱节", async () => {
        const css = await readSource("../src/components/layout/banner-announcement.css");
        expect(css).toContain(`color-mix(in srgb, var(--nb-glow) ${Math.round(BANNER_RING_PEAK * 100)}%, transparent)`);
        expect(css).toContain(`color-mix(in srgb, var(--nb-base) ${Math.round(BANNER_TEXT_SCRIM * 100)}%, transparent)`);
        // 光环里不应再出现比峰值更亮的光晕色。
        const glowStops = Array.from(css.matchAll(/var\(--nb-glow\) (\d+)%, transparent\)/g), (match) => Number(match[1]));
        expect(Math.max(...glowStops)).toBe(Math.round(BANNER_RING_PEAK * 100));
        expect(BANNER_GLOW_PEAK).toBeCloseTo(BANNER_RING_PEAK * (1 - BANNER_TEXT_SCRIM), 6);
        expect(BANNER_GLOW_PEAK).toBe(0.56);
    });
});
