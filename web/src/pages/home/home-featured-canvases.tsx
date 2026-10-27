import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { libTVCoverThumbnail } from "@/lib/libtv-gallery";
import { getLibTVFeatured } from "@/services/api/libtv-gallery";
import type { LibTVFeaturedItem } from "@/types/libtv-gallery";

import { HomeFeaturedCanvasDialog } from "./home-featured-canvas-dialog";

const FEATURED_COUNT = 5;

export function featuredCanvasBadge(item: Pick<LibTVFeaturedItem, "nodeCount">) {
    return item.nodeCount > 0 ? `可编辑画布 · ${item.nodeCount} 节点` : "可编辑画布";
}

/** 首页「精选画布」：服务端精选列表（节点多、可复制、无 LibTV 水印）的前 5 个，点卡片打开精简弹窗，复制仍需用户确认。 */
export function HomeFeaturedCanvases() {
    const [active, setActive] = useState<LibTVFeaturedItem>();
    const { data, isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ["libtv-featured"], queryFn: getLibTVFeatured, staleTime: 5 * 60_000 });
    const items = data?.items.slice(0, FEATURED_COUNT) ?? [];
    const total = data?.items.length ?? 0;
    if (!isLoading && !isError && !items.length) return null;

    return (
        <section className="home-section" aria-labelledby="home-featured-canvases-title">
            <header className="home-section-heading">
                <h2 id="home-featured-canvases-title">精选画布</h2>
                <Link to="/inspiration" className="home-section-link">
                    {total ? `全部画布 · ${total}` : "全部画布"}
                    <ArrowUpRight aria-hidden="true" />
                </Link>
            </header>
            {isError && !items.length ? (
                <div className="home-section-state">
                    <span role="alert">精选画布暂时无法读取</span>
                    <button type="button" onClick={() => void refetch()} disabled={isFetching}>
                        {isFetching ? "重试中…" : "重试"}
                    </button>
                </div>
            ) : (
                <ul className="home-card-grid" aria-busy={isLoading}>
                    {isLoading
                        ? Array.from({ length: FEATURED_COUNT }, (_, index) => (
                              <li key={index} className="home-card is-placeholder" aria-label="正在读取精选画布">
                                  <span className="home-card-cover" />
                                  <span className="home-card-line" />
                              </li>
                          ))
                        : items.map((item) => (
                              <li key={item.templateUuid} className="home-card">
                                  <button type="button" className="home-card-button" onClick={() => setActive(item)} title={item.title}>
                                      <span className="home-card-cover">
                                          <img src={libTVCoverThumbnail(item.coverUrl, 480)} alt="" loading="lazy" decoding="async" />
                                          <span className="home-card-badge">{featuredCanvasBadge(item)}</span>
                                          {item.mediaType === "video" ? (
                                              <span className="home-card-kind">
                                                  <Play aria-hidden="true" />
                                                  成片
                                              </span>
                                          ) : null}
                                      </span>
                                      <strong>{item.title || "未命名作品"}</strong>
                                      <small>{item.authorName || item.tags[0]?.label || "公开作品"}</small>
                                  </button>
                              </li>
                          ))}
                </ul>
            )}
            <HomeFeaturedCanvasDialog item={active} onClose={() => setActive(undefined)} />
        </section>
    );
}
