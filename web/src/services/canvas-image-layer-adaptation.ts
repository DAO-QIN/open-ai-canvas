import { imageLayerCanvasTransform, imageLayerWorkingPrompt } from "@/lib/canvas/canvas-image-layer-geometry";
import { decodeLayer, pngBlob } from "@/services/canvas-image-layer-compositor";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export async function prepareImageLayerRequest(reference: ReferenceImage, config: AiConfig, source: { width: number; height: number }, prompt: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const transform = imageLayerCanvasTransform(source, config.size);
    if (!transform || (transform.workspace.width === source.width && transform.workspace.height === source.height)) return { reference, prompt, transform: undefined };
    const decoded = await decodeLayer(reference);
    const canvas = document.createElement("canvas");
    try {
        signal.throwIfAborted();
        if (decoded.info.width !== source.width || decoded.info.height !== source.height) throw new Error("图片已更改，请重新发起拆层");
        canvas.width = transform.workspace.width; canvas.height = transform.workspace.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器不支持图片尺寸适配");
        if (decoded.info.opaque) { context.fillStyle = "#ffffff"; context.fillRect(0,0,canvas.width,canvas.height); }
        const { x,y,width,height } = transform.content;
        context.drawImage(decoded.bitmap,x,y,width,height);
        const blob = await pngBlob(canvas);
        const limit = modelCapabilityConfigFor(config, config.model).image?.references.maxImageBytes || 0;
        if (limit > 0 && blob.size > limit) throw new Error("图片适配后超过模型文件限制，请降低分辨率");
        const dataUrl = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(new Error("图片适配失败")); reader.readAsDataURL(blob); });
        signal.throwIfAborted();
        return { reference: { id:reference.id, name:reference.name, type:"image/png", dataUrl, width:canvas.width, height:canvas.height, bytes:blob.size }, prompt:imageLayerWorkingPrompt(prompt,transform), transform };
    } finally {
        decoded.bitmap.close(); canvas.width=canvas.height=0;
    }
}
