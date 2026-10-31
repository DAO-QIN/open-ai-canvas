import type { GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { imageQualityDescription, imageQualityLabel } from "@/lib/image-quality";
import type { CreationAttachment, CreationMode } from "./creation-assets";
import type { CreationReference } from "./creation-references";
import type { SmartCreationAgentPlan } from "@/lib/plugins/plugin-types";
import type { AgentApproval, AgentApprovalProposal, AgentRun } from "@/services/api/agent";
import type { AgentContextUsage } from "@/lib/canvas/agent-context-usage";
import type { AudioGenerationKind } from "@/lib/audio-generation";

export type { CreationMode };

export type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
export type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string; imageResolution?: string; imageParameters?: string; transparentBackground?: string };
export type CreationRetryContext = GenerationRetryContext & { retryContextsByBatchIndex?: GenerationRetryContext[] };
export type CreationAgentQuestionOption = { id?: string; label: string; detail?: string; recommended?: boolean };
export type CreationAgentQuestionField = {
    id?: string;
    title: string;
    type?: "single_select" | "multi_select" | "segmented" | "text" | "textarea" | "model_picker";
    required?: boolean;
    allowCustom?: boolean;
    defaultValue?: string | string[];
    options?: CreationAgentQuestionOption[];
    placeholder?: string;
};
export type CreationAgentQuestion = {
    question: string;
    kind: "choice" | "form";
    options: CreationAgentQuestionOption[];
    fields?: CreationAgentQuestionField[];
    allowFreeform?: boolean;
    round?: number;
    maxRounds?: number;
};
/**
 * Agent 回复按事件顺序展开的执行过程：思考、正文、工具、提示，以及计划/审批、提问和媒体在时间线上的落点。
 * 正文与思考随事件实时更新；落点（anchor）只标记位置，内容仍由原有的计划卡、提问卡和媒体卡渲染。
 */
/** 联网搜索返回的一条来源，只保留展示需要的字段；链接已由后端限定为 http(s)。 */
export type CreationAgentWebSource = { title: string; url: string; siteName?: string };

export type CreationAgentStep =
    | { kind: "reasoning"; id: string; text: string; streaming: boolean; durationSeconds?: number }
    | { kind: "text"; id: string; text: string; streaming: boolean }
    | { kind: "tool"; id: string; toolName: string; status: "running" | "completed" | "failed"; label: string; count: number; detail?: string; sources?: CreationAgentWebSource[] }
    | { kind: "notice"; id: string; text: string }
    | { kind: "media"; id: string; taskId: string }
    | { kind: "review"; id: string }
    | { kind: "question"; id: string };

export type CreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: CreationMode;
    content: string;
    reasoning?: string;
    createdAt: string;
    status?: CreationStatus;
    model?: string;
    /** 当前会话内的临时访问地址；长期身份使用 resultStorageKeys。 */
    resultUrls?: string[];
    /** 生成结果对应的稳定素材定位符，不随 OSS 签名 URL 过期。 */
    resultStorageKeys?: string[];
    /** 与结果对齐的下载文件名（不含扩展名），保留方案序号与场景简称。 */
    resultDownloadNames?: string[];
    error?: string;
    generationErrorCode?: string;
    generationOperation?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
    taskStatuses?: Record<string, "queued" | "running" | "succeeded" | "failed" | "cancelled">;
    /** 本次页面恢复尚未复核的缓存失败，不能直接展示为当前任务结论。 */
    taskStatePending?: boolean;
    clientOperationId?: string;
    /** 创建回执尚未确认，恢复时必须沿用本次请求，不能另建生成任务。 */
    submissionPending?: boolean;
    agentIdempotencyKey?: string;
    /** 已确认 Agent 创建未被受理，原输入可以重新编辑后发送。 */
    agentSubmissionRejected?: boolean;
    retryOf?: string;
    attemptGroupId?: string;
    generationStage?: string;
    /** 最近一次观察到的任务状态、保存阶段与真实进度，只驱动生成中卡片的阶段展示，不作为业务结论。 */
    generationStatus?: TaskStatus;
    generationMediaStage?: GenerationTask["mediaStage"];
    generationProgress?: number;
    /** 页面与后端任务的连接暂时中断：任务没有被确认失败，恢复监听会继续跟进原任务。 */
    syncInterrupted?: boolean;
    /** sync：作品可能已生成，只是页面没拿到结果，应重新获取；task：后端确认任务失败。旧记录没有该字段。 */
    errorKind?: "sync" | "task";
    /** 后端确认失败，但作品已生成、可以重新保存（不重新生成、不重复扣费）。 */
    mediaRecoverable?: boolean;
    generationEffectKeys?: string[];
    agentPlan?: SmartCreationAgentPlan;
    agentRunId?: string;
    /** 补充说明复用原 run；pending 表示回执不明，不能据此另建收费轮次。 */
    agentInterjection?: "pending" | "queued" | "delivered" | "undelivered";
    /** 原 run 中插话后的续答正文；计划和媒体仍由该 run 的主消息呈现。 */
    agentContinuation?: boolean;
    /** 正文增量是否仍在输出；媒体任务运行不代表文字仍在流式输出。 */
    agentTextStreaming?: boolean;
    /** 由已发生的工具事件投影的简短反馈，不包含内部推理或原始工具结果。 */
    agentActivity?: string;
    /** 本条回复对应的执行过程（按事件顺序）；旧缓存没有该字段时按正文整体展示。 */
    agentSteps?: CreationAgentStep[];
    /** 本轮已结算的积分（只统计已结算订单），用于回复末尾的消耗提示。 */
    agentSpentCredits?: number;
    /** 本轮的逐项方案卡；确认后任务结果直接显示在对应卡片里。 */
    agentProposalSets?: CreationAgentProposalSet[];
    /** 任务消息：所属的已确认方案与方案项，用于把结果放回卡片。 */
    approvalId?: string;
    batchItemId?: string;
    /** 任务消息：模型写下的原始提示词（不含服务端追加的素材说明）和实际带上的参考素材，供结果「重做」沿用；旧记录没有。 */
    agentGeneration?: CreationAgentGeneration;
    /** 任务消息：Agent 用已有成品在本机合成的视频（timeline_render），不经模型生成、不扣积分。 */
    composition?: boolean;
    /** 视频合成的字幕：burn 来自受理回执（是否要求烧录进画面），srt 与 burned 来自成片结果。 */
    compositionSubtitles?: { burn: boolean; srt?: string; burned?: boolean };
    commerceItemId?: string;
    agentQuestion?: CreationAgentQuestion;
    agentPlanItems?: CreationAgentPlanItem[];
    commercePlan?: CreationCommercePlan;
    /** A smart or multi-output image batch rendered as one conversation result. */
    batchId?: string;
    batchTotal?: number;
    batchCompletedCount?: number;
    batchFailedCount?: number;
};
export type CreationAgentGeneration = { prompt?: string; references?: CreationAttachment[] };
export type CreationAgentPlanItem = { id: string; title: string; status: "pending" | "doing" | "done"; type?: string; targetCopy?: string; zhReviewCopy?: string; specs?: Record<string, unknown> };
/**
 * 一组逐项方案卡。approvalId 是最新一次报价（改写、移出和续期都会轮换）；rootId 不随轮换变化，
 * 用作界面上的稳定身份。expired 表示运行结束时仍未确认。
 */
export type CreationAgentProposalSet = {
    rootId: string;
    approvalId: string;
    status: "pending" | "approved" | "rejected" | "expired";
    kind: string;
    title: string;
    proposals: AgentApprovalProposal[];
    totalCredits?: number;
    editable: boolean;
    skippable: boolean;
    parametersLocked: boolean;
};
export type CreationCommercePlan = {
    planVersion: string;
    planId: string;
    version: number;
    planHash?: string;
    intent: string;
    platform: string;
    site: string;
    language: string;
    showImportantInfo?: boolean;
    productFacts: Array<{ id: string; claim: string; sourceIds: string[]; status?: "supported" | "inferred" | "unknown" }>;
    items: Array<{
        id: string;
        type: string;
        purpose: string;
        title: string;
        prompt: string;
        targetCopy: string;
        zhReviewCopy: string;
        language?: string;
        factIds?: string[];
        attachmentResourceIds: string[];
        specs?: Record<string, unknown>;
        dependencies?: string[];
        design?: { role: string; layout: string; focalPoint: string; composition: string; typography: string; palette: string };
    }>;
    styleBible?: string;
    assumptions?: string[];
    conflicts?: string[];
    languageVariants?: string[];
    styleLock?: { fontFamily: string; typography: string; headingColor: string; bodyColor: string; accentColor: string; backgroundColor: string; iconStyle: string };
    references?: Array<{ resourceId: string; name: string; role: string; kind?: string; index?: number; usage?: string; selection?: string }>;
    skills?: Array<{ id: string; name: string }>;
    estimatedCredits?: number;
    estimateStatus?: "quoted" | "unavailable";
    maxCredits?: number;
};
export type CreationConversation = {
    id: string;
    title: string;
    updatedAt: string;
    canvasId?: string;
    composerMode?: CreationMode;
    messages: CreationMessage[];
    historySourceId?: string;
    agentSessionId?: string;
    agentRunId?: string;
    agentRuns?: AgentRun[];
    agentApproval?: AgentApproval;
    agentPlanItems?: CreationAgentPlanItem[];
    agentCommercePlan?: CreationCommercePlan;
    agentContextUsage?: AgentContextUsage;
};
export type CreationHistoryEntry = CreationConversation & { historyStatus?: "unloaded" | "loading" | "error" };

// 面向 C 端的叫法：Agent 交给阿Q规划，图片/视频/音乐/音频直接出。内部 key 是 agent。
export const modeLabels: Record<CreationMode, string> = { agent: "Agent", text: "文本", image: "图片", video: "视频", audio: "音频" };
export const defaultCreationMode: CreationMode = "agent";
/**
 * 输入框左下角"创作类型"菜单的一项（参考即梦）：图标 + 名称，选中项打勾。
 * 音乐生成和音频生成共用音频模式（任务、消息和偏好里都是 audio），按所选模型的生成类型区分：
 * 音乐只列歌曲、纯音乐模型；音频列配音、音效等其余音频模型。
 */
export type CreationComposerModeKey = "agent" | "image" | "video" | "music" | "audio";
export type CreationComposerModeOption = { key: CreationComposerModeKey; label: string; mode: CreationMode; audioKind?: AudioGenerationKind };
export const creationComposerModeOptions: readonly CreationComposerModeOption[] = [
    { key: "agent", label: "Agent 模式", mode: "agent" },
    { key: "image", label: "图片生成", mode: "image" },
    { key: "video", label: "视频生成", mode: "video" },
    { key: "music", label: "音乐生成", mode: "audio", audioKind: "music" },
    { key: "audio", label: "音频生成", mode: "audio", audioKind: "speech" },
];
export function creationComposerModeKey(mode: CreationMode, audioKind: AudioGenerationKind): CreationComposerModeKey {
    if (mode === "audio") return audioKind === "music" ? "music" : "audio";
    return mode === "text" ? "agent" : mode;
}
export function creationModelCapability(mode: CreationMode) {
    return mode === "agent" ? "text" : mode;
}
/** 各创作类型在账号偏好里记的默认模型键；Agent 和文本共用文本模型。 */
export function creationModelKey(mode: CreationMode): "textModel" | "imageModel" | "videoModel" | "audioModel" {
    return mode === "text" || mode === "agent" ? "textModel" : mode === "image" ? "imageModel" : mode === "video" ? "videoModel" : "audioModel";
}
export function creationHasInput(mode: CreationMode, prompt: string, attachments: CreationAttachment[] = []) {
    return Boolean(prompt.trim()) || (mode === "agent" && attachments.some((item) => /^(image|video|audio)\//.test(item.type) && /^resource:[\w-]+$/.test(item.storageKey || "")));
}
export const shotScriptLabels: Record<CreationMode, string> = { agent: "创作思路", text: "创作思路", image: "画面指令", video: "镜头脚本", audio: "声音描述" };
export const ratioOptions = [
    { value: "1:1", label: "方形" },
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
];
export const qualityOptions = [...["auto", "low", "medium", "high", "xhigh", "max", "1k", "2k", "4k"].map((value) => ({ value, label: imageQualityLabel(value), description: imageQualityDescription(value) }))];
export const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
export const countOptions = ["1", "2", "3", "4"];
export const conversationTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export const historyDayFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

export type CreationShotRailEntry = { key: string; ordinal: number; user: CreationMessage; result?: CreationMessage };
