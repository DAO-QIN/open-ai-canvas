// 结果图上的"高清"和"扩图"只准备输入框里的参考图和参数，不直接生成；
// "局部修改"由区域标注弹窗确认后直接提交，这里只放与界面无关的计算。

import { loadRasterImage } from "@/lib/image-raster";
import { buildImageResolutionOptions } from "@/lib/image-resolution-tiers";
import { imagePresetValue, imageQualityForSelection, imageQualityForTier, imageResolutionUsesQuality, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { imageToDataUrl } from "@/services/image-storage";

export type CreationPixelSize = { width: number; height: number };
/** 只含模型实际支持、且需要改动的那几项；空对象表示保持输入框当前参数。 */
export type CreationImageSettingsPatch = { ratio?: string; quality?: string; imageResolution?: string };
export type CreationImageSettingsTarget = "highest" | "current";

const tierOrder = ["1k", "1.5k", "2k", "4k"];
const qualityOrder = ["low", "standard", "medium", "hd", "high", "xhigh", "ultra", "max"];

function tierRank(value: string | undefined) {
    return tierOrder.indexOf((value || "").trim().toLowerCase());
}

function ratioValue(value: string) {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i);
    if (!match) return 0;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? width / height : 0;
}

/** 宽高比差异取对数，横竖方向对称：2:1 和 1:2 离 1:1 一样远。 */
function ratioDistance(value: string, target: number) {
    const ratio = ratioValue(value);
    return ratio ? Math.abs(Math.log(ratio / target)) : Number.POSITIVE_INFINITY;
}

function highestResolution(values: string[]) {
    return [...values].filter((value) => tierRank(value) >= 0).sort((left, right) => tierRank(right) - tierRank(left))[0];
}

function highestQuality(values: string[]) {
    return [...values].filter((value) => qualityOrder.includes(value.toLowerCase())).sort((left, right) => qualityOrder.indexOf(right.toLowerCase()) - qualityOrder.indexOf(left.toLowerCase()))[0];
}

/** 输入框当前选中的档位；读不出时返回 undefined，由调用方取最低档。 */
function selectedTier(profile: ImageCapabilityConfig, current: CreationImageSettingsPatch) {
    if (profile.resolution.supported) return tierRank(current.imageResolution) >= 0 ? current.imageResolution!.toLowerCase() : undefined;
    if (profile.size.parameter === "aspect_ratio") {
        if (imageResolutionUsesQuality(profile)) return tierOrder.find((tier) => imageQualityForTier(profile, tier) === current.quality);
        return tierRank(current.quality) >= 0 ? current.quality!.toLowerCase() : undefined;
    }
    return current.ratio ? buildImageResolutionOptions([current.ratio])[0]?.tier : undefined;
}

/**
 * 让输出和原图同比例：在模型可选的尺寸里找宽高比最接近原图的一项。
 * highest 用于"高清"，同比例里取最高档，并把质量调到最高；current 用于"扩图"，沿用输入框当前档位。
 * 工作流参数（profile.parameters）各家语义不同，不改。
 */
export function creationImageSettingsForSource(profile: ImageCapabilityConfig, source: CreationPixelSize, target: CreationImageSettingsTarget, current: CreationImageSettingsPatch = {}): CreationImageSettingsPatch {
    if (profile.parameters || !(source.width > 0) || !(source.height > 0)) return {};
    const aspect = source.width / source.height;
    const patch: CreationImageSettingsPatch = {};
    const presets = profile.size.parameter === "none" ? [] : imageSizePresets(profile).filter((preset) => imageTierAvailable(profile, preset.tier));
    if (presets.length) {
        const nearest = Math.min(...presets.map((preset) => ratioDistance(preset.ratio, aspect)));
        const sameRatio = presets.filter((preset) => ratioDistance(preset.ratio, aspect) <= nearest + 0.01).sort((left, right) => tierRank(left.tier) - tierRank(right.tier));
        const tier = target === "current" ? selectedTier(profile, current) : undefined;
        const chosen = target === "highest" ? sameRatio[sameRatio.length - 1] : sameRatio.find((preset) => preset.tier === tier) || sameRatio[0];
        if (chosen) {
            patch.ratio = imagePresetValue(profile, chosen);
            if (profile.resolution.supported) {
                const resolution = profile.resolution.values.find((value) => value.toLowerCase() === chosen.tier);
                if (resolution) patch.imageResolution = resolution;
            } else if (profile.size.parameter === "aspect_ratio") {
                const quality = imageQualityForSelection(profile, chosen.tier);
                if (quality) patch.quality = quality;
            }
        }
    } else if (profile.size.parameter === "aspect_ratio") {
        const ratios = profile.size.values.filter((value) => ratioValue(value) > 0);
        const closest = ratios.reduce<string | undefined>((best, value) => (!best || ratioDistance(value, aspect) < ratioDistance(best, aspect) ? value : best), undefined);
        if (closest) patch.ratio = closest;
    }
    if (target === "highest") {
        if (profile.resolution.supported && !patch.imageResolution) {
            const resolution = highestResolution(profile.resolution.values);
            if (resolution) patch.imageResolution = resolution;
        }
        if (!patch.quality && profile.quality.supported && !imageResolutionUsesQuality(profile)) {
            const quality = highestQuality(profile.quality.values);
            if (quality) patch.quality = quality;
        }
    }
    return patch;
}

/** 读出结果图的 data URL 和像素尺寸；data URL 画到 canvas 上不会触发跨域污染。 */
export async function loadCreationResultImage(image: { url: string; storageKey?: string }, signal?: AbortSignal) {
    const dataUrl = await imageToDataUrl({ url: image.url, storageKey: image.storageKey });
    if (!dataUrl) throw new Error("图片读取失败");
    const element = await loadRasterImage(dataUrl, signal);
    return { dataUrl, element, size: { width: element.naturalWidth, height: element.naturalHeight } };
}

/**
 * 扩图底图的几何：原图居中，四周各留出原图 1/4 的边（整体 1.5 倍）。
 * 长边超过 maxSide 时整体等比缩小，避免上传过大的参考图。
 */
export function expandedImageGeometry(source: CreationPixelSize, scale = 1.5, maxSide = 2048) {
    const fit = Math.min(1, maxSide / (Math.max(source.width, source.height) * scale));
    const innerWidth = Math.max(1, Math.round(source.width * fit));
    const innerHeight = Math.max(1, Math.round(source.height * fit));
    const width = Math.round(innerWidth * scale);
    const height = Math.round(innerHeight * scale);
    return { width, height, inner: { x: Math.round((width - innerWidth) / 2), y: Math.round((height - innerHeight) / 2), width: innerWidth, height: innerHeight } };
}

/**
 * 扩图底图：四周铺原图的模糊放大版，中间是原图。多数模型不支持蒙版，
 * 模糊边配合提示词告诉模型"中间保持、四周补全"。模糊用"缩到很小再放大"，不依赖 ctx.filter。
 */
export async function renderExpandedImage(element: HTMLImageElement): Promise<{ file: File; width: number; height: number }> {
    const geometry = expandedImageGeometry({ width: element.naturalWidth, height: element.naturalHeight });
    const surface = document.createElement("canvas");
    surface.width = geometry.width;
    surface.height = geometry.height;
    const context = surface.getContext("2d");
    const thumbnail = document.createElement("canvas");
    const thumbnailScale = 24 / Math.max(element.naturalWidth, element.naturalHeight);
    thumbnail.width = Math.max(2, Math.round(element.naturalWidth * thumbnailScale));
    thumbnail.height = Math.max(2, Math.round(element.naturalHeight * thumbnailScale));
    const thumbnailContext = thumbnail.getContext("2d");
    if (!context || !thumbnailContext) throw new Error("当前浏览器无法处理图片");
    thumbnailContext.imageSmoothingQuality = "high";
    thumbnailContext.drawImage(element, 0, 0, thumbnail.width, thumbnail.height);
    // 透明 PNG 导出 JPEG 会变黑，先铺白底。
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, geometry.width, geometry.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(thumbnail, 0, 0, geometry.width, geometry.height);
    context.drawImage(element, geometry.inner.x, geometry.inner.y, geometry.inner.width, geometry.inner.height);
    const blob = await new Promise<Blob>((resolve, reject) => surface.toBlob((value) => (value ? resolve(value) : reject(new Error("扩图底图导出失败"))), "image/jpeg", 0.92));
    return { file: new File([blob], "扩图底图.jpg", { type: "image/jpeg" }), width: geometry.width, height: geometry.height };
}

/** 区域标注里的 @区域N 在对话里显示成"区域N"，多行合成一行。 */
export function regionEditDisplayPrompt(prompt: string) {
    const text = prompt
        .replace(/@(区域\d+)/g, "$1")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("；");
    return `局部修改：${text}`;
}
