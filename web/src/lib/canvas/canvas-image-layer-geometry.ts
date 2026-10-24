export type ImageLayerCanvasTransform = {
    version: 1;
    source: { width: number; height: number };
    workspace: { width: number; height: number };
    content: { x: number; y: number; width: number; height: number };
};

const maxPixels = 16_777_216;

export function imageLayerCanvasTransform(source: { width: number; height: number }, size: string): ImageLayerCanvasTransform | undefined {
    const pair = size.match(/^(\d+)(x|:)(\d+)$/i);
    if (!pair) return;
    let width = Number(pair[1]), height = Number(pair[3]);
    if (![source.width, source.height, width, height].every((value) => Number.isSafeInteger(value) && value > 0) || source.width * source.height > maxPixels) throw new Error("图片尺寸无效或超过处理上限");
    if (pair[2] === ":") {
        const scale = Math.min(2048, Math.max(source.width, source.height)) / Math.max(width, height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
    }
    if (width * height > maxPixels) throw new Error("模型工作画布超过处理上限");
    const scale = Math.min(width / source.width, height / source.height);
    const content = { x: (width - source.width * scale) / 2, y: (height - source.height * scale) / 2, width: source.width * scale, height: source.height * scale };
    if (content.width * content.height / (width * height) < 0.4) throw new Error("图片过长，当前模型无法完整拆分，请使用支持该比例的模型");
    return { version: 1, source: { ...source }, workspace: { width, height }, content };
}

export function validateImageLayerTransform(value: ImageLayerCanvasTransform, target: { width: number; height: number }) {
    if (value?.version !== 1 || !value.source || !value.workspace || !value.content) throw new Error("图层画布适配记录无效");
    const expected = imageLayerCanvasTransform(value.source, `${value.workspace.width}x${value.workspace.height}`);
    if (!expected || target.width !== value.source.width || target.height !== value.source.height || Object.keys(expected.content).some((key) => !Number.isFinite(value.content[key as keyof typeof expected.content]) || Math.abs(expected.content[key as keyof typeof expected.content] - value.content[key as keyof typeof expected.content]) > 0.01)) throw new Error("图层画布适配记录与原图不一致");
    return expected;
}

export function imageLayerWorkingPrompt(prompt: string, transform?: ImageLayerCanvasTransform) {
    if (!transform) return prompt;
    const { workspace, content } = transform;
    const box = (values: string) => values.trim().split(/[\s,]+/).map(Number).map((value, index) => Math.round(((index % 2 ? content.y : content.x) + value / 1000 * (index % 2 ? content.height : content.width)) / (index % 2 ? workspace.height : workspace.width) * 1000));
    const mapped = prompt.replace(/<bbox>([\d.,\s]+)<\/bbox>/g, (original, values: string) => values.trim().split(/[\s,]+/).length === 4 ? `<bbox>${box(values).join(" ")}</bbox>` : original)
        .replace(/"bbox"\s*:\s*\[([\d.,\s]+)\]/g, (original, values: string) => values.trim().split(/[\s,]+/).length === 4 ? `"bbox":[${box(values).join(",")}]` : original);
    return `${mapped}\n本次以参考图完整工作画布为准。原图等比放在其中，内容区域为工作图像素 [${content.x},${content.y},${content.x+content.width},${content.y+content.height}]；其余仅为适配补边。所有坐标已映射到工作画布，输出保持完整参考画布和内容位置，不扩展、重排或裁切主体。`;
}
