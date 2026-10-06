import { configuredModelMatchesCapability, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export const LAYER_DECOMPOSITION_PROTOCOL = "image-tools-layer-decomposition";
export const MAX_IMAGE_LAYERS = 32;
export const MAX_LAYER_PIXELS = 16_777_216;
export const MAX_GROUP_PIXELS = 67_108_864;

export function supportsLayerDecomposition(config: AiConfig, model: string) {
    return Boolean(model) && resolveModelRequestConfig(config, model).interfaceType === LAYER_DECOMPOSITION_PROTOCOL;
}

export function supportsExperimentalLayerExtraction(config: AiConfig, model: string) {
    return Boolean(model) && configuredModelMatchesCapability(config, model, "image") && (modelCapabilityConfigFor(config, model).image?.references.maxImages || 0) >= 1;
}

export function parseExperimentalLayerTargets(text: string) {
    const targets = text
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    if (targets.length < 2 || targets.length > 8) throw new Error("实验拆层需填写 2–8 层，每行一层；第一层为背景底图");
    if (new Set(targets).size !== targets.length) throw new Error("实验拆层目标不能重复");
    return targets;
}

export function experimentalLayerPrompt(prompt: string, targets: string[], index: number) {
    const exclusion = targets.filter((_, current) => current !== index).join("、");
    return `${prompt}\n\n本次仅输出一张独立图层，目标：${targets[index]}。${index === 0 ? `这是背景底图：移除其他层（${exclusion}）中的对象，补全被遮挡背景。` : `这是透明图层：仅保留目标，移除其他层（${exclusion}）及全部背景；空白区域必须为真实 alpha=0。`}保持参考图的完整画布尺寸、目标原始位置、比例和边缘细节，不裁切、不居中重排。输出 PNG，不要拼版，不要文字标注，不要绘制棋盘格来代替透明度。`;
}

export function experimentalLayerSignature(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    return JSON.stringify(
        root.metadata?.experimentalLayerPlan?.requests.map((request) => {
            const child = nodes.find((node) => node.id === request.nodeId);
            return [request.nodeId, request.target, child?.metadata?.status, child?.metadata?.storageKey || child?.metadata?.content];
        }),
    );
}

export function layerDecompositionConfig(config: AiConfig, model: string, parameters?: Partial<Pick<AiConfig, "size" | "quality">>): AiConfig {
    return { ...config, ...parameters, model, imageModel: model, count: "1", taskWorkflowProvider: "model" };
}

export type LayerRasterInfo = { width: number; height: number; transparent: boolean; nonempty: boolean };

export function inspectLayerAlpha(width: number, height: number, rgba: Uint8ClampedArray): LayerRasterInfo {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_LAYER_PIXELS || rgba.length !== width * height * 4) {
        throw new Error("图层尺寸无效或超过处理上限");
    }
    let transparent = false;
    let nonempty = false;
    for (let index = 3; index < rgba.length; index += 4) {
        if (rgba[index] === 0) transparent = true;
        if (rgba[index] > 0) nonempty = true;
    }
    return { width, height, transparent, nonempty };
}

/** 底图可以不透明；其他图层必须有真实 alpha。允许阴影和半透明边缘相互叠加。 */
export function validateLayerRasters(layers: LayerRasterInfo[]) {
    if (layers.length < 2) throw new Error("拆层至少需要两张独立图片，单张拼版图不能作为图层结果");
    if (layers.length > MAX_IMAGE_LAYERS) throw new Error(`图层数量超过 ${MAX_IMAGE_LAYERS} 层处理上限`);
    const { width, height } = layers[0];
    if (layers.some((layer) => !layer.nonempty)) throw new Error("拆层结果包含完全透明的空图层");
    if (layers.some((layer) => layer.width !== width || layer.height !== height)) throw new Error("图层尺寸不一致，无法确定合成坐标；请使用同尺寸透明图层输出");
    if (width * height > MAX_LAYER_PIXELS || width * height * layers.length > MAX_GROUP_PIXELS) throw new Error("图层总像素量超过处理上限");
    const opaque = layers.flatMap((layer, index) => (layer.transparent ? [] : [index]));
    if (opaque.length > 1) throw new Error("拆层结果包含多张不透明图片，未返回独立透明图层");
    // API 未提供位置或语义名称。仅把唯一不透明底图放到底部，透明层保留返回顺序。
    return [...opaque, ...layers.flatMap((layer, index) => (layer.transparent ? [index] : []))];
}

export function imageLayerCompositeSignature(group: NonNullable<CanvasNodeMetadata["imageLayerGroup"]>, nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return JSON.stringify([
        group.width,
        group.height,
        group.layers.map((layer) => {
            const node = byId.get(layer.nodeId);
            return [layer.nodeId, layer.x, layer.y, layer.visible, node?.metadata?.storageKey || node?.metadata?.content || "", node?.metadata?.naturalWidth, node?.metadata?.naturalHeight];
        }),
    ]);
}

export function copyImageLayerSources(source: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (!source.metadata?.imageLayerGroup) return [source];
    const ids = new Set(source.metadata.imageLayerGroup.layers.map((layer) => layer.nodeId));
    return [source, ...nodes.filter((node) => ids.has(node.id))];
}
