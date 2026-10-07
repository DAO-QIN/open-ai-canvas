import { inspectLayerAlpha, validateImageLayerRole } from "@/lib/canvas/canvas-image-layers";
import { validateImageLayerRegion, type ImageLayerBackgroundPatch, type ImageLayerExtraction, type ImageLayerRegion } from "@/lib/canvas/canvas-image-layer-strategy";
import { decodeLayer, pngBlob, type LayerInput } from "@/services/canvas-image-layer-compositor";

function regionPath(context: CanvasRenderingContext2D, region: ImageLayerRegion, width: number, height: number) {
    const { bbox, shape, radiusRatio } = validateImageLayerRegion(region);
    const [left, top, right, bottom] = bbox.map((n, i) => Math.round(n * (i % 2 ? height : width) / 1000));
    const w = right - left, h = bottom - top;
    if (w < 1 || h < 1) throw new Error("原图提取区域小于一个像素");
    if (shape === "ellipse") { context.moveTo(right, top + h / 2); context.ellipse(left + w / 2, top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); context.closePath(); }
    else if (shape === "rounded-rect") context.roundRect(left, top, w, h, Math.min(w, h) * radiusRatio!);
    else context.rect(left, top, w, h);
}

async function encode(canvas: HTMLCanvasElement) {
    const blob = await pngBlob(canvas);
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("无法读取原图提取 PNG"));
        reader.readAsDataURL(blob);
    });
    return { dataUrl, width: canvas.width, height: canvas.height, bytes: blob.size, mimeType: "image/png" };
}

/** Copy source pixels at their original coordinates. Never crop/recenter the output canvas. */
export async function extractImageLayerFromSource(source: LayerInput, extraction: ImageLayerExtraction, target?: { width: number; height: number }) {
    if (extraction.method === "generate" || (extraction.method === "source-region" && !extraction.region)) throw new Error("原图提取方式或区域缺失");
    if (extraction.region) validateImageLayerRegion(extraction.region);
    const decoded = await decodeLayer(source);
    const canvas = document.createElement("canvas");
    try {
        const { width, height } = decoded.info;
        if (target && (width !== target.width || height !== target.height)) throw new Error("原图资源尺寸已变化，请重新规划");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("浏览器不支持原图图层提取");
        if (extraction.method === "source-region") {
            context.beginPath(); regionPath(context, extraction.region!, width, height); context.clip();
        }
        context.drawImage(decoded.bitmap, 0, 0);
        const info = inspectLayerAlpha(width, height, context.getImageData(0, 0, width, height).data);
        validateImageLayerRole(info, extraction.method === "source" ? 0 : 1);
        return await encode(canvas);
    } finally { decoded.bitmap.close(); canvas.width = canvas.height = 0; }
}

/** Keep the original outside selected holes; consume only the generated inpainting inside them. */
export async function patchImageLayerBackground(generated: LayerInput, patch: ImageLayerBackgroundPatch) {
    if (!patch.regions.length || patch.regions.length > 7) throw new Error("底图修补区域无效");
    patch.regions.forEach(validateImageLayerRegion);
    const source = await decodeLayer(patch.source);
    const canvas = document.createElement("canvas");
    try {
        validateImageLayerRole(source.info, 0);
        const result = await decodeLayer(generated);
        try {
            validateImageLayerRole(result.info, 0);
            const { width, height } = source.info;
            if (result.info.width !== width || result.info.height !== height) throw new Error("底图修补结果与原图尺寸不一致");
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("浏览器不支持底图局部修补");
            context.drawImage(source.bitmap, 0, 0);
            context.beginPath();
            patch.regions.forEach((region) => regionPath(context, region, width, height));
            context.clip(); context.drawImage(result.bitmap, 0, 0);
            return await encode(canvas);
        } finally { result.bitmap.close(); }
    } finally { source.bitmap.close(); canvas.width = canvas.height = 0; }
}
