// 结果图「重做」：找出这张图当初的提示词、参考图、模型和尺寸，弹窗里调整后按图片生成重新提交一次。
// 这里只放与界面无关的还原和换算；弹窗负责交互，创作页负责提交，结果作为新的一组消息接在对话末尾。

import { imageParameterRequest } from "@/lib/image-parameters";
import { modelCapabilityConfigFor, normalizeImageSizeSetting, normalizeImageValue } from "@/lib/model-capabilities";
import { UNCATEGORIZED_MODEL_GROUP } from "@/lib/model-picker-groups";
import { mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { Skill } from "@/services/api/skills";
import { modelDisplayName, normalizeModelOptionValue, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { creationAgentProposalTask } from "./creation-agent-proposals";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";
import { creationImageSettingsForPixels, creationImageSettingsForSource, creationRatioSize, type CreationImageSettingsPatch, type CreationPixelSize } from "./creation-image-tools";
import { buildCreationMentionReferences, displayCreationPrompt, restoreCreationPromptTokens, selectedCreationReferences, type CreationReference } from "./creation-references";
import type { CreationMessage } from "./creation-types";

export type CreationImageRedoSettings = { ratio: string; quality: string; imageResolution: string; imageParameters: string; transparentBackground: string };

export type CreationImageRedoSource = {
    /** 原提示词，带素材、技能令牌，和用户消息同一格式。 */
    prompt: string;
    /** 原参考图，按提交顺序（提示词里 @图片N 的编号以此为准）。 */
    attachments: CreationAttachment[];
    /** 提示词里 @名称 与令牌互转用：原参考图和技能。 */
    references: CreationReference[];
    /** 直接生成记下的是模型选项值；Agent 只有方案卡上的展示名，没有方案时为空，弹窗用输入框的图片模型。 */
    model: { value?: string; name?: string };
    /** 原尺寸参数；为空时弹窗按这张图的实际像素换算。 */
    settings: Partial<CreationImageRedoSettings>;
    count: number;
};

export type CreationImageRedoRequest = {
    model: string;
    prompt: string;
    references: CreationReference[];
    attachments: CreationAttachment[];
    settings: CreationImageRedoSettings;
    count: number;
};

const imageAttachments = (attachments: CreationAttachment[] = []) => attachments.filter((attachment) => creationAttachmentKind(attachment) === "image");
const specText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isResolutionTier = (value: string) => /^\d+(?:\.\d+)?k$/i.test(value);

/**
 * 还原一条图片结果的生成来源，还原不出原提示词时返回 undefined（不给「重做」入口）。
 * 直接生成：取它前面那条用户消息的提示词和参考图，模型和参数取结果上记的（就是实际发出的）。
 * Agent：取工具调用里模型写下的原始提示词，没有时用方案卡或整套方案里的提示词；参考图取任务实际带上的。
 * 智能创作批次、多个 Agent 任务拼成的一组，每张提示词不同，不能整组重做。
 */
export function creationImageRedoSource(messages: CreationMessage[], item: CreationMessage, skills: Skill[] = []): CreationImageRedoSource | undefined {
    if (item.mode !== "image" || item.role !== "assistant") return undefined;
    if (item.agentRunId) return creationAgentRedoSource(messages, item);
    if (item.batchId) return undefined;
    const index = messages.findIndex((message) => message.id === item.id);
    const previous =
        index > 0
            ? messages
                  .slice(0, index)
                  .reverse()
                  .find((message) => message.role === "user")
            : undefined;
    if (!previous?.content.trim()) return undefined;
    const attachments = imageAttachments(previous.attachments);
    const settings = item.settings || previous.settings;
    return {
        prompt: previous.content,
        attachments,
        references: buildCreationMentionReferences(skills, attachments, previous.references || []),
        model: { value: item.model || previous.model },
        settings: settings ? { ratio: settings.ratio, quality: settings.quality, imageResolution: settings.imageResolution, imageParameters: settings.imageParameters, transparentBackground: settings.transparentBackground } : {},
        count: Math.max(1, Math.floor(Number(settings?.count) || 1)),
    };
}

function creationAgentRedoSource(messages: CreationMessage[], item: CreationMessage): CreationImageRedoSource | undefined {
    let task: CreationMessage | undefined;
    if (item.id.startsWith("task-batch-")) {
        const ids = [...new Set(item.taskIds || [])];
        task = ids.length === 1 ? messages.find((message) => message.id === `task-${ids[0]}`) : undefined;
    } else if (item.id.startsWith("task-")) task = messages.find((message) => message.id === item.id) || item;
    if (!task) return undefined;
    const runId = task.agentRunId;
    const reply = messages.find((message) => message.id === `${runId}:assistant`);
    const runTasks = messages.filter((message) => message.agentRunId === runId && message.id.startsWith("task-"));
    const taskId = task.id;
    // 只认已确认的方案：方案卡上的尺寸是准入后的实际值（手动参数模式下与模型写的不同）。
    const proposal = (reply?.agentProposalSets || []).flatMap((set) => (set.status === "approved" ? set.proposals.filter((candidate) => creationAgentProposalTask(set, candidate, runTasks)?.id === taskId) : [])).at(-1);
    const planItem = task.commerceItemId ? reply?.commercePlan?.items.find((candidate) => candidate.id === task.commerceItemId) : undefined;
    const generation = task.agentGeneration;
    const prompt = generation?.prompt?.trim() || proposal?.prompt.trim() || planItem?.prompt.trim() || "";
    if (!prompt) return undefined;
    const attachments = imageAttachments(generation?.references);
    // 规格先取任务上记的实际提交值（受理事件带回，没有方案卡的任务也有），旧记录没有时用方案卡或整套方案里的写法。
    const quality = generation?.quality || proposal?.quality || specText(planItem?.specs?.quality);
    const modelName = proposal?.model?.trim();
    return {
        prompt,
        attachments,
        references: buildCreationMentionReferences([], attachments),
        model: { name: modelName && modelName !== UNCATEGORIZED_MODEL_GROUP ? modelName : undefined },
        // 方案卡上的「质量」可能是分辨率档位（2K），两边都给，按模型能力各取能用的一个。
        settings: { ratio: generation?.size || proposal?.size || specText(planItem?.specs?.size) || undefined, quality: quality || undefined, imageResolution: generation?.imageResolution || (isResolutionTier(quality) ? quality : undefined) },
        count: 1,
    };
}

/** 提示词改完后换回令牌，只带提示词里仍提到的引用（技能据此生效）；参考图另外全部沿用。 */
export function creationImageRedoPrompt(source: CreationImageRedoSource, visiblePrompt: string) {
    const prompt = restoreCreationPromptTokens(visiblePrompt.trim(), source.references);
    return { prompt, references: selectedCreationReferences(prompt, source.references) };
}

/** 弹窗里给用户看的提示词：令牌换成 @图片1、@技能名，和对话里显示的一样。 */
export function creationImageRedoVisiblePrompt(source: CreationImageRedoSource) {
    return displayCreationPrompt(source.prompt, source.references);
}

/** 模型收不下这些参考图时的原因（用于置灰模型和拦住提交）；收得下返回空串。 */
export function creationImageRedoModelIssue(config: AiConfig, model: string, referenceCount: number) {
    if (!referenceCount) return "";
    const maxImages = modelCapabilityConfigFor(config, model).image?.references.maxImages ?? 0;
    if (maxImages >= referenceCount) return "";
    return maxImages < 1 ? "不支持参考图" : `最多收 ${maxImages} 张参考图`;
}

/**
 * 默认沿用原模型。原模型下线了，或现在收不下这些参考图，就换成输入框的图片模型或第一个收得下的模型，
 * 并给一句说明；不知道原模型（旧记录、没有方案的 Agent 任务）时直接用输入框的图片模型，不提示。
 */
export function creationImageRedoModel(config: AiConfig, source: CreationImageRedoSource): { model: string; note?: string } {
    const options = selectableModelsByCapability(config, "image");
    const count = source.attachments.length;
    const fits = (model: string) => !creationImageRedoModelIssue(config, model, count);
    const byValue = source.model.value ? normalizeModelOptionValue(source.model.value, config.channels) : "";
    const candidates = byValue && options.includes(byValue) ? [byValue] : source.model.name ? options.filter((model) => modelDisplayName(config, model) === source.model.name) : [];
    const original = candidates.find(fits);
    if (original) return { model: original };
    const fallback = [config.imageModel, ...options].find((model) => Boolean(model) && options.includes(model) && fits(model)) || "";
    if (!fallback) return { model: candidates[0] || config.imageModel || options[0] || "" };
    if (!source.model.value && !source.model.name) return { model: fallback };
    const next = `已换成「${modelDisplayName(config, fallback)}」`;
    if (!candidates.length) return { model: fallback, note: `原模型现在不可用，${next}。` };
    return { model: fallback, note: `原模型「${modelDisplayName(config, candidates[0])}」${creationImageRedoModelIssue(config, candidates[0], count)}，这张图用了 ${count} 张，${next}。` };
}

/**
 * 把想要的尺寸换到所选模型上：模型能直接用就照用；不能用时按比例和档位找最接近的一项；
 * 什么都没有时按这张图的实际像素换算。fitted=false 表示只是模型默认值，图片读出来后应按像素再换一次。
 * 尺寸按同名模型组的并集判断（和输入框一致），提交时由兼容路由落到具体模型。
 */
export function creationImageRedoSettings(config: AiConfig, model: string, wanted: Partial<CreationImageRedoSettings>, pixels?: CreationPixelSize): { settings: CreationImageRedoSettings; fitted: boolean } {
    const profile = modelCapabilityConfigFor(config, model).image;
    const transparentBackground = profile?.transparentBackground.supported && wanted.transparentBackground === "true" ? "true" : "false";
    if (!profile) return { settings: { ratio: wanted.ratio || "", quality: wanted.quality || "auto", imageResolution: wanted.imageResolution || "auto", imageParameters: "{}", transparentBackground }, fitted: false };
    if (profile.parameters) {
        // 工作流参数模型自己管尺寸字段：能用的值沿用，其余回到模型默认。
        const values = normalizeImageValue(profile, { size: wanted.ratio, quality: wanted.quality, imageResolution: wanted.imageResolution, imageParameters: wanted.imageParameters, count: "1" });
        return { settings: { ratio: values.size, quality: values.quality, imageResolution: values.imageResolution || "auto", imageParameters: values.imageParameters || "{}", transparentBackground }, fitted: true };
    }
    const sizeProfile = mergedImageCapabilityConfig(config, model);
    let patch: CreationImageSettingsPatch | undefined;
    if (wanted.ratio && normalizeImageSizeSetting(sizeProfile, wanted.ratio) === wanted.ratio) patch = { ratio: wanted.ratio };
    else {
        const aspect = wanted.ratio ? creationRatioSize(wanted.ratio) : undefined;
        const mapped = aspect ? creationImageSettingsForSource(sizeProfile, aspect, "current", wanted) : pixels ? creationImageSettingsForPixels(sizeProfile, pixels) : {};
        if (mapped.ratio || mapped.quality || mapped.imageResolution) patch = mapped;
    }
    const ratio = patch?.ratio || normalizeImageSizeSetting(sizeProfile, undefined);
    // 质量和分辨率按路由模型取能用的值，尺寸保留组内并集里的选择。
    const normalized = normalizeImageValue(profile, { size: ratio, quality: patch?.quality || wanted.quality, imageResolution: patch?.imageResolution || wanted.imageResolution, count: "1" });
    return { settings: { ratio, quality: normalized.quality, imageResolution: normalized.imageResolution || "auto", imageParameters: "{}", transparentBackground }, fitted: Boolean(patch) };
}

/** 报价和兼容路由用的请求需求：按所选尺寸、张数和参考图数量找能接这次请求的同名模型。 */
export function creationImageRedoRequirements(config: AiConfig, model: string, settings: CreationImageRedoSettings, count: number, referenceCount: number): ModelRequirements {
    const profile = modelCapabilityConfigFor(config, model).image;
    const values = {
        ...config,
        model,
        imageModel: model,
        size: settings.ratio,
        quality: settings.quality,
        imageResolution: settings.imageResolution,
        imageParameters: settings.imageParameters,
        count: String(count),
        transparentBackground: settings.transparentBackground,
    };
    return {
        capability: "image",
        input: { textCount: 1, imageCount: referenceCount, videoCount: 0, audioCount: 0, characterCount: 0 },
        imageSize: settings.ratio,
        options: (profile && imageParameterRequest(profile, values)) ?? { size: settings.ratio, imageResolution: settings.imageResolution, quality: settings.quality, count, transparentBackground: settings.transparentBackground === "true" },
    };
}
