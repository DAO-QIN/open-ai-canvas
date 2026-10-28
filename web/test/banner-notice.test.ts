import { describe, expect, test } from "bun:test";

import {
    BANNER_CTA_MAX_CHARS,
    BANNER_NOTICE_DEFAULT_TYPE,
    BANNER_NOTICE_EMOJI_GROUPS,
    BANNER_NOTICE_EMOJIS,
    BANNER_NOTICE_TYPE_VALUES,
    BANNER_NOTICE_TYPES,
    bannerCtaLabel,
    bannerNoticeSurfaceCSS,
    bannerNoticeTypeLabel,
    normalizeBannerNoticeType,
    searchBannerNoticeEmojis,
} from "@/lib/announcements/banner-notice";
import { bannerTitleContrastRatio } from "@/lib/announcements/banner-title";

async function readSource(relativePath: string) {
    return Bun.file(new URL(relativePath, import.meta.url)).text();
}

/** 从 Go 的 `var X = map[string]struct{}{...}` 字面量里取出键集合。 */
function goMapKeys(source: string, variable: string) {
    const start = source.indexOf(`var ${variable} = map[string]struct{}{`);
    if (start < 0) throw new Error(`未找到 ${variable}`);
    const end = source.indexOf("\n}", start);
    if (end < 0) throw new Error(`${variable} 字面量未闭合`);
    const body = source.slice(start, end);
    return Array.from(body.matchAll(/"([a-z0-9-]+)"/g)).map((match) => match[1]);
}

describe("通知类型", () => {
    test("未知或空值回落到默认类型", () => {
        expect(normalizeBannerNoticeType(undefined)).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType("")).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType("rainbow")).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType(" ACTIVITY ")).toBe("activity");
    });

    test("每种类型都有中文名与独立的底色 token", () => {
        const vars = BANNER_NOTICE_TYPES.map((item) => item.surfaceVar);
        expect(new Set(vars).size).toBe(vars.length);
        for (const type of BANNER_NOTICE_TYPES) {
            expect(bannerNoticeTypeLabel(type.key)).toBe(type.label);
            expect(bannerNoticeSurfaceCSS(type.key)).toBe(`var(${type.surfaceVar})`);
        }
        // 未知类型也必须拿到可用底色，不能渲染成透明条。
        expect(bannerNoticeSurfaceCSS("rainbow")).toBe(bannerNoticeSurfaceCSS(BANNER_NOTICE_DEFAULT_TYPE));
    });

    test("按钮文案：后台填写的优先，留空按类型取默认文案", () => {
        for (const type of BANNER_NOTICE_TYPES) {
            expect(type.cta.length).toBeGreaterThan(0);
            expect(Array.from(type.cta).length).toBeLessThanOrEqual(BANNER_CTA_MAX_CHARS);
            expect(bannerCtaLabel("", type.key)).toBe(type.cta);
        }
        expect(bannerCtaLabel("  进群领积分 ", "notice")).toBe("进群领积分");
        expect(bannerCtaLabel(undefined, "rainbow")).toBe(bannerCtaLabel(undefined, BANNER_NOTICE_DEFAULT_TYPE));
    });
});

describe("emoji 图标素材库", () => {
    test("字符唯一、非空，每个素材都有中文名", () => {
        const chars = BANNER_NOTICE_EMOJIS.map((item) => item.char);
        expect(new Set(chars).size).toBe(chars.length);
        expect(chars.length).toBeGreaterThanOrEqual(50);
        for (const item of BANNER_NOTICE_EMOJIS) {
            expect(item.char.trim().length).toBeGreaterThan(0);
            expect(item.label.trim().length).toBeGreaterThan(0);
            expect(item.groupLabel.trim().length).toBeGreaterThan(0);
        }
    });

    test("用户点名的素材必须在库内", () => {
        for (const char of ["💰", "🚀", "🔥", "📢"]) {
            expect(BANNER_NOTICE_EMOJIS.some((item) => item.char === char)).toBe(true);
        }
    });

    test("搜索同时匹配中文名、分组名与字符本身", () => {
        expect(searchBannerNoticeEmojis("火箭").map((item) => item.char)).toContain("🚀");
        expect(searchBannerNoticeEmojis("钱袋").map((item) => item.char)).toContain("💰");
        // 分组名搜索命中整组。
        const statusHits = searchBannerNoticeEmojis("状态");
        expect(statusHits.length).toBeGreaterThanOrEqual(BANNER_NOTICE_EMOJI_GROUPS.find((g) => g.key === "status")!.emoji.length);
        // 字符本身也能搜到（支持从别处粘贴检索）。
        expect(searchBannerNoticeEmojis("🔥").map((item) => item.char)).toContain("🔥");
        expect(searchBannerNoticeEmojis("  ").length).toBe(BANNER_NOTICE_EMOJIS.length);
        expect(searchBannerNoticeEmojis("不存在的素材")).toEqual([]);
    });

    test("emoji 是普通文本：标题纯文本拼接函数必须原样保留它", async () => {
        // 防止未来有人给 run.text 做字符过滤，把 emoji 丢掉。
        const { bannerTitlePlainText } = await import("@/lib/announcements/banner-title");
        const runs = [
            { text: "🔥", fontSize: 20 },
            { text: "限时", color: "#FFE58F" },
            { text: "大促" },
        ];
        expect(bannerTitlePlainText(runs as never)).toBe("🔥限时大促");
    });
});

describe("与后端白名单保持一致", () => {
    test("通知类型的后端白名单逐项等于前端注册表", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(new Set(goMapKeys(goSource, "bannerNoticeTypes"))).toEqual(new Set(BANNER_NOTICE_TYPE_VALUES));
    });

    test("后端默认值常量与前端一致", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(goSource).toContain(`bannerNoticeDefaultType = "${BANNER_NOTICE_DEFAULT_TYPE}"`);
        expect(goSource).toMatch(new RegExp(`bannerCtaMaxRunes\\s*=\\s*${BANNER_CTA_MAX_CHARS}\\b`));
    });

    test("后端更新字段表包含全部可编辑字段，后台修改不会只在返回值里生效", async () => {
        const goRepo = await readSource("../../backend/internal/repository/announcement.go");
        const start = goRepo.indexOf("func (r *Repository) UpdateBannerAnnouncement");
        const body = goRepo.slice(start, goRepo.indexOf("\n}", start));
        for (const column of ["title", "title_runs", "notice_type", "cta_text", "link", "status", "show_countdown", "sort_order", "starts_at", "ends_at"]) {
            expect(body).toContain(`"${column}":`);
        }
    });

    test("后端不保存独立图标字段：emoji 必须内嵌在标题分段里", async () => {
        const [goModel, goApp, goRepo] = await Promise.all([
            readSource("../../backend/internal/model/models_project.go"),
            readSource("../../backend/internal/app/announcement.go"),
            readSource("../../backend/internal/repository/announcement.go"),
        ]);
        // 防止 icon 字段被加回来却没人维护白名单：图标的存储形态就是 TitleRuns 的文本。
        expect(goModel).not.toMatch(/\bIcon\s+string/);
        expect(goApp).not.toContain("normalizeBannerIcon");
        expect(goRepo).not.toContain('"icon"');
    });
});

describe("通知条主题色", () => {
    test("四种类型在明暗两档都满足白字对比度要求", async () => {
        const css = await readSource("../src/styles/globals.css");
        const value = (token: string) => {
            const match = css.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
            if (!match) throw new Error(`globals.css 缺少 --${token}`);
            return match[1];
        };
        for (const type of BANNER_NOTICE_TYPES) {
            // 浅色档是正文级底色，必须达到 WCAG AA 的 4.5:1；
            // 深色档统一压到 7:1 以上，避免暗色主题里底色过亮。
            const light = value(`palette-banner-${type.key}-500`);
            const dark = value(`palette-banner-${type.key}-700`);
            expect(bannerTitleContrastRatio("#FFFFFF", light)).toBeGreaterThanOrEqual(4.5);
            expect(bannerTitleContrastRatio("#FFFFFF", dark)).toBeGreaterThanOrEqual(7);
        }
    });

    test("类型标签实色在明暗主题各定义一次", async () => {
        const globals = await readSource("../src/styles/globals.css");
        for (const type of BANNER_NOTICE_TYPES) {
            // surfaceVar 自带 `--` 前缀，拼接时不要再加一次。
            const name = type.surfaceVar.replace(/^--/, "");
            const semantic = new RegExp(`--${name}: var\\(--palette-banner-${type.key}-\\d00\\)`, "g");
            expect(globals.match(semantic)?.length).toBe(2);
        }
    });

    test("通知条深色底、按钮文字与流动光晕最亮处都保证文字可读", async () => {
        const css = await readSource("../src/styles/globals.css");
        const value = (token: string) => {
            const match = css.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
            if (!match) throw new Error(`globals.css 缺少 --${token}`);
            return match[1];
        };
        const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
        // 与 banner-announcement.css 的 color-mix(in srgb, glow 56%, base) 一致：sRGB 通道线性混合。
        const mix = (glow: string, base: string, weight: number) =>
            `#${channels(glow)
                .map((channel, index) => Math.round(channel * weight + channels(base)[index] * (1 - weight)))
                .map((channel) => channel.toString(16).padStart(2, "0"))
                .join("")}`;
        for (const type of BANNER_NOTICE_TYPES) {
            const base = value(`palette-banner-${type.key}-950`);
            const glow = value(`palette-banner-${type.key}-300`);
            const ink = value(`palette-banner-${type.key}-900`);
            expect(bannerTitleContrastRatio("#FFFFFF", base)).toBeGreaterThanOrEqual(7);
            expect(bannerTitleContrastRatio(ink, "#FFFFFF")).toBeGreaterThanOrEqual(7);
            expect(bannerTitleContrastRatio("#FFFFFF", mix(glow, base, 0.56))).toBeGreaterThanOrEqual(4.5);
        }
    });

    test("通知条与类型卡片引用按类型取值的 token，且不随明暗主题覆盖", async () => {
        const [globals, bannerCss, adminUi] = await Promise.all([
            readSource("../src/styles/globals.css"),
            readSource("../src/components/layout/banner-announcement.css"),
            readSource("../src/styles/admin-ui.css"),
        ]);
        for (const type of BANNER_NOTICE_TYPES) {
            for (const [variable, step] of [
                [type.baseVar, 950],
                [type.glowVar, 300],
                [type.inkVar, 900],
            ] as const) {
                const declaration = new RegExp(`${variable}: var\\(--palette-banner-${type.key}-${step}\\)`, "g");
                expect(globals.match(declaration)?.length).toBe(1);
                expect(bannerCss).toContain(`var(${variable})`);
            }
            expect(adminUi).toContain(`var(${type.baseVar})`);
            expect(adminUi).toContain(`var(${type.glowVar})`);
        }
        // 光效与按钮动画在减少动态效果时必须关闭。
        expect(bannerCss).toContain("@media (prefers-reduced-motion: reduce)");
    });
});
