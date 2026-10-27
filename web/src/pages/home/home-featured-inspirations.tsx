import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowUpRight, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import type { CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt, resolveInspirations } from "@/lib/inspirations/resolve";
import { InspirationCardMedia } from "@/pages/inspirations/inspiration-card-media";
import { loadInspirationCatalog } from "@/services/inspiration-catalog";
import { useIncrementalReveal } from "@/hooks/use-incremental-reveal";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";

type Filter = "all" | "video" | "image" | "text";

const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "video", label: "视频" },
    { value: "image", label: "图片" },
    { value: "text", label: "文本" },
];
const MODE_LABEL: Record<string, string> = { video: "视频", image: "图片", text: "文本" };
const PAGE = 20;

/** 有视频样片的在前（其中精选优先），再是其余精选与目录顺序；limit 不传则返回全部（首页下滑分批显示）。 */
export function pickHomeInspirations(items: CreationInspiration[], filter: Filter, limit = Number.POSITIVE_INFINITY) {
    const matched = items.filter((item) => filter === "all" || item.mode === filter);
    const rank = (item: CreationInspiration) => (item.video ? 0 : 2) + (item.featured ? 0 : 1);
    return matched
        .map((item, index) => ({ item, index }))
        .sort((left, right) => rank(left.item) - rank(right.item) || left.index - right.index)
        .slice(0, limit)
        .map(({ item }) => item);
}

/**
 * 带到创作页的预填内容：只填提示词与比例，不替换模型，也不自动生成。
 * creationHome 让创作页先开一个新对话再预填，不会跳回上一次的 Agent 会话、也不会把提示词塞进旧会话。
 */
export function inspirationPrefillState(item: CreationInspiration) {
    return { creationHome: true, mode: item.mode, prompt: fillablePrompt(item), ...(item.ratio ? { ratio: item.ratio } : {}) };
}

/** 首页「精选灵感」：和灵感大厅同一份目录与个人隐藏 / 自定义设置，点卡片带着提示词进入创作页。 */
export function HomeFeaturedInspirations() {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<Filter>("all");
    const showCredits = useUserStore((state) => state.features.inspirationSourcesVisible);
    const custom = useInspirationStore((state) => state.custom);
    const overrides = useInspirationStore((state) => state.overrides);
    const hidden = useInspirationStore((state) => state.hidden);
    const { data, isLoading, isError, refetch, isFetching } = useQuery({ queryKey: ["inspiration-catalog"], queryFn: loadInspirationCatalog, staleTime: Infinity });
    const resolved = useMemo(() => (data ? resolveInspirations(data.entries, { custom, overrides, hidden }) : []), [custom, data, hidden, overrides]);
    const ordered = useMemo(() => pickHomeInspirations(resolved, filter), [filter, resolved]);
    // 首页可以一直下滑：先显示 20 条，接近底部再追加。
    const { count, hasMore, sentinelRef } = useIncrementalReveal(ordered.length, PAGE, filter);
    const items = useMemo(() => ordered.slice(0, count), [count, ordered]);

    return (
        <section className="home-section" aria-labelledby="home-featured-inspirations-title">
            <header className="home-section-heading">
                <div className="home-section-heading-main">
                    <h2 id="home-featured-inspirations-title">精选灵感</h2>
                    <div className="home-filter-tabs" role="tablist" aria-label="灵感类型">
                        {FILTERS.map((item) => (
                            <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} onClick={() => setFilter(item.value)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
                <Link to="/inspirations" className="home-section-link">
                    全部灵感
                    <ArrowUpRight aria-hidden="true" />
                </Link>
            </header>
            {isError ? (
                <div className="home-section-state">
                    <span role="alert">灵感目录暂时无法读取</span>
                    <button type="button" onClick={() => void refetch()} disabled={isFetching}>
                        {isFetching ? "重试中…" : "重试"}
                    </button>
                </div>
            ) : !isLoading && !items.length ? (
                <div className="home-section-state">
                    <span>这个分类暂时没有灵感</span>
                </div>
            ) : (
                <ul className="home-card-grid" aria-busy={isLoading}>
                    {isLoading
                        ? Array.from({ length: 10 }, (_, index) => (
                              <li key={index} className="home-card is-placeholder" aria-label="正在读取灵感">
                                  <span className="home-card-cover" />
                                  <span className="home-card-line" />
                              </li>
                          ))
                        : items.map((item) => (
                              <li key={item.id ?? `${item.sourceId}:${item.title}`} className="home-card">
                                  <button type="button" className="home-card-button" title={item.title} onClick={() => navigate("/create", { state: inspirationPrefillState(item) })}>
                                      <span className="home-card-cover">
                                          <InspirationCardMedia item={item} />
                                          <span className="home-card-badge">{MODE_LABEL[item.mode] ?? "灵感"}</span>
                                          {item.video ? (
                                              <span className="home-card-kind">
                                                  <Play aria-hidden="true" />
                                                  视频样片
                                              </span>
                                          ) : null}
                                          <span className="home-card-overlay">
                                              <ArrowUp aria-hidden="true" />
                                              使用这个创意
                                          </span>
                                      </span>
                                      <strong>{item.title}</strong>
                                      <small>{showCredits && item.credit ? item.credit : item.description || "点击填入提示词"}</small>
                                  </button>
                              </li>
                          ))}
                </ul>
            )}
            {!isLoading && !isError && items.length ? (
                <div ref={sentinelRef} className="home-load-more" role="status">
                    {hasMore ? (
                        "正在读取更多灵感…"
                    ) : (
                        <>
                            已显示全部 {ordered.length.toLocaleString("zh-CN")} 条 · <Link to="/inspirations">去灵感库筛选</Link>
                        </>
                    )}
                </div>
            ) : null}
        </section>
    );
}
