import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, LoaderCircle, PanelsTopLeft, Plus } from "lucide-react";
import { Link } from "react-router";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { useCreateBlankCanvas } from "./use-create-blank-canvas";

const RECENT_COUNT = 4;

export function CreationRecentCanvases({ onRequireLogin }: { onRequireLogin: () => void }) {
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const { createCanvas: createBlankCanvas, creating: creatingKind, ready } = useCreateBlankCanvas(onRequireLogin);
    const creating = creatingKind !== null;
    const recentQuery = useQuery({
        queryKey: ["canvas-library", userId, "recent"],
        queryFn: ({ signal }) => listRemoteCanvasProjectsPage({ page: 1, pageSize: RECENT_COUNT, sort: "updated", signal }),
        enabled: Boolean(userId) && sessionHydrated,
    });
    const recentProjects = useMemo<CanvasLibrarySummary[]>(
        () =>
            userId
                ? recentQuery.data?.projects || []
                : [...localProjects]
                      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
                      .slice(0, RECENT_COUNT)
                      .map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: project.nodes.slice(0, 4) })),
        [localProjects, recentQuery.data, userId],
    );
    const loading = !sessionHydrated || !canvasHydrated || Boolean(userId && recentQuery.isPending);
    const preload = () => {
        void loadCanvasProjectPage();
    };
    const createCanvas = () => createBlankCanvas();

    return (
        <section className="creation-recent-canvases" aria-labelledby="creation-recent-title">
            <header className="creation-section-heading">
                <h2 id="creation-recent-title">
                    <Clock3 aria-hidden="true" />
                    最近画布
                </h2>
                <Link to="/canvas" className="creation-section-link">
                    查看全部
                    <ArrowUpRight aria-hidden="true" />
                </Link>
            </header>
            <div className="creation-canvas-strip creation-scrollbar" role="list" aria-label="最近更新的画布" aria-busy={loading}>
                <div className="creation-canvas-strip-item" role="listitem">
                    <button type="button" className="creation-canvas-tile is-create" disabled={!ready || creating} onClick={() => void createCanvas()} onPointerEnter={preload} onFocus={preload}>
                        <span className="creation-canvas-thumbnail is-create">{creating ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}</span>
                        <span className="creation-canvas-copy">
                            <strong>{creating ? "正在创建…" : "创建画布"}</strong>
                            <small>从空白开始</small>
                        </span>
                    </button>
                </div>
                {loading ? (
                    Array.from({ length: RECENT_COUNT }, (_, index) => (
                        <div key={index} className="creation-canvas-strip-item creation-canvas-skeleton" role="listitem" aria-label="正在读取画布">
                            <span />
                            <span />
                        </div>
                    ))
                ) : userId && recentQuery.isError ? (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <span role="alert">最近画布暂时无法读取</span>
                        <button type="button" onClick={() => void recentQuery.refetch()} disabled={recentQuery.isFetching}>
                            {recentQuery.isFetching ? "重试中…" : "重试"}
                        </button>
                    </div>
                ) : recentProjects.length ? (
                    recentProjects.map((project) => (
                        <div className="creation-canvas-strip-item" role="listitem" key={project.id}>
                            <Link to={`/canvas/${project.id}`} className="creation-canvas-tile" onPointerEnter={preload} onFocus={preload} title={project.title}>
                                <span className="creation-canvas-thumbnail" aria-hidden="true">
                                    <ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage />
                                </span>
                                <span className="creation-canvas-copy">
                                    <strong>{project.title || "未命名画布"}</strong>
                                    <small>
                                        {project.nodeCount} 个节点 · <RelativeTime value={project.updatedAt} />
                                    </small>
                                </span>
                            </Link>
                        </div>
                    ))
                ) : (
                    <div className="creation-canvas-strip-state" role="listitem">
                        <PanelsTopLeft aria-hidden="true" />
                        <span>{userId ? "还没有画布，把第一个想法留在这里。" : "登录后，最近的画布会显示在这里。"}</span>
                        {!userId ? (
                            <button type="button" onClick={onRequireLogin}>
                                登录
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
