// 创作页空态：横幅、玩法条与精选作品。

import { useAppearanceStore } from "@/stores/use-appearance-store";
import type { CreationMode } from "./creation-assets";
import { ArrowUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import { curatedInspirations, inspirationSourceOf, inspirationSources } from "@/lib/inspirations/catalog";
import { CreationIcon } from "./creation-icons";
import { modeLabels } from "./creation-types";
import { Button } from "antd";

export const creationEmptyBannerFrames = [
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "镜头01 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "镜头02 · 暗巷追逐" },
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "镜头03 · 天台重逢" },
];

export function CreationEmptyBanner() {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className="creation-empty-art" aria-hidden="true">
            {creationEmptyBannerFrames.map((frame, index) => (
                <figure key={frame.caption} className={`creation-empty-art-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                    <img src={frame.src} alt="" />
                    <span>{frame.caption}</span>
                </figure>
            ))}
            <span className="creation-empty-art-caption">
                <span>{brandName}</span>把每一帧，交给镜头导演
            </span>
        </div>
    );
}

/**
 * 玩法条：常用的六种玩法，点一下只预填创作类型和提示词开头，不改模型、不跳页、不自动生成。
 * 封面是从仓库已有风格图裁出的 96px 小图（public/creation-plays），避免首屏加载大图。
 */
export const creationPlays: Array<{ id: string; label: string; cover: string; mode: CreationMode; prompt: string }> = [
    { id: "avatar", label: "头像", cover: "/creation-plays/avatar.jpg", mode: "image", prompt: "做一张头像，干净的纯色背景，半身构图，人物是：" },
    { id: "poster", label: "海报", cover: "/creation-plays/poster.jpg", mode: "image", prompt: "做一张电影感竖版海报，标题醒目，主题是：" },
    { id: "product", label: "商品图", cover: "/creation-plays/product.jpg", mode: "image", prompt: "做一张电商商品主图，白底，突出材质和细节，商品是：" },
    { id: "sticker", label: "表情包", cover: "/creation-plays/sticker.jpg", mode: "image", prompt: "做一组表情包，同一个角色，不同表情，角色是：" },
    { id: "storyboard", label: "故事分镜", cover: "/creation-plays/storyboard.jpg", mode: "agent", prompt: "把这个故事拆成 6 个分镜，每个镜头出一张图，故事是：" },
    { id: "short-video", label: "短视频", cover: "/creation-plays/short-video.jpg", mode: "video", prompt: "生成一段 5 秒短视频，镜头缓慢推近，画面是：" },
];

export type CreationSurface = "generate" | "canvas";

/**
 * 标题下方的"生成 | 画布"：生成就是这里的对话；画布模式下输入框不变，点发送会新建画布，
 * 把这句话和参考图交给画布里的阿Q 接着做。
 */
export function CreationSurfaceSwitch({ value, onChange, disabled }: { value: CreationSurface; onChange: (value: CreationSurface) => void; disabled?: boolean }) {
    const options: Array<{ value: CreationSurface; label: string; title: string }> = [
        { value: "generate", label: "生成", title: "在这里对话生成" },
        { value: "canvas", label: "画布", title: "发送后新建画布，交给画布里的阿Q" },
    ];
    return (
        <div className="creation-surface-switch" role="group" aria-label="创作方式">
            {options.map((option) => (
                <button key={option.value} type="button" className={value === option.value ? "is-active" : undefined} aria-pressed={value === option.value} title={option.title} disabled={disabled} onClick={() => onChange(option.value)}>
                    <CreationIcon name={option.value === "canvas" ? "canvas" : "generate"} size={16} />
                    <span>{option.label}</span>
                </button>
            ))}
        </div>
    );
}

export function CreationPlayStrip({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    return (
        <div className="creation-play-strip" role="group" aria-label="玩法">
            {creationPlays.map((play) => (
                <button key={play.id} type="button" className="creation-play-chip" onClick={() => onStartPrompt(play.mode, play.prompt)}>
                    <img src={play.cover} alt="" width={28} height={28} decoding="async" />
                    <span>{play.label}</span>
                </button>
            ))}
        </div>
    );
}

export function CreationFeaturedWorks({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    const [filter, setFilter] = useState<"all" | CreationMode>("all");
    const [limit, setLimit] = useState(12);
    const filtered = curatedInspirations.filter((item) => filter === "all" || item.mode === filter);
    // 只列出真正用到的外部来源；原创条目不写来源声明。
    const declaredSources = Array.from(new Set(curatedInspirations.map((item) => item.sourceId ?? "original")))
        .map((id) => inspirationSources[id])
        .filter((source) => source.notice);
    return (
        <section className="creation-featured-works" aria-labelledby="creation-featured-title">
            <div className="creation-featured-heading">
                <div>
                    <h2 id="creation-featured-title">精选灵感</h2>
                </div>
                <p>{curatedInspirations.length} 个创意起点 · 点击填入提示词，不自动生成</p>
            </div>
            <div className="creation-inspiration-filters" role="group" aria-label="灵感类型">
                {(["all", "video", "image", "text"] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={filter === value}
                        onClick={() => {
                            setFilter(value);
                            setLimit(12);
                        }}
                    >
                        {value === "all" ? "全部灵感" : modeLabels[value]}
                        <span>{curatedInspirations.filter((item) => value === "all" || item.mode === value).length}</span>
                    </button>
                ))}
            </div>
            <div className="creation-featured-layout">
                {filtered.slice(0, limit).map((item, index) => (
                    <button key={item.title} type="button" className={`product-collection-card creation-featured-card ${index === 0 ? "is-featured-hero" : ""}`} onClick={() => onStartPrompt(item.mode, item.prompt)}>
                        <span className="creation-featured-media">
                            <img src={item.image} alt="" loading="lazy" />
                            <span className="creation-inspiration-overlay">
                                <ArrowUp />
                                使用这个创意
                            </span>
                        </span>
                        <span className="creation-featured-copy">
                            <strong>{item.title}</strong>
                            <span>{item.description}</span>
                            <em>
                                <CreationIcon name="generate" size={14} />
                                {inspirationSourceOf(item).label} · {modeLabels[item.mode]}
                            </em>
                        </span>
                    </button>
                ))}
            </div>
            <footer className="creation-inspiration-footer">
                {limit < filtered.length ? (
                    <Button onClick={() => setLimit((count) => count + 12)}>
                        展开更多灵感
                        <ChevronDown />
                    </Button>
                ) : (
                    <span>已展示全部 {filtered.length} 个创意</span>
                )}
                <details>
                    <summary>模板与封面来源</summary>
                    {declaredSources.map((source) => (
                        <div key={source.name ?? source.label}>
                            <p>{source.notice}</p>
                            {source.repository ? (
                                <a href={source.repository} target="_blank" rel="noreferrer">
                                    {source.name} · {source.license}
                                </a>
                            ) : null}
                        </div>
                    ))}
                </details>
            </footer>
        </section>
    );
}
