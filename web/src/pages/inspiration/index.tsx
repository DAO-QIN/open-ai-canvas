import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { libTVCoverThumbnail } from "@/lib/libtv-gallery";
import { HomeFeaturedCanvasDialog } from "@/pages/home/home-featured-canvas-dialog";
import { featuredCanvasBadge } from "@/pages/home/home-featured-canvases";
import { getLibTVFeatured } from "@/services/api/libtv-gallery";
import type { LibTVFeaturedItem, LibTVGalleryItem } from "@/types/libtv-gallery";
import "@/pages/home/home.css";

/**
 * 「全部画布」：只展示服务端精选的一小批画布（节点多、可复制、封面无 LibTV 水印），不再铺开整个公开作品流。
 * 作品弹窗状态挂在地址栏上：打开压一条历史（返回键只关弹窗），关闭用替换，作品链接也能直接分享。
 */
export default function InspirationGalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTemplateUuid = searchParams.get("work") || undefined;
    const { data, isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ["libtv-featured"], queryFn: getLibTVFeatured, staleTime: 5 * 60_000 });
    const items = useMemo(() => data?.items ?? [], [data?.items]);
    // 分享链接里的作品可能已不在精选里：用占位条目打开弹窗，弹窗自己按 UUID 读取完整详情。
    const active = useMemo<LibTVGalleryItem | undefined>(() => {
        if (!activeTemplateUuid) return undefined;
        return items.find((item) => item.templateUuid === activeTemplateUuid) ?? { templateUuid: activeTemplateUuid, projectUuid: "", title: "", description: "", coverUrl: "", mediaUrl: "", mediaType: "unknown", authorName: "", authorAvatar: "", likeCount: 0, publishedAt: "", tags: [], sourceUrl: "" };
    }, [activeTemplateUuid, items]);

    const openWork = (item: LibTVFeaturedItem) => {
        const next = new URLSearchParams(searchParams);
        next.set("work", item.templateUuid);
        setSearchParams(next);
    };
    const closeWork = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("work");
        setSearchParams(next, { replace: true });
    };

    return (
        <WorkspacePage>
            <div className="home-gallery-page">
                <PageHeader title={items.length ? `全部画布 · ${items.length}` : "全部画布"} description="精选节点丰富、可直接复制编辑的公开画布。点开查看作品，复制后在你的空间继续创作。" />
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
                            ? Array.from({ length: 10 }, (_, index) => (
                                  <li key={index} className="home-card is-placeholder" aria-label="正在读取精选画布">
                                      <span className="home-card-cover" />
                                      <span className="home-card-line" />
                                  </li>
                              ))
                            : items.map((item) => (
                                  <li key={item.templateUuid} className="home-card">
                                      <button type="button" className="home-card-button" onClick={() => openWork(item)} title={item.title}>
                                          <span className="home-card-cover">
                                              <img src={libTVCoverThumbnail(item.coverUrl, 480)} alt="" loading="lazy" decoding="async" />
                                              <span className="home-card-badge">{featuredCanvasBadge(item)}</span>
                                              <span className="home-card-kind">
                                                  <Play aria-hidden="true" />
                                                  成片
                                              </span>
                                          </span>
                                          <strong>{item.title || "未命名作品"}</strong>
                                          <small>{item.authorName || item.tags[0]?.label || "公开作品"}</small>
                                      </button>
                                  </li>
                              ))}
                    </ul>
                )}
            </div>
            <HomeFeaturedCanvasDialog item={active} onClose={closeWork} />
        </WorkspacePage>
    );
}
