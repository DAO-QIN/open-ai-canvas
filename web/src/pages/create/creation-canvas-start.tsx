import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Plus } from "lucide-react";
import { Link } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjectsPage } from "@/services/api/user-data";
import { openLoginModal } from "@/stores/use-login-modal-store";
import { useUserStore } from "@/stores/use-user-store";

import { useCreateBlankCanvas } from "./use-create-blank-canvas";

export const CREATION_RECENT_CANVAS_COUNT = 3;

const requireLogin = () => openLoginModal({ description: "登录后即可新建画布，作品会保存在你的空间" });
const preloadCanvasProject = () => void loadCanvasProjectPage();

/**
 * 创作首页「画布」面的第一行（参考 kunrouai.com/?mode=canvas）：「新建画布」加上最近更新的 3 张画布。
 * 游客只有新建入口，点了先登录。最近画布读当前账号的云端列表；查询键挂在 canvas-library 下，画布保存、删除后和画布库一起失效。
 */
export function CreationCanvasStart() {
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const { createCanvas, creating, ready } = useCreateBlankCanvas(requireLogin);
    const busy = creating !== null;
    const recentQuery = useQuery({
        queryKey: ["canvas-library", userId, "creation-recent", CREATION_RECENT_CANVAS_COUNT],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: CREATION_RECENT_CANVAS_COUNT, sort: "updated", signal }),
        enabled: Boolean(userId) && sessionHydrated,
    });
    const loading = !sessionHydrated || Boolean(userId && recentQuery.isPending);
    const projects = userId ? (recentQuery.data?.projects ?? []).slice(0, CREATION_RECENT_CANVAS_COUNT) : [];

    return (
        <section className="creation-canvas-start" aria-label="新建或打开画布">
            <ul className="creation-canvas-start-grid" aria-busy={loading}>
                <li>
                    <button type="button" className="creation-canvas-tile is-create" onClick={() => void createCanvas()} disabled={!ready || busy} aria-busy={busy} onPointerEnter={preloadCanvasProject} onFocus={preloadCanvasProject}>
                        <span className="creation-canvas-create-icon" aria-hidden="true">
                            {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
                        </span>
                        <span className="creation-canvas-create-label">{busy ? "正在创建画布…" : "新建画布"}</span>
                    </button>
                </li>
                {loading ? (
                    Array.from({ length: CREATION_RECENT_CANVAS_COUNT }, (_, index) => <li key={index} className="creation-canvas-tile is-placeholder" aria-hidden="true" />)
                ) : userId && recentQuery.isError ? (
                    <li className="creation-canvas-start-state">
                        <span role="alert">最近画布暂时无法读取</span>
                        <button type="button" onClick={() => void recentQuery.refetch()} disabled={recentQuery.isFetching}>
                            {recentQuery.isFetching ? "重试中…" : "重试"}
                        </button>
                    </li>
                ) : (
                    projects.map((project) => (
                        <li key={project.id}>
                            <Link to={`/canvas/${project.id}`} className="creation-canvas-tile" title={project.title} onPointerEnter={preloadCanvasProject} onFocus={preloadCanvasProject}>
                                <span className="creation-canvas-tile-media" aria-hidden="true">
                                    <ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage quiet mosaic />
                                </span>
                                <span className="creation-canvas-tile-caption">
                                    <strong>{project.title || "未命名画布"}</strong>
                                    <small>
                                        {project.nodeCount ? `${project.nodeCount} 个节点` : "空白画布"} · <RelativeTime value={project.updatedAt} />
                                    </small>
                                </span>
                            </Link>
                        </li>
                    ))
                )}
            </ul>
        </section>
    );
}
