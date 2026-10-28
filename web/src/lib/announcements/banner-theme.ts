/**
 * 常驻通知条的配色：类型预设与后台自定义。
 *
 * 通知条只需要两种颜色：深色底（文字与按钮之下）和光晕色（流动光环与按钮扫光）。
 * 自定义颜色留空时跟随通知类型的预设；按钮与倒计时数字的文字色由光晕色压暗得到，
 * 在白色按钮上始终 ≥ 11.5:1（与类型预设的按钮文字色同一深度），管理员不需要再单独挑一种文字色。
 *
 * 除 readBannerPresetColors 需要读取页面 token 外，本模块都是纯函数。
 */

import type { CSSProperties } from "react";

import type { BannerEdgeFields } from "./banner-edge";
import { bannerNoticeTypeMeta } from "./banner-notice";
import { bannerTitleContrastRatio, normalizeBannerTitleHex, parseBannerTitleColor } from "./banner-title";

export type BannerEffect = "aurora" | "static";

export const BANNER_EFFECT_DEFAULT: BannerEffect = "aurora";

/** 背景动效，取值与后端 bannerEffects 白名单一致。 */
export const BANNER_EFFECTS: { key: BannerEffect; label: string }[] = [
    { key: "aurora", label: "光晕流动" },
    { key: "static", label: "光晕静止" },
];

const BANNER_EFFECT_KEYS = new Set<string>(BANNER_EFFECTS.map((item) => item.key));

/** 未知或空值按光晕流动处理（旧通知没有这个字段）。 */
export function normalizeBannerEffect(value?: string | null): BannerEffect {
    const raw = (value || "").trim().toLowerCase();
    return BANNER_EFFECT_KEYS.has(raw) ? (raw as BannerEffect) : BANNER_EFFECT_DEFAULT;
}

/** 推荐配色：深色底 + 亮色光晕；白字在底色上 ≥ 7:1、在文字背后光晕最亮处 ≥ 4.5:1（见 web/test/banner-theme.test.ts）。 */
export const BANNER_THEME_PRESETS: { key: string; label: string; base: string; glow: string }[] = [
    { key: "aurora-teal", label: "极光青", base: "#001328", glow: "#02C6C4" },
    { key: "nebula", label: "星云紫", base: "#130A33", glow: "#9A73FF" },
    { key: "ocean", label: "深海蓝", base: "#021530", glow: "#3D8BFF" },
    { key: "sakura", label: "樱花粉", base: "#2A0719", glow: "#FF5FA8" },
    { key: "crimson", label: "霓虹红", base: "#2A0307", glow: "#FF4D61" },
    { key: "sunset", label: "落日橙", base: "#2A0D04", glow: "#FF7A3D" },
    { key: "gold", label: "鎏金", base: "#1F1402", glow: "#EBA82A" },
    { key: "forest", label: "森林绿", base: "#031D12", glow: "#2FCF7C" },
];

/** 光环最亮处的光晕色不透明度，与 banner-announcement.css 中 .notice-banner-aurora 渐变的峰值一致。 */
export const BANNER_RING_PEAK = 0.7;

/** 文字区压光层的底色不透明度（banner-announcement.css 的 .notice-banner-backdrop::after），亮带经过文字时按此减弱。 */
export const BANNER_TEXT_SCRIM = 0.2;

/** 文字背后光晕最亮时相当于光晕色叠在底色上的比例（光环峰值经压光层减弱后），白字对比度按它检查。 */
export const BANNER_GLOW_PEAK = Math.round(BANNER_RING_PEAK * (1 - BANNER_TEXT_SCRIM) * 100) / 100;

/** 按钮与倒计时数字的文字色在白底上的目标对比度。 */
export const BANNER_INK_CONTRAST = 11.5;

/** 通知条外观字段：配色、背景动效与底边样式（底边见 banner-edge.ts）。 */
export type BannerThemeFields = BannerEdgeFields & {
    bgColor?: string | null;
    glowColor?: string | null;
    bgEffect?: string | null;
};

type Rgb = [number, number, number];

function toHex(color: Rgb) {
    return `#${color
        .map((channel) =>
            Math.max(0, Math.min(255, Math.round(channel)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`.toUpperCase();
}

/** 把 #RGB / #RRGGBB / rgb() 统一成 #RRGGBB；无法解析时返回空串。 */
export function bannerColorHex(value?: string | null) {
    const raw = (value || "").trim();
    if (!raw) return "";
    const hex = normalizeBannerTitleHex(raw);
    if (hex) return hex;
    const rgb = parseBannerTitleColor(raw);
    return rgb ? toHex(rgb) : "";
}

export function bannerHasCustomTheme(theme?: BannerThemeFields | null) {
    return Boolean(bannerColorHex(theme?.bgColor) || bannerColorHex(theme?.glowColor));
}

/** 光晕色逐步压暗（向黑色混合），直到在白色按钮上达到 BANNER_INK_CONTRAST；色相保持不变。 */
export function bannerInkColor(glow?: string | null) {
    const color = parseBannerTitleColor(bannerColorHex(glow));
    if (!color) return "";
    for (let step = 0; step <= 100; step += 1) {
        const keep = 1 - step / 100;
        const candidate = toHex([color[0] * keep, color[1] * keep, color[2] * keep]);
        const ratio = bannerTitleContrastRatio(candidate, "#FFFFFF");
        if (ratio !== null && ratio >= BANNER_INK_CONTRAST) return candidate;
    }
    return "#000000";
}

/**
 * 自定义配色写到通知条外壳上的 CSS 变量；跟随类型时返回 undefined，由 data-notice-type 选择预设。
 * 只设置了其中一种颜色时，另一种继续跟随类型。
 */
export function bannerThemeStyle(theme?: BannerThemeFields | null): CSSProperties | undefined {
    const base = bannerColorHex(theme?.bgColor);
    const glow = bannerColorHex(theme?.glowColor);
    if (!base && !glow) return undefined;
    return {
        ...(base ? { "--nb-base": base } : {}),
        ...(glow ? { "--nb-glow": glow, "--nb-ink": bannerInkColor(glow) } : {}),
    } as CSSProperties;
}

/** 白字在底色上、以及在光晕最亮处（光晕按峰值不透明度叠在底色上）的对比度；颜色无法解析时返回 null。 */
export function bannerThemeContrast(base?: string | null, glow?: string | null) {
    const back = parseBannerTitleColor(bannerColorHex(base));
    const light = parseBannerTitleColor(bannerColorHex(glow));
    if (!back || !light) return null;
    const peak = toHex([0, 1, 2].map((index) => light[index] * BANNER_GLOW_PEAK + back[index] * (1 - BANNER_GLOW_PEAK)) as Rgb);
    return {
        base: bannerTitleContrastRatio("#FFFFFF", toHex(back)) ?? 0,
        peak: bannerTitleContrastRatio("#FFFFFF", peak) ?? 0,
    };
}

/** 读取通知类型预设的底色与光晕色（#RRGGBB），避免把设计 token 的色值复制到 TS 里。 */
export function readBannerPresetColors(noticeType?: string | null, scope?: HTMLElement | null) {
    if (typeof window === "undefined") return { base: "", glow: "" };
    const host = scope || window.document.body || window.document.documentElement;
    if (!host) return { base: "", glow: "" };
    const meta = bannerNoticeTypeMeta(noticeType);
    const read = (variable: string) => {
        const probe = window.document.createElement("span");
        probe.style.cssText = `position:absolute;left:-9999px;top:-9999px;background-color:var(${variable})`;
        host.appendChild(probe);
        const resolved = window.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return bannerColorHex(resolved);
    };
    return { base: read(meta.baseVar), glow: read(meta.glowVar) };
}
