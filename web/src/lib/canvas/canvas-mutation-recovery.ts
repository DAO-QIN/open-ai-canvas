import { canonicalize } from "json-canonicalize";
import { mergeAgentCanvasEditor } from "@/lib/canvas/agent-canvas-patch";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const terminal = (status: unknown) => ["succeeded", "failed", "cancelled"].includes(String(status || ""));
const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/** Merge from the recorded edit baseline, never by replacing before values with cloud values. */
export function reconcileCanvasMutation(baseline: CanvasProject, remote: CanvasProject, local: CanvasProject): CanvasProject {
    if (baseline.id !== remote.id || local.id !== remote.id) throw new Error("画布合并身份不一致");
    const beforeNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
    const remoteNodes = new Map(remote.nodes.map((node) => [node.id, node]));
    const nodes = local.nodes.map((node) => {
        const before = beforeNodes.get(node.id)?.metadata;
        const incoming = remoteNodes.get(node.id)?.metadata;
        const current = node.metadata;
        if (!before?.taskId || before.taskId !== current?.taskId || before.taskId !== incoming?.taskId) return node;
        if (!same(current.generationOutputIndex, incoming.generationOutputIndex) && !same(current.generationOutputIndex, before.generationOutputIndex)) throw new Error("生成输出绑定已变化，已保留本地编辑");
        if (!same(current.generationOutputIndex, incoming.generationOutputIndex) || (before.generationOutputIndex !== undefined && !same(before.generationOutputIndex, current.generationOutputIndex))) return node;
        if (!terminal(incoming.taskStatus) || (terminal(current.taskStatus) && current.taskStatus !== incoming.taskStatus)) return node;
        // A task completion may supersede stale progress. User media replacements
        // still participate in the strict three-way merge, including empty values.
        const mediaFields = ["content", "storageKey", "assetId"] as const;
        if (mediaFields.some((key) => !same(current[key], before[key]) && !same(current[key], incoming[key]))) return node;
        return { ...node, metadata: { ...current, status: incoming.status, taskStatus: incoming.taskStatus, taskProgress: incoming.taskProgress, taskStage: incoming.taskStage } };
    });
    return mergeAgentCanvasEditor(baseline, remote, nodes, local.connections, { ...local, nodes });
}
