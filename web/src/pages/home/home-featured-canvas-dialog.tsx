import { useQuery } from "@tanstack/react-query";
import { Button, message } from "antd";
import { ArrowUpRight, Copy, X } from "lucide-react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { collectLibTVStepPrompts, libTVCoverThumbnail } from "@/lib/libtv-gallery";
import { useLibTVCanvasCopy } from "@/pages/inspiration/use-libtv-canvas-copy";
import { getLibTVWorkDetail } from "@/services/api/libtv-gallery";
import type { LibTVGalleryItem } from "@/types/libtv-gallery";

/**
 * 首页精选画布的精简弹窗（参考 leyi.my）：左封面、右侧作者 / 规模 / 说明 / 复制按钮，来源信息折叠。
 * 和灵感广场的完整详情共用同一个详情查询缓存与复制流程；完整制作过程从「来源信息」进入。
 */
export function HomeFeaturedCanvasDialog({ item, onClose }: { item?: LibTVGalleryItem; onClose: () => void }) {
    return (
        <AppModal
            flush
            open={Boolean(item)}
            onCancel={onClose}
            footer={null}
            centered
            title={null}
            closeIcon={<X className="size-5" />}
            className="workspace-modal home-canvas-dialog"
            width={1080}
        >
            {item ? <HomeFeaturedCanvasBody key={item.templateUuid} item={item} onClose={onClose} /> : null}
        </AppModal>
    );
}

function HomeFeaturedCanvasBody({ item, onClose }: { item: LibTVGalleryItem; onClose: () => void }) {
    const [messageApi, contextHolder] = message.useMessage();
    const { data, isLoading, isError, refetch, isFetching } = useQuery({
        queryKey: ["libtv-work-detail", item.templateUuid],
        queryFn: () => getLibTVWorkDetail(item.templateUuid),
    });
    const work = data?.work ?? item;
    const { copy, copying } = useLibTVCanvasCopy({ templateUuid: item.templateUuid, title: work.title, canImport: Boolean(data?.canImport), messageApi, onClose });
    const promptCount = data ? collectLibTVStepPrompts(data.steps).length : 0;
    const published = work.publishedAt ? new Date(work.publishedAt) : null;

    return (
        <div className="home-canvas-dialog-body">
            {contextHolder}
            <h2 className="home-canvas-dialog-title">{work.title || "未命名作品"}</h2>
            <div className="home-canvas-dialog-grid">
                <div className="home-canvas-dialog-cover">{work.coverUrl ? <img src={libTVCoverThumbnail(work.coverUrl, 960)} alt="" /> : null}</div>
                <div className="home-canvas-dialog-info">
                    <p className="home-canvas-dialog-author">作者：{work.authorName || "公开作品"}</p>
                    {isLoading ? (
                        <p className="home-canvas-dialog-stats is-loading" aria-busy="true">
                            正在读取画布规模…
                        </p>
                    ) : isError ? (
                        <p className="home-canvas-dialog-stats" role="alert">
                            画布详情暂时无法读取
                            <button type="button" className="home-canvas-dialog-retry" onClick={() => void refetch()} disabled={isFetching}>
                                {isFetching ? "重试中…" : "重试"}
                            </button>
                        </p>
                    ) : data ? (
                        <p className="home-canvas-dialog-stats">
                            {data.nodeCount} 个节点 · {data.connectionCount} 条连线 · {promptCount} 份提示词
                        </p>
                    ) : null}
                    <p className="home-canvas-dialog-copy">保留图片、视频、音频、文本、分组与参考关系。打开后创建你的独立副本。</p>
                    <p className="home-canvas-dialog-copy">素材使用原站预览，失效时可上传替换。重新生成前请选择本站可用模型。</p>
                    <Button type="primary" size="large" className="home-canvas-dialog-action" icon={<Copy className="size-4" />} onClick={() => void copy()} loading={copying} disabled={!data?.canImport}>
                        复制并打开画布
                    </Button>
                    {data && !data.canImport ? <p className="home-canvas-dialog-note">这个作品没有可复制的公开节点。</p> : null}
                    <details className="home-canvas-dialog-source">
                        <summary>来源信息</summary>
                        <dl>
                            <div>
                                <dt>来源</dt>
                                <dd>LibTV 公开作品{work.authorName ? ` · ${work.authorName}` : ""}</dd>
                            </div>
                            {published && !Number.isNaN(published.getTime()) ? (
                                <div>
                                    <dt>发布</dt>
                                    <dd>{published.toLocaleDateString("zh-CN")}</dd>
                                </div>
                            ) : null}
                            {work.tags.length ? (
                                <div>
                                    <dt>标签</dt>
                                    <dd>{work.tags.map((tag) => tag.label).join(" · ")}</dd>
                                </div>
                            ) : null}
                        </dl>
                        <div className="home-canvas-dialog-links">
                            <Link to={`/inspiration/${item.templateUuid}`} onClick={onClose}>
                                查看完整制作过程
                                <ArrowUpRight aria-hidden="true" />
                            </Link>
                            {work.sourceUrl ? (
                                <a href={work.sourceUrl} target="_blank" rel="noreferrer">
                                    原作品页面
                                    <ArrowUpRight aria-hidden="true" />
                                </a>
                            ) : null}
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
}
