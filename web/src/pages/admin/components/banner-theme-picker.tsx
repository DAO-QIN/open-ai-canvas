import { ColorPicker } from "antd";
import type { CSSProperties } from "react";

import { BANNER_EDGE_SHAPES, BANNER_EDGE_WAVES, type BannerEdgeShape, type BannerEdgeWave } from "@/lib/announcements/banner-edge";
import { BANNER_EFFECTS, BANNER_THEME_PRESETS, bannerColorHex, readBannerPresetColors, type BannerEffect } from "@/lib/announcements/banner-theme";
import { SegmentedControl } from "@/pages/admin/ui/controls";

/** 编辑中的外观：颜色为空表示跟随通知类型（自定义时两种颜色都会填上），另含背景动效与底边外形、波纹。 */
export type BannerThemeValue = { bgColor: string; glowColor: string; bgEffect: BannerEffect; edgeShape: BannerEdgeShape; edgeWave: BannerEdgeWave };

type ThemeMode = "preset" | "custom";

/** 小圆色块：深色底上叠一团光晕，与通知条的观感一致。 */
export function bannerThemeSwatchStyle(base: string, glow: string) {
    return { "--admin-banner-swatch-base": base, "--admin-banner-swatch-glow": glow } as CSSProperties;
}

/**
 * 通知条配色与动效：跟随类型或自定义底色 / 光晕色，并可选择光晕流动或静止。
 * 按钮与倒计时数字的文字色由光晕色自动推导，这里不单独提供。
 */
export function BannerThemePicker({ value, noticeType, onChange }: { value: BannerThemeValue; noticeType: string; onChange: (next: BannerThemeValue) => void }) {
    const custom = Boolean(value.bgColor || value.glowColor);

    const switchMode = (mode: ThemeMode) => {
        if (mode === "preset") {
            onChange({ ...value, bgColor: "", glowColor: "" });
            return;
        }
        // 从当前类型的预设配色开始调整，切换前后外观不跳变。
        const preset = readBannerPresetColors(noticeType);
        onChange({ ...value, bgColor: value.bgColor || preset.base, glowColor: value.glowColor || preset.glow });
    };

    const pick = (field: "bgColor" | "glowColor", color: string) => {
        const hex = bannerColorHex(color);
        if (hex) onChange({ ...value, [field]: hex });
    };

    return (
        <div className="admin-banner-theme">
            <div className="admin-banner-theme-row">
                <SegmentedControl<ThemeMode>
                    ariaLabel="通知条配色"
                    value={custom ? "custom" : "preset"}
                    onChange={switchMode}
                    options={[
                        { value: "preset", label: "跟随类型" },
                        { value: "custom", label: "自定义" },
                    ]}
                />
                <SegmentedControl<BannerEffect> ariaLabel="背景动效" value={value.bgEffect} onChange={(bgEffect) => onChange({ ...value, bgEffect })} options={BANNER_EFFECTS.map((item) => ({ value: item.key, label: item.label }))} />
            </div>
            {custom ? (
                <>
                    <div className="admin-banner-theme-presets" role="group" aria-label="推荐配色">
                        {BANNER_THEME_PRESETS.map((preset) => {
                            const active = preset.base === value.bgColor && preset.glow === value.glowColor;
                            return (
                                <button key={preset.key} type="button" className={`admin-banner-theme-preset${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => onChange({ ...value, bgColor: preset.base, glowColor: preset.glow })}>
                                    <span className="admin-banner-theme-swatch" style={bannerThemeSwatchStyle(preset.base, preset.glow)} aria-hidden="true" />
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="admin-banner-theme-row">
                        <div className="admin-banner-theme-color">
                            <span>底色</span>
                            <ColorPicker
                                size="small"
                                disabledAlpha
                                showText
                                aria-label="通知条底色"
                                value={value.bgColor}
                                onChange={(color) => pick("bgColor", color.toHexString())}
                                presets={[{ label: "推荐底色（深色，白字清晰）", colors: BANNER_THEME_PRESETS.map((item) => item.base) }]}
                            />
                        </div>
                        <div className="admin-banner-theme-color">
                            <span>光晕色</span>
                            <ColorPicker
                                size="small"
                                disabledAlpha
                                showText
                                aria-label="通知条光晕色"
                                value={value.glowColor}
                                onChange={(color) => pick("glowColor", color.toHexString())}
                                presets={[{ label: "推荐光晕色（明亮）", colors: BANNER_THEME_PRESETS.map((item) => item.glow) }]}
                            />
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
}

/**
 * 底边样式：外形决定颗粒形状（平滑为不加颗粒），波纹决定底边起伏。
 * 只在深色主题下挂颗粒带，浅色主题保持直边；效果在下方「前台效果预览」里实时显示。
 */
export function BannerEdgePicker({ value, onChange }: { value: BannerThemeValue; onChange: (next: BannerThemeValue) => void }) {
    return (
        <div className="admin-banner-theme-row">
            <div className="admin-banner-theme-field">
                <span>外形</span>
                <SegmentedControl<BannerEdgeShape> ariaLabel="底边外形" value={value.edgeShape} onChange={(edgeShape) => onChange({ ...value, edgeShape })} options={BANNER_EDGE_SHAPES.map((item) => ({ value: item.key, label: item.label }))} />
            </div>
            <div className="admin-banner-theme-field">
                <span>波纹</span>
                <SegmentedControl<BannerEdgeWave> ariaLabel="底边波纹" value={value.edgeWave} onChange={(edgeWave) => onChange({ ...value, edgeWave })} options={BANNER_EDGE_WAVES.map((item) => ({ value: item.key, label: item.label }))} />
            </div>
        </div>
    );
}
