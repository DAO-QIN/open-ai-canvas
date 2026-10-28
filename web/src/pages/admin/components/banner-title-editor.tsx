import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button, ColorPicker } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { Eraser, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { BannerAnnouncementBody, BannerAnnouncementShell, useBannerNow } from "@/components/layout/banner-announcement-content";
import { bannerCtaLabel, bannerNoticeTypeLabel } from "@/lib/announcements/banner-notice";
import {
    BANNER_EFFECTS,
    bannerColorHex,
    bannerHasCustomTheme,
    bannerThemeContrast,
    normalizeBannerEffect,
    readBannerPresetColors,
    type BannerThemeFields,
} from "@/lib/announcements/banner-theme";
import { BannerNoticeEmojiPopover } from "./banner-notice-emoji-picker";
import { Select } from "@/components/ui/base/select";
import {
    BANNER_TITLE_DEFAULT_FONT_SIZE,
    BANNER_TITLE_DEFAULT_FONT_WEIGHT,
    BANNER_TITLE_FONT_FAMILIES,
    BANNER_TITLE_FONT_SIZES,
    BANNER_TITLE_FONT_WEIGHTS,
    BANNER_TITLE_MAX_CHARS,
    bannerTitleCharCount,
    lowContrastBannerTitleColors,
    type BannerTitleRun,
} from "@/lib/announcements/banner-title";
import {
    applyBannerTitleStyle,
    bannerDocToRuns,
    bannerTitleRunsToDoc,
    bannerTitleSelectionStyle,
    clearBannerTitleStyle,
    createBannerTitleExtensions,
    type BannerTitleSelectionStyle,
    type BannerTitleStylePatch,
} from "@/lib/announcements/banner-title-rich-text";

const DEFAULT_OPTION = "default";

/** 一次性读出编辑器当前的分段与光标处样式，供受控渲染和回调共用。 */
function readEditorTitle(instance: Editor) {
    const runs = bannerDocToRuns(instance.getJSON());
    return { runs, selection: bannerTitleSelectionStyle(instance) };
}

/**
 * 通知标题编辑区：文字按选区设置字号 / 字重 / 字体 / 颜色。
 * 组件只把 title 分段当初始值，切换编辑对象时由调用方通过 key 重建实例。
 */
export function BannerTitleEditor({ value, onChange }: { value: BannerTitleRun[]; onChange: (runs: BannerTitleRun[]) => void }) {
    const [selectionStyle, setSelectionStyle] = useState<BannerTitleSelectionStyle>({});
    const [charCount, setCharCount] = useState(() => bannerTitleCharCount(value));

    const editor = useEditor({
        immediatelyRender: false,
        extensions: createBannerTitleExtensions("输入首页顶部展示的通知标题"),
        content: bannerTitleRunsToDoc(value),
        editorProps: {
            attributes: { class: "outline-none", "aria-label": "通知标题编辑区" },
            handleKeyDown: (_view, event) => {
                // 通知条标题是单行语义，Enter 不产生新段落。
                return event.key === "Enter";
            },
        },
        onUpdate: ({ editor: instance }) => {
            const { runs, selection } = readEditorTitle(instance);
            setSelectionStyle(selection);
            setCharCount(bannerTitleCharCount(runs));
            onChange(runs);
        },
    });

    const applyStyle = (patch: BannerTitleStylePatch) => {
        if (!editor) return;
        editor.view.focus();
        applyBannerTitleStyle(editor, patch);
        const { runs, selection } = readEditorTitle(editor);
        setSelectionStyle(selection);
        setCharCount(bannerTitleCharCount(runs));
        onChange(runs);
    };

    const tooLong = charCount > BANNER_TITLE_MAX_CHARS;

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    size="small"
                    className="w-[104px]"
                    aria-label="标题字号"
                    value={selectionStyle.fontSize ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontSize: next === DEFAULT_OPTION ? null : Number(next) })}
                    options={[
                        { value: DEFAULT_OPTION, label: `默认（${BANNER_TITLE_DEFAULT_FONT_SIZE}px）` },
                        ...BANNER_TITLE_FONT_SIZES.map((size) => ({ value: size, label: `${size}px` })),
                    ]}
                />
                <Select
                    size="small"
                    className="w-[92px]"
                    aria-label="标题字重"
                    value={selectionStyle.fontWeight ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontWeight: next === DEFAULT_OPTION ? null : Number(next) })}
                    options={[
                        { value: DEFAULT_OPTION, label: "默认字重" },
                        ...BANNER_TITLE_FONT_WEIGHTS.map((item) => ({ value: item.value, label: `${item.label} ${item.value}` })),
                    ]}
                />
                <Select
                    size="small"
                    className="w-[92px]"
                    aria-label="标题字体"
                    value={selectionStyle.fontFamily ?? DEFAULT_OPTION}
                    onChange={(next) => applyStyle({ fontFamily: next === DEFAULT_OPTION ? null : (next as BannerTitleRun["fontFamily"]) })}
                    options={[{ value: DEFAULT_OPTION, label: "默认字体" }, ...BANNER_TITLE_FONT_FAMILIES.map((item) => ({ value: item.key, label: item.label }))]}
                />
                <ColorPicker
                    size="small"
                    aria-label="标题颜色"
                    value={selectionStyle.color || "#FFFFFF"}
                    onChange={(color) => applyStyle({ color: color.toHexString().toUpperCase() })}
                    presets={[{ label: "通知条常用（深色底上醒目）", colors: ["#FFFFFF", "#FFE58F", "#FFB37B", "#FF9AA2", "#B7EB8F", "#8FD3FF", "#D3ADF7", "#9EF0E6"] }]}
                />
                {/* 不能用 Tooltip 包住 EmojiPopover：Tooltip 会向 Popover 要 ref，嵌套弹层行为不可靠。 */}
                <BannerNoticeEmojiPopover
                    onPick={(emoji) => {
                        if (!editor) return;
                        // emoji 是普通文本：插进光标处，跟随当前选区的字号 / 颜色样式，可连续插入。
                        editor.chain().focus().insertContent(emoji).run();
                    }}
                />
                <Tooltip title="清除所选文字的样式">
                    <Button
                        size="small"
                        type="text"
                        icon={<Eraser className="size-3.5" />}
                        aria-label="清除样式"
                        onClick={() => {
                            if (!editor) return;
                            clearBannerTitleStyle(editor);
                            const { runs, selection } = readEditorTitle(editor);
                            setSelectionStyle(selection);
                            setCharCount(bannerTitleCharCount(runs));
                            onChange(runs);
                        }}
                    />
                </Tooltip>
                <span className={`ml-auto font-mono text-[var(--fs-label)] ${tooLong ? "text-[var(--admin-status-error)]" : "text-foreground/45"}`}>
                    {charCount}/{BANNER_TITLE_MAX_CHARS}
                </span>
            </div>

            <div className="admin-banner-title-editor" onClick={() => editor?.view.focus()}>
                <EditorContent editor={editor} />
            </div>

            <p className="text-[var(--fs-label)] text-foreground/45">
                选中文字后调整样式；未选中时设置后续输入的文字样式。「图标」可在光标处插入 emoji 素材，位置与个数不限。默认字号 {BANNER_TITLE_DEFAULT_FONT_SIZE}px、字重 {BANNER_TITLE_DEFAULT_FONT_WEIGHT}，与通知条一致。
            </p>
        </div>
    );
}

/**
 * 前台效果预览：与首页通知条共用外壳与内容组件，配色、动效、按钮文案和倒计时实时联动，因此预览即前台结果。
 * 通知条深色底不随明暗主题切换，只需一条预览；按实际底色与光晕给出白字和标题颜色的对比度提示。
 */
export function BannerNoticePreview({
    runs,
    hasLink,
    noticeType,
    theme,
    ctaText,
    countdownEndsAt,
}: {
    runs: BannerTitleRun[];
    hasLink: boolean;
    noticeType: string;
    theme?: BannerThemeFields;
    ctaText?: string;
    countdownEndsAt?: number | null;
}) {
    const reducedMotion = Boolean(useReducedMotion());
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [preset, setPreset] = useState({ base: "", glow: "" });
    const now = useBannerNow(0, Boolean(countdownEndsAt));

    useEffect(() => {
        // 预设配色由类型决定，切换类型后重新解析实际取值。
        setPreset(readBannerPresetColors(noticeType, containerRef.current));
    }, [noticeType]);

    const custom = bannerHasCustomTheme(theme);
    const base = bannerColorHex(theme?.bgColor) || preset.base;
    const glow = bannerColorHex(theme?.glowColor) || preset.glow;
    const contrast = custom ? bannerThemeContrast(base, glow) : null;
    const themeWarning =
        contrast && contrast.base < 4.5
            ? `底色偏亮，白字对比度 ${contrast.base.toFixed(1)}:1，建议换更深的底色`
            : contrast && contrast.peak < 4.5
              ? `光晕最亮处白字对比度 ${contrast.peak.toFixed(1)}:1，建议调暗光晕色或加深底色`
              : "";
    const ctaLabel = hasLink ? bannerCtaLabel(ctaText, noticeType) : undefined;
    const countdownTarget = countdownEndsAt && countdownEndsAt > now ? countdownEndsAt : null;
    const lowContrast = lowContrastBannerTitleColors(runs, base);
    const effect = BANNER_EFFECTS.find((item) => item.key === normalizeBannerEffect(theme?.bgEffect))?.label;

    return (
        <div ref={containerRef} className="space-y-1">
            <BannerAnnouncementShell
                noticeType={noticeType}
                theme={theme}
                className="admin-banner-preview"
                trailing={
                    <span className="notice-banner-close" aria-hidden="true">
                        <X />
                    </span>
                }
            >
                <div className="notice-banner-slide">
                    <div className="notice-banner-content">
                        <BannerAnnouncementBody titleRuns={runs} title="通知标题预览" ctaLabel={ctaLabel} countdownTarget={countdownTarget} now={now} motion={!reducedMotion} />
                    </div>
                </div>
            </BannerAnnouncementShell>
            <p className="text-[var(--fs-label)] text-foreground/45">
                {bannerNoticeTypeLabel(noticeType)}
                {custom ? " · 自定义配色" : " · 类型预设配色"}
                {effect ? ` · ${effect}` : ""}
                {ctaLabel ? ` · 按钮「${ctaLabel}」` : " · 未设置跳转链接，不显示按钮"}
                {countdownEndsAt && !countdownTarget ? " · 结束时间已过，倒计时不会显示" : ""}
                {!themeWarning && !lowContrast.length ? " · 对比度达标" : ""}
            </p>
            {themeWarning || lowContrast.length ? (
                <p className="text-[var(--fs-label)] text-[var(--admin-status-warning)]" role="status">
                    {[themeWarning, lowContrast.length ? `标题颜色 ${lowContrast.join("、")} 在该底色上对比度不足 4.5:1，建议调亮` : ""].filter(Boolean).join("；")}
                </p>
            ) : null}
        </div>
    );
}
