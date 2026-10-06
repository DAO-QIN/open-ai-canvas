import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { experimentalLayerSignature, imageLayerCompositeSignature } from "@/lib/canvas/canvas-image-layers";
import { buildExperimentalImageLayerResult, imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { composeCanvasImageLayerGroup } from "@/services/canvas-image-layer-compositor";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

/** 只观察合成参数和媒体身份；拖动画布或展开/收起不会重建或请求模型。 */
export function useCanvasImageLayerGroups({
    projectId,
    enabled,
    nodes,
    nodesRef,
    setNodes,
    runningNodeId,
    activeLayerGroupIds,
}: {
    projectId: string;
    enabled: boolean;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    runningNodeId?: string | null;
    activeLayerGroupIds?: ReadonlySet<string>;
}) {
    const jobs = useRef(new Map<string, string>());
    const failed = useRef(new Map<string, string>());
    const scope = useRef(0);
    useEffect(() => {
        scope.current += 1;
        jobs.current.clear();
        failed.current.clear();
        return () => {
            scope.current += 1;
        };
    }, [projectId]);
    useEffect(() => {
        if (!enabled) return;
        for (const root of nodes) {
            const plan = root.metadata?.experimentalLayerPlan;
            if (!plan || root.metadata?.imageLayerGroup || jobs.current.has(root.id)) continue;
            const children = plan.requests.map((request) => nodes.find((node) => node.id === request.nodeId));
            if (children.some((node) => !node?.metadata?.content || node.metadata.status !== "success")) {
                if (!activeLayerGroupIds?.has(root.id) && runningNodeId !== root.id && root.metadata?.status !== "error" && children.some((node) => !node || node.metadata?.status !== "loading" || !node.metadata.taskId)) {
                    setNodes((current) =>
                        current.map((node) => (node.id === root.id ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: "实验拆层未完成：部分图层失败或尚未调用；不会自动继续扣费。请检查逐层任务结果后重新从源图发起。" } } : node)),
                    );
                }
                continue;
            }
            const signature = experimentalLayerSignature(root, nodes);
            if (plan.errorSignature === signature) continue;
            const epoch = scope.current;
            jobs.current.set(root.id, signature);
            void (async () => {
                try {
                    const result = await buildExperimentalImageLayerResult(root, nodes);
                    if (scope.current !== epoch) return;
                    setNodes((current) => {
                        const live = current.find((node) => node.id === root.id);
                        if (!live?.metadata?.experimentalLayerPlan || live.metadata.imageLayerGroup || experimentalLayerSignature(live, current) !== signature) return current;
                        const byId = new Map(result.additionalNodes.map((node) => [node.id, node]));
                        return current.map((node) =>
                            node.id === root.id ? result.node : byId.has(node.id) ? { ...node, title: byId.get(node.id)!.title, metadata: { ...node.metadata, batchRootId: root.id, imageLayer: byId.get(node.id)!.metadata!.imageLayer } } : node,
                        );
                    });
                } catch (error) {
                    if (scope.current !== epoch) return;
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === root.id && experimentalLayerSignature(node, current) === signature && node.metadata?.experimentalLayerPlan
                                ? {
                                      ...node,
                                      metadata: { ...node.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "实验拆层合成失败", experimentalLayerPlan: { ...node.metadata.experimentalLayerPlan, errorSignature: signature } },
                                  }
                                : node,
                        ),
                    );
                } finally {
                    if (scope.current === epoch) {
                        jobs.current.delete(root.id);
                        setNodes((current) => [...current]);
                    }
                }
            })();
        }
    }, [enabled, nodes, runningNodeId, activeLayerGroupIds, setNodes]);
    useEffect(() => {
        if (!enabled) return;
        for (const root of nodes) {
            const group = root.metadata?.imageLayerGroup;
            if (!group || root.metadata?.status === "loading") continue;
            const signature = imageLayerCompositeSignature(group, nodes);
            if (group.compositeSignature === signature) {
                if (group.compositeStatus !== "ready")
                    setNodes((current) =>
                        current.map((node) => {
                            const live = node.metadata?.imageLayerGroup;
                            return node.id === root.id && live && imageLayerCompositeSignature(live, current) === live.compositeSignature
                                ? { ...node, metadata: { ...node.metadata, imageLayerGroup: { ...live, compositeStatus: "ready", compositeError: undefined } } }
                                : node;
                        }),
                    );
                continue;
            }
            if (jobs.current.has(root.id) || (group.compositeStatus === "error" && failed.current.get(root.id) === signature)) continue;
            const epoch = scope.current;
            jobs.current.set(root.id, signature);
            setNodes((current) =>
                current.map((node) =>
                    node.id === root.id && node.metadata?.imageLayerGroup
                        ? {
                              ...node,
                              metadata: { ...node.metadata, imageLayerGroup: { ...node.metadata.imageLayerGroup, compositeStatus: "updating", compositeError: undefined } },
                          }
                        : node,
                ),
            );
            void (async () => {
                try {
                    const blob = await composeCanvasImageLayerGroup(group, nodes);
                    const liveGroup = nodesRef.current.find((node) => node.id === root.id)?.metadata?.imageLayerGroup;
                    if (scope.current !== epoch || !liveGroup || imageLayerCompositeSignature(liveGroup, nodesRef.current) !== signature) return;
                    const uploaded = await uploadImage(blob);
                    if (uploaded.pendingRemoteUpload) throw new Error("合成图尚未保存到服务端，请重试");
                    if (scope.current !== epoch) return;
                    setNodes((current) =>
                        current.map((node) => {
                            const liveGroup = node.metadata?.imageLayerGroup;
                            if (node.id !== root.id || !liveGroup || imageLayerCompositeSignature(liveGroup, current) !== signature) return node;
                            return { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), assetId: undefined, imageLayerGroup: { ...liveGroup, compositeSignature: signature, compositeStatus: "ready", compositeError: undefined } } };
                        }),
                    );
                    failed.current.delete(root.id);
                } catch (error) {
                    if (scope.current !== epoch) return;
                    failed.current.set(root.id, signature);
                    setNodes((current) =>
                        current.map((node) => {
                            const liveGroup = node.metadata?.imageLayerGroup;
                            if (node.id !== root.id || !liveGroup || imageLayerCompositeSignature(liveGroup, current) !== signature) return node;
                            return { ...node, metadata: { ...node.metadata, imageLayerGroup: { ...liveGroup, compositeStatus: "error", compositeError: error instanceof Error ? error.message : "合成图更新失败" } } };
                        }),
                    );
                } finally {
                    if (scope.current === epoch) {
                        jobs.current.delete(root.id);
                        // 期间若有新编辑，再触发一次观察，旧异步结果不会覆盖新版本。
                        setNodes((current) => [...current]);
                    }
                }
            })();
        }
    }, [enabled, nodes, nodesRef, setNodes]);
}
