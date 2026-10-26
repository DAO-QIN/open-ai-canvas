import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, LayoutTemplate, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { libTVCoverThumbnail, libTVGalleryInfiniteQuery, pickLibTVRecommendations } from "@/lib/libtv-gallery";
import { getLibTVGallery } from "@/services/api/libtv-gallery";
import { LibTVWorkDetailDialog } from "@/pages/inspiration/work-detail-dialog";
import type { LibTVGalleryItem } from "@/types/libtv-gallery";

const FEATURED_COUNT = 5;

/**
 * 首页「精选画布」：和灵感广场共用同一个查询缓存（关键词为空、无标签），只取第一页前几条。
 * 点卡片只打开作品弹窗；复制到画布、做同款都在弹窗里由用户再确认，不会自动生成。
 */
export function CreationFeaturedCanvases() {
    const [activeTemplateUuid, setActiveTemplateUuid] = useState<string>();
    const { data, isLoading, isError, isFetching, refetch } = useInfiniteQuery(libTVGalleryInfiniteQuery({ keyword: "" }, getLibTVGallery));
    const items = useMemo(() => data?.pages[0]?.items.filter((item) => item.coverUrl).slice(0, FEATURED_COUNT) ?? [], [data?.pages]);
    const allItems = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data?.pages]);
    const recommended = useMemo(() => (activeTemplateUuid ? pickLibTVRecommendations(allItems, activeTemplateUuid, 6) : []), [activeTemplateUuid, allItems]);

    // 外部来源读取失败时给一行可重试的提示；读取成功但没有作品时整块不显示。
    if (isError && !items.length) {
        return (
            <section className="creation-featured-canvases" aria-labelledby="creation-featured-canvases-title">
                <FeaturedHeading />
                <div className="creation-canvas-strip-state">
                    <span role="alert">精选画布暂时无法读取</span>
                    <button type="button" onClick={() => void refetch()} disabled={isFetching}>
                        {isFetching ? "重试中…" : "重试"}
                    </button>
                </div>
            </section>
        );
    }
    if (!isLoading && !items.length) return null;

    return (
        <section className="creation-featured-canvases" aria-labelledby="creation-featured-canvases-title">
            <FeaturedHeading />
            <div className="creation-featured-canvas-grid" role="list" aria-busy={isLoading}>
                {isLoading
                    ? Array.from({ length: FEATURED_COUNT }, (_, index) => (
                          <div key={index} className="creation-featured-canvas is-placeholder" role="listitem" aria-label="正在读取精选画布">
                              <span className="creation-featured-canvas-cover" />
                              <span className="creation-featured-canvas-line" />
                          </div>
                      ))
                    : items.map((item) => <FeaturedCanvasCard key={item.templateUuid} item={item} onOpen={() => setActiveTemplateUuid(item.templateUuid)} />)}
            </div>
            <LibTVWorkDetailDialog
                templateUuid={activeTemplateUuid}
                recommended={recommended}
                onSelectWork={(item) => setActiveTemplateUuid(item.templateUuid)}
                onClose={() => setActiveTemplateUuid(undefined)}
            />
        </section>
    );
}

function FeaturedHeading() {
    return (
        <header className="creation-section-heading">
            <h2 id="creation-featured-canvases-title">
                <LayoutTemplate aria-hidden="true" />
                精选画布
            </h2>
            <Link to="/inspiration" className="creation-section-link">
                全部画布
                <ArrowUpRight aria-hidden="true" />
            </Link>
        </header>
    );
}

function FeaturedCanvasCard({ item, onOpen }: { item: LibTVGalleryItem; onOpen: () => void }) {
    return (
        <div className="creation-featured-canvas" role="listitem">
            <button type="button" className="creation-featured-canvas-button" onClick={onOpen} title={item.title}>
                <span className="creation-featured-canvas-cover">
                    <img src={libTVCoverThumbnail(item.coverUrl, 480)} alt="" loading="lazy" decoding="async" />
                    <span className="creation-featured-canvas-badge">可编辑画布</span>
                    {item.mediaType === "video" ? (
                        <span className="creation-featured-canvas-kind">
                            <Play aria-hidden="true" />
                            视频
                        </span>
                    ) : null}
                </span>
                <strong>{item.title || "未命名作品"}</strong>
                <small>{item.authorName || item.tags[0]?.label || "公开作品"}</small>
            </button>
        </div>
    );
}
