/** 新画布打开后自动放好的第一个节点；画布页读取 `?start=` 后会立即移除参数。 */
export type CanvasStartNode = "image" | "video" | "audio" | "script" | "text";

export const canvasStartNodes: readonly CanvasStartNode[] = ["image", "video", "audio", "script", "text"];

export function isCanvasStartNode(value: string | null): value is CanvasStartNode {
    return canvasStartNodes.includes(value as CanvasStartNode);
}

export function blankCanvasPath(id: string, start?: CanvasStartNode) {
    return start ? `/canvas/${id}?start=${start}` : `/canvas/${id}`;
}
