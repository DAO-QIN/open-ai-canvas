import { experimentalLayerPrompt, parseExperimentalLayerTargets } from "@/lib/canvas/canvas-image-layers";
import { imageLayerRemovalPrompt } from "@/lib/canvas/canvas-image-layer-plan";
import { inspectImageLayer } from "@/services/canvas-image-layer-compositor";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type ImageLayerStage = "extract" | "remove-background";
type LayerImage = { dataUrl: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string };
export type ImageLayerStageRequest = {
    index: number;
    stage: ImageLayerStage;
    prompt: string;
    config: AiConfig;
    reference: ReferenceImage;
    canvas?: { width: number; height: number };
};

/** 去背景是用户预先选择的处理阶段，每层最多一次；失败不会付费重试或继续其他层。 */
export async function runImageLayerExtraction({
    source,
    targets,
    prompt,
    config,
    removalConfig,
    signal,
    assertActive,
    runStage,
}: {
    source: ReferenceImage;
    targets: string[];
    prompt: string;
    config: AiConfig;
    removalConfig?: AiConfig;
    signal: AbortSignal;
    assertActive(index: number): void;
    runStage(request: ImageLayerStageRequest): Promise<{ images?: LayerImage[] }>;
}) {
    parseExperimentalLayerTargets(targets.join("\n"));
    let canvas: { width: number; height: number } | undefined;
    const check = (index: number) => {
        if (signal.aborted) throw new DOMException("拆层已停止", "AbortError");
        assertActive(index);
    };
    const inspect = async (images: LayerImage[] | undefined) => {
        if (images?.length !== 1) throw new Error("逐层提取必须返回一张独立图片，不能返回拼版或多张候选图");
        const image = images[0];
        const info = await inspectImageLayer(image);
        if (!info.nonempty) throw new Error("提取结果是完全透明的空图层");
        if (canvas && (canvas.width !== info.width || canvas.height !== info.height)) throw new Error("图层尺寸与底图不一致，已停止后续调用");
        return { image, info };
    };
    for (let index = 0; index < targets.length; index += 1) {
        check(index);
        let result = await inspect(
            (await runStage({ index, stage: "extract", prompt: experimentalLayerPrompt(prompt, targets, index), config: { ...config, count: "1", transparentBackground: index > 0 ? "true" : "false" }, reference: source, canvas })).images,
        );
        check(index);
        if (index === 0) canvas = { width: result.info.width, height: result.info.height };
        if (index > 0 && !result.info.transparent) {
            if (!removalConfig) throw new Error("拆层失败：模型未返回真实透明背景，请配置去背景处理");
            check(index);
            result = await inspect(
                (
                    await runStage({
                        index,
                        stage: "remove-background",
                        prompt: imageLayerRemovalPrompt(targets[index]),
                        config: { ...removalConfig, count: "1", transparentBackground: "true" },
                        canvas,
                        reference: { id: `${source.id}-layer-${index}`, name: `${targets[index].slice(0, 60)}.png`, type: result.image.mimeType || "image/png", ...result.image },
                    })
                ).images,
            );
            check(index);
            if (!result.info.transparent) throw new Error("去背景结果仍没有真实透明区域，已停止拆层，不自动付费重试");
        }
    }
}
