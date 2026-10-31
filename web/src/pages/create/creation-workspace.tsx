import { ImageSizePicker } from "@/components/image-size-picker";
import { useCreationPreferencesStore, type CreationAgentPreferences } from "@/stores/use-creation-preferences-store";
import { ImageParameterFields } from "@/components/image-parameter-fields";
import { useMediaQuery } from "@/hooks/use-media-query";
import { imageResolutionUsesQuality, imageSizePresets } from "@/lib/image-size-presets";
import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode, type RefObject } from "react";
import { Button, Popover } from "antd";
import { useWorkspaceTopBarMount } from "@/components/layout/workspace-top-bar-extension";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Switch } from "@/components/ui/base/switch";
import { Brain, ChevronDown, Clapperboard, Clock3, History, LoaderCircle, Plus, SlidersHorizontal, Square, Trash2, Waves, X, ArrowUp, Film, Image as ImageIcon, MessageSquareText, Lightbulb, Orbit, PenLine } from "lucide-react";


import { formatVideoResolutionLabel as videoResolutionLabel } from "@/lib/video-generation-options";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { ModelPicker } from "@/components/model-picker";
import { AgentContextRing, AgentPermissionControl } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import type { AgentContextUsageView } from "@/lib/canvas/agent-context-usage";
import type { AgentOutputPreference, AgentPermissionMode } from "@/services/api/agent";
import { CreditSymbol, formatCredits, requestCreditCost } from "@/constant/credits";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { formatShotOrdinal } from "@/lib/shot-label";
import { buildImageResolutionOptions, formatImageResolutionSize, supportsImageResolutionPresets } from "@/lib/image-resolution-tiers";
import { normalizeVideoValue, videoDurationConfigForResolution, videoDurationOptions, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import { imageQualityLabel } from "@/lib/image-quality";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import type { Skill } from "@/services/api/skills";
import { resolveSkillMentions, SKILL_RUNTIME_PROFILES } from "@/services/skill-runtime";
import { appendCreationSkillMention, removeCreationSkillMention, type CreationReference } from "./creation-references";
import { CreationSkillPicker, type CreationSkillsStatus } from "./creation-skill-picker";
import { type CreationAttachment, type CreationMode } from "./creation-assets";
import { countOptions, creationComposerModeKey, creationComposerModeOptions, creationHasInput, creationModelCapability, modeLabels, qualityOptions, resolutionOptions, type CreationShotRailEntry } from "./creation-types";
import { CreationModePicker } from "./creation-mode-picker";
import { creationMessageNeedsResultSync } from "./creation-conversations";

import "./creation-product.css";
import "./creation-scrollbars.css";
import "@/components/canvas/canvas-cloud-agent.css";
import { CreationMediaPreviewModal, type CreationResultImageRef } from "./creation-workspace-messages";
import { CreationReferenceStack } from "./creation-reference-stack";
import { hasCreationReferenceDrag, readCreationReferenceDrop } from "./creation-reference-drag";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { CreationIcon } from "./creation-icons";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { audioFormatLabelForConfig, audioModelsOfKind, audioVoiceLabelForConfig, isMusicAudioConfig, isMusicAudioModel, musicInstrumentalForConfig, type AudioGenerationKind } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export { CreationHistoryDrawer } from "./creation-workspace-history";
export { CreationMessageView } from "./creation-workspace-messages";
export { CreationEmptyBanner, CreationFeaturedWorks, CreationPlayStrip } from "./creation-workspace-empty";

const CanvasPromptOptimizerDrawer = lazy(() => import("@/components/canvas/canvas-prompt-optimizer-drawer").then((module) => ({ default: module.CanvasPromptOptimizerDrawer })));
// 和画布音频节点同一块设置面板；打开设置时才加载。
const AudioSettingsPanel = lazy(() => import("@/components/audio-settings-panel").then((module) => ({ default: module.AudioSettingsPanel })));

export const creationAssetCategoryLabels: Record<string, string> = { all: "全部素材", ...ASSET_CATEGORY_LABELS };

export function CreationWorkspaceToolbar({
    shots,
    onJumpToShot,
    onNewConversation,
    onOpenHistory,
    onContinueCanvas,
    openingCanvas,
}: {
    shots: CreationShotRailEntry[];
    onJumpToShot: (shot: CreationShotRailEntry) => void;
    onNewConversation: () => void;
    onOpenHistory: () => void;
    onContinueCanvas: () => void;
    openingCanvas: boolean;
}) {
    const [railOpen, setRailOpen] = useState(false);
    const railRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!railOpen) return;
        // pointerdown 同时覆盖鼠标和触屏：手机上点列表外任意处也能收起镜头列表。
        const onPointerDown = (event: Event) => {
            if (railRef.current && !railRef.current.contains(event.target as Node)) setRailOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown);
        return () => window.removeEventListener("pointerdown", onPointerDown);
    }, [railOpen]);
    const mount = useWorkspaceTopBarMount();
    const toolbar = <header className="creation-thread-toolbar">
        <div className="creation-toolbar-shots" ref={railRef}>
            <button type="button" className="creation-rail-trigger" aria-expanded={railOpen} aria-haspopup="listbox" aria-label={shots.length ? `镜头时间线，共 ${shots.length} 镜` : "镜头时间线"} onClick={() => setRailOpen((open) => !open)}><Clapperboard /><span className="creation-rail-trigger-label">镜头时间线</span>{shots.length > 0 ? <em className="creation-rail-count">{shots.length}</em> : null}</button>
            {railOpen ? <div className="creation-rail-pop" role="listbox" aria-label="镜头时间线">
                <div className="creation-rail-pop-head"><span className="creation-rail-pop-title">镜头时间线<small>{shots.length ? `共 ${shots.length} 镜` : "空轨道"}</small></span><button type="button" className="creation-rail-pop-close" aria-label="关闭镜头列表" onClick={() => setRailOpen(false)}><X /></button></div>
                {shots.length ? <ol className="creation-rail-list">{shots.map((shot) => {
                    const resultStatus = shot.result?.status;
                    const resultNeedsSync = Boolean(shot.result && creationMessageNeedsResultSync(shot.result));
                    const statusLabel = resultStatus === "done" ? "完成" : resultNeedsSync ? "待同步" : resultStatus === "error" ? "生成失败" : resultStatus === "pending" ? "生成中" : resultStatus === "cancelled" ? "已停止" : "待生成";
                    return <li key={shot.key}><button type="button" role="option" aria-selected="false" className="creation-rail-row" onClick={() => { setRailOpen(false); onJumpToShot(shot); }}>
                        <span className="creation-rail-row-shot">{formatShotOrdinal(shot.ordinal - 1)}</span>
                        <span className="creation-rail-row-prompt">{shot.user.content || "视频镜头"}</span>
                        <span className={`creation-rail-row-state is-${resultNeedsSync ? "sync" : resultStatus || "idle"}`}>{statusLabel}</span>
                    </button></li>;
                })}</ol> : <p className="creation-rail-empty">在下方发送一条视频消息，就会自动成为第 1 镜。</p>}
            </div> : null}
        </div>
        <div className="creation-toolbar-actions">
            <Button size="small" loading={openingCanvas} onClick={onContinueCanvas}>画布中继续</Button>
            <Tooltip title="新建创作"><button type="button" aria-label="新建创作" className="creation-toolbar-action" onClick={onNewConversation}><Plus /></button></Tooltip>
            <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" className="creation-toolbar-action" onClick={onOpenHistory}><History /></button></Tooltip>
        </div>
    </header>;
    if (mount) return createPortal(toolbar, mount);
    if (mount === null) return null;
    return toolbar;
}

type ComposerProps = {
    variant: "empty" | "thread";
    mode: CreationMode;
    prompt: string;
    setPrompt: (value: string) => void;
    busy: boolean;
    generationActive: boolean;
    agentInterjectionStatus?: "queued" | "running" | "waiting_approval";
    stopping?: boolean;
    onStop?: () => void;
    referenceReplacementBusy: boolean;
    attachments: CreationAttachment[];
    referenceImageSize?: { width: number; height: number };
    maxReferences: number;
    references: CreationReference[];
    onRemoveAttachment: (id: string) => void;
    onClearComposer: () => void;
    onReorderAttachments: (attachments: CreationAttachment[]) => void;
    onReplaceAttachment: (targetAttachmentId: string, replacement: CreationAttachment) => void;
    onReplaceReferenceFiles: (targetAttachmentId: string, files: File[]) => void;
    onPasteFiles: (files: File[]) => void;
    /** 「参考素材 → 上传图片」选好的本机图片；与粘贴同一条上传路径（存进素材库再加入本轮）。 */
    onUploadFiles: (files: File[]) => void;
    /** 打开本机文件选择前调用；返回 false 表示已拦下（例如游客先去登录），不弹出文件选择。 */
    onBeforeUpload: () => boolean;
    /** 游客：拿不到模型目录（参考上限为 0），添加入口照样可点，选上传或素材库时先登录。 */
    referenceSignInRequired: boolean;
    onOpenLibrary: () => void;
    /** 对话里的生成结果拖进输入框：落在某张卡片上替换那一张，否则加到参考素材最后。 */
    onDropResultImage: (image: CreationResultImageRef, targetAttachmentId?: string) => void;
    /** 音乐生成和音频生成都是 audio 模式，audioKind 指明要切到哪一类模型。 */
    onModeChange: (mode: CreationMode, audioKind?: AudioGenerationKind) => void;
    model: string;
    modelRequirements: ModelRequirements;
    videoProfile: VideoCapabilityConfig;
    imageProfile: ImageCapabilityConfig;
    config: AiConfig;
    onModelChange: (value: string) => void;
    ratio: string;
    setRatio: (value: string) => void;
    seconds: string;
    setSeconds: (value: string) => void;
    quality: string;
    setQuality: (value: string) => void;
    imageResolution: string;
    setImageResolution: (value: string) => void;
    imageParameters?: string;
    setImageParameters: (value: string) => void;
    setTransparentBackground: (value: string) => void;
    videoQuality: string;
    setVideoQuality: (value: string) => void;
    count: string;
    setCount: (value: string) => void;
    /** 音频模式的音色、格式、语速等；只在本页生效，不写进偏好。 */
    audioConfig?: AiConfig;
    onAudioSettingChange?: (key: CanvasAudioSettingKey, value: string) => void;
    textStreaming: boolean;
    setTextStreaming: (value: boolean) => void;
    textThinking: boolean;
    setTextThinking: (value: boolean) => void;

    promptOptimizerProvider: PromptOptimizerProvider | null;
    smartCreationAvailable: boolean;
    smartCreationActive: boolean;
    smartCreationPlanning: boolean;
    referencePasteBusy: boolean;
    onToggleSmartCreation: () => void;
    composerFocusRef: RefObject<HTMLTextAreaElement | null>;
    onPromptFocus: () => void;
    /** Agent 工具栏的「技能」：skills 是能在首页用的已安装技能，library 是全部已安装技能（技能商店的「我的技能」用）；不传则不显示。 */
    skillPicker?: { skills: Skill[]; library: Skill[]; status: CreationSkillsStatus; signInRequired: boolean; onRefresh: () => Promise<void>; onSignIn: () => void };
    placeholderOverride?: string;
    onSubmit: () => void;
    agentPermissionMode: AgentPermissionMode;
    onAgentPermissionChange: (mode: AgentPermissionMode) => void;
    agentOutputPreference: AgentOutputPreference;
    onAgentOutputPreferenceChange: (preference: AgentOutputPreference) => void;
    agentReasoningMode: CreationAgentPreferences["reasoningMode"];
    onAgentReasoningModeChange: (mode: CreationAgentPreferences["reasoningMode"]) => void;
    agentWebSearch: CreationAgentPreferences["webSearch"];
    onAgentWebSearchChange: (mode: CreationAgentPreferences["webSearch"]) => void;
    /** 平台开启并配置好联网搜索时才在「偏好」里显示「联网搜索」。 */
    agentWebSearchAvailable: boolean;
    /** 每次联网搜索实际扣的积分（微积分，已按账号分组折算）；未开启积分、免费或暂时算不出时不传。 */
    agentWebSearchPriceMicrocredits?: number;
    agentContextView: AgentContextUsageView;
    agentInputError?: string;
    agentImageModel: string;
    /** Agent 模式发送前预估（1 张当前图片模型的积分），拿不到报价时为 null。 */
    agentEstimateCredits?: number | null;
    agentVideoModel: string;
    agentImageSelectionMode: "preferred" | "fixed";
    agentVideoSelectionMode: "preferred" | "fixed";
    onAgentImageSelectionModeChange: (mode: "preferred" | "fixed") => void;
    onAgentVideoSelectionModeChange: (mode: "preferred" | "fixed") => void;
    onAgentImageModelChange: (value: string) => void;
    onAgentVideoModelChange: (value: string) => void;
    agentImageParameterMode: "auto" | "manual";
    agentVideoParameterMode: "auto" | "manual";
    onAgentImageParameterModeChange: (mode: "auto" | "manual") => void;
    onAgentVideoParameterModeChange: (mode: "auto" | "manual") => void;
    agentMaxCredits: number;
    agentMaxGenerationTasks: number;
    agentMaxVideoSeconds: number;
    onAgentBudgetChange: (key: "maxCredits" | "maxGenerationTasks" | "maxVideoSeconds", value: number) => void;
    agentImageSize: string;
    agentImageQuality: string;
    agentImageCount: number;
    agentVideoSize: string;
    agentVideoQuality: string;
    agentVideoSeconds: number;
    onAgentImageSettingChange: (key: "size" | "quality" | "count", value: string | number) => void;
    onAgentVideoSettingChange: (key: "size" | "quality" | "durationSeconds", value: string | number) => void;
};

/**
 * 输入框的默认提示：告诉用户从哪下手（参考即梦）。能加参考素材时点明「+」，Agent 和图片顺带说 @ 能引用什么。
 * 对话里的输入框和首页同样大，只是改说「接着改」；触屏（平铺布局）上手机的输入框更紧凑，提示用短句，免得窄屏上折成两行。
 */
function creationComposerPlaceholder({ variant, mode, music, noun, canAddReference, compact }: { variant: "empty" | "thread"; mode: CreationMode; music: boolean; noun: string; canAddReference: boolean; compact: boolean }) {
    if (variant === "thread") {
        if (mode === "video") return "接着改，或描述下一个镜头";
        if (music) return "接着改，或描述下一首";
        if (mode === "audio") return "接着改，或写下一段配音";
        if (!canAddReference) return "接着改，或 @ 某一张";
        return compact ? `接着改，或点「+」加${noun}` : `接着改，点「+」加${noun}，或 @ 某一张`;
    }
    if (mode === "video") return canAddReference ? "描述镜头和动作，点「+」上传首帧或参考素材" : "描述镜头、动作和运镜";
    if (music) return "描述曲风、心情，或直接写歌词";
    if (mode === "audio") return "写下配音文案，或描述想要的声音";
    if (mode === "image") return canAddReference ? "描述想要的画面，点「+」上传参考图，输入 @ 引用某一张" : "描述想要的画面：主体、场景、光线和风格";
    // 「+」下面写的就是 noun（参考素材），提示里用同一个词。
    return canAddReference ? `说说你的想法或剧本，点「+」加${noun}，输入 @ 引用素材或技能` : "说说你的想法或剧本，输入 @ 引用素材或技能";
}

export function CreationComposer(props: ComposerProps) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const compact = useMediaQuery("(max-width: 720px)");
    const [moreOpen, setMoreOpen] = useState(false);
    // 鼠标设备：参考素材叠在提示词左边，悬停展开、可拖动排序；触屏没有悬停，平铺在提示词上方。
    const referenceLayout = useMediaQuery("(hover: hover) and (pointer: fine)") ? "stack" : "tiled";
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const interactionBusy = props.busy || props.referenceReplacementBusy || props.referencePasteBusy || props.smartCreationPlanning;
    const stopping = props.mode === "agent" && props.stopping;
    const canStop = props.mode === "agent" && props.generationActive && Boolean(props.onStop);
    const interjecting = props.mode === "agent" && Boolean(props.agentInterjectionStatus);
    const interjectionHint = interjecting
        ? props.attachments.length
            ? "运行中的补充说明只支持文字；附件已保留，请等待本轮结束或停止后发送。"
            : props.agentInterjectionStatus === "waiting_approval"
              ? "补充说明会排入本轮，审批结束后送达，不会自动批准当前计划。"
              : "可补充说明，将在本轮下一步生效；修改模型和偏好将在下一轮生效。"
        : "";
    const canSubmit =
        (interjecting ? Boolean(props.prompt.trim()) && !props.attachments.length : creationHasInput(props.mode, props.prompt, props.attachments)) &&
        !interactionBusy &&
        !stopping &&
        (!canStop || interjecting) &&
        !(props.mode === "agent" && !interjecting && props.agentInputError);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const priceChannel = resolveModelChannel(props.config, props.model);
    const quoteRequest = useMemo(
        () => (props.smartCreationActive || props.mode === "agent" ? null : modelQuoteRequest(props.config, props.model, creationModelCapability(props.mode), props.modelRequirements)),
        [props.config, props.mode, props.model, props.modelRequirements, props.smartCreationActive],
    );
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const canOptimizePrompt = Boolean(props.promptOptimizerProvider) && (props.mode === "image" || props.mode === "video");
    // 图片套图使用专业规划；视频仍使用普通 Composer 和提示词优化。
    const optimizerReferences = props.references.filter((reference) => reference.active && reference.kind !== "skill");
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(props.model),
        count: props.mode === "image" ? props.count : 1,
        seconds: props.mode === "video" ? props.seconds : 1,
        capability: creationModelCapability(props.mode),
        config: props.config,
        requirements: props.modelRequirements,
    });
    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setRouteQuote(quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(null);
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest]);
    // Agent 模式按 1 张当前图片模型预估（阿Q 实际规划超出 1.2 倍时才会在对话里请你确认）。
    const agentEstimate = props.mode === "agent" && props.agentPermissionMode !== "read_only" ? (props.agentEstimateCredits ?? null) : null;
    const generationCredits = props.mode === "agent" ? agentEstimate : routeQuote ? routeQuote.amountMicrocredits / 1_000_000 : credits;
    const showCost = creditsEnabled && !props.smartCreationActive && !interjecting && generationCredits !== null && generationCredits !== undefined;
    const formattedCredits = generationCredits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
    const costTitle = props.mode === "agent" ? "按出 1 张图预估；阿Q 规划超出 1.2 倍时会先请你确认" : routeQuote ? modelQuoteDescription(routeQuote) : undefined;
    const actionLabel = stopping
        ? "正在停止"
        : props.referencePasteBusy
          ? "正在添加参考图"
          : props.referenceReplacementBusy
            ? "正在替换参考图"
            : props.smartCreationPlanning
              ? "思考中"
              : interactionBusy
                ? interjecting
                    ? "正在发送补充说明"
                    : props.mode === "agent"
                      ? "思考中"
                      : "生成中"
                : interjecting
                  ? "发送补充说明"
                  : showCost
                    ? props.mode === "agent"
                        ? `约 ${formattedCredits} 积分，发送`
                        : `${routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，发送`
                    : "发送";
    // Once the backend task has been accepted, the task row keeps showing its
    // own progress while this composer is immediately available for another
    // prompt. Only work that still blocks submission owns the spinner.
    const showWorkingSpinner = stopping || (interactionBusy && !canStop);
    // 音乐生成和音频生成都是 audio 模式，按当前模型区分；模型菜单只列同一类，免得在音频里选到音乐模型。
    const musicModels = useMemo(() => audioModelsOfKind(props.config, "music"), [props.config]);
    const speechModels = useMemo(() => audioModelsOfKind(props.config, "speech"), [props.config]);
    const musicMode = props.mode === "audio" && isMusicAudioModel(props.config, props.model);
    const activeModeKey = creationComposerModeKey(props.mode, musicMode ? "music" : "speech");
    // 没有对应模型的类型不进菜单，免得选了也发不出去；当前类型始终保留。
    const modeOptions = useMemo(
        () => creationComposerModeOptions.filter((option) => option.key === activeModeKey || !option.audioKind || (option.audioKind === "music" ? musicModels : speechModels).length > 0),
        [activeModeKey, musicModels, speechModels],
    );
    const audioModelFilter = useMemo(() => (props.mode === "audio" ? (model: string) => isMusicAudioModel(props.config, model) === musicMode : undefined), [musicMode, props.config, props.mode]);
    const imageReferencesSupported = props.imageProfile.references.maxImages > 0;
    const referencesSupported = props.mode === "audio" ? false : props.mode === "image" ? imageReferencesSupported : props.mode !== "video" || props.maxReferences > 0;
    const referenceNoun = props.mode === "image" ? "参考图" : "参考素材";
    const placeholder = creationComposerPlaceholder({ variant: props.variant, mode: props.mode, music: musicMode, noun: referenceNoun, canAddReference: referencesSupported, compact: referenceLayout === "tiled" });
    const canAddMoreReferences = referencesSupported && (props.referenceSignInRequired || props.attachments.length < props.maxReferences);
    // 没有可用上限时说清原因：游客先登录，没选模型先选模型，选了的模型确实不收参考素材。
    const referenceUnavailableText = props.referenceSignInRequired ? "登录后可添加参考素材" : props.model ? "当前模型不支持参考素材" : "选好模型后可添加参考素材";
    const addReferenceLabel = interactionBusy
        ? props.referenceReplacementBusy
            ? "正在替换参考图"
            : props.referencePasteBusy
              ? "正在上传参考图"
              : props.mode === "agent"
                ? "思考中暂不能添加参考素材"
                : "生成中暂不能添加参考素材"
        : canAddMoreReferences
          ? props.referenceSignInRequired || props.maxReferences <= 0
              ? "添加参考素材"
              : `添加${props.mode === "image" ? "参考图" : "参考素材"}（${props.attachments.length}/${props.maxReferences}）`
          : props.maxReferences > 0
            ? `已达到当前模型的参考素材上限（${props.maxReferences} 个）`
            : referenceUnavailableText;
    // 卡片角标用提示词里的叫法（@图片1、@视频1），拖动换顺序后编号跟着变，提示词按素材身份引用，不会错位。
    const referenceLabels = useMemo(() => new Map(props.references.flatMap((reference) => (reference.attachmentId ? [[reference.attachmentId, reference.label] as const] : []))), [props.references]);
    const referenceUnit = props.mode === "image" ? "张" : "个";
    const showReferences = props.attachments.length > 0 || referencesSupported;
    const referenceSummary = props.referencePasteBusy
        ? "正在上传参考图…"
        : props.referenceReplacementBusy
          ? "正在替换参考图…"
          : referencesSupported && props.maxReferences > 0
            ? `${referenceNoun} ${props.attachments.length}/${props.maxReferences} ${referenceUnit}`
            : props.attachments.length
              ? `${referenceNoun} ${props.attachments.length} ${referenceUnit} · 当前模型不支持参考素材`
              : referenceUnavailableText;
    const imageSettingsSupported = props.imageProfile.size.parameter !== "none" || props.imageProfile.quality.supported || props.imageProfile.maxOutputs > 1;
    const previewAttachment = (type: "image" | "video", url: string) => {
        setPreviewType(type);
        setPreviewUrl(url);
    };
    // 插入引用后把光标放回提示词末尾。有引用标签时输入框是可编辑区，composerFocusRef 只指向纯文本框，所以按类名找当前那一个。
    const focusPromptEnd = () =>
        window.requestAnimationFrame(() => {
            const editor = composerRef.current?.querySelector<HTMLElement>('textarea.creation-chat-mention-editor, [role="textbox"].creation-chat-mention-editor');
            if (!editor) return;
            editor.focus({ preventScroll: true });
            if (editor instanceof HTMLTextAreaElement) {
                editor.setSelectionRange(editor.value.length, editor.value.length);
                return;
            }
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
        });
    // 卡片上的「@」：把这一张引用到提示词末尾，和在输入框里打 @ 选它一样。
    const mentionAttachment = (attachmentId: string) => {
        const reference = props.references.find((item) => item.attachmentId === attachmentId);
        if (!reference) return;
        const prompt = props.prompt;
        props.setPrompt(`${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}${canvasResourceMentionToken(reference)} `);
        focusPromptEnd();
    };
    // 「技能」菜单：选中状态直接从提示词里读（技能标签、@名称、/名称），删掉标签也就取消了选择。
    const skillPicker = props.mode === "agent" ? props.skillPicker : undefined;
    const selectedSkillIds = skillPicker ? resolveSkillMentions(props.prompt, skillPicker.skills).map((skill) => skill.skillId) : [];
    // 技能商店弹窗里选技能时 focusPrompt 为 false：弹窗还开着，焦点留在弹窗里，关上后回到「技能」按钮。
    const toggleSkill = (skill: Skill, options?: { focusPrompt?: boolean }) => {
        if (selectedSkillIds.includes(skill.skillId)) {
            props.setPrompt(removeCreationSkillMention(props.prompt, skill));
            return;
        }
        props.setPrompt(appendCreationSkillMention(props.prompt, skill.skillId));
        if (options?.focusPrompt !== false) focusPromptEnd();
    };
    // 拖进输入框的本机图片、对话里的生成结果：落在卡片上由卡片自己处理（替换那一张），其余位置都加到最后。
    const acceptsReferenceDrop = referencesSupported && !interactionBusy;
    const addDroppedReferences = (dataTransfer: DataTransfer) => {
        const { resultImage, files } = readCreationReferenceDrop(dataTransfer);
        if (resultImage) props.onDropResultImage(resultImage);
        else if (files.length && props.onBeforeUpload()) props.onUploadFiles(files);
    };
    const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !hasCreationReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = acceptsReferenceDrop ? "copy" : "none";
    };
    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !hasCreationReferenceDrag(event.dataTransfer)) return;
        event.preventDefault();
        if (acceptsReferenceDrop) addDroppedReferences(event.dataTransfer);
    };
    useEffect(() => {
        if (!canOptimizePrompt) setPromptOptimizerOpen(false);
    }, [canOptimizePrompt]);
    useEffect(() => {
        if (props.smartCreationActive) setPromptOptimizerOpen(false);
    }, [props.smartCreationActive]);
    const imageReferenceAtPoint = (x: number, y: number) => {
        for (const element of document.elementsFromPoint(x, y)) {
            const chip = element.closest<HTMLElement>("[data-mention-reference-id]");
            const referenceId = chip?.dataset.mentionReferenceId;
            const reference = referenceId ? props.references.find((item) => item.id === referenceId) : undefined;
            if (reference?.kind === "image" && reference.attachmentId) return reference;
        }
        return undefined;
    };
    // 输入框不再套流光描边和跟随鼠标的聚光：一层细描边加半透明底，焦点时描边加深。
    const composer = (
        <div className="creation-composer-shell">
            <div ref={composerRef} className={`creation-chat-composer is-${props.variant}`} onDragOver={handleReferenceDragOver} onDrop={handleReferenceDrop}>
                <div className="creation-chat-writing-surface">
                    <div className={`creation-chat-editor${showReferences ? (referenceLayout === "stack" ? " has-reference-stack" : " has-reference-row") : ""}`}>
                        {/* 参考素材（参考即梦）：提示词左边一摞斜放的小卡片，悬停展开；「+」选上传或素材库，
                            展开后按住卡片拖动换顺序，拖到提示词里的 @图片 上替换那一张。 */}
                        {showReferences ? (
                            <CreationReferenceStack
                                variant={props.variant}
                                layout={referenceLayout}
                                attachments={props.attachments}
                                labels={referenceLabels}
                                noun={referenceNoun}
                                status={referenceSummary}
                                busy={interactionBusy}
                                uploading={props.referencePasteBusy}
                                showAdd={referencesSupported}
                                canAdd={!interactionBusy && canAddMoreReferences}
                                addLabel={addReferenceLabel}
                                onBeforeUpload={props.onBeforeUpload}
                                onUploadFiles={props.onUploadFiles}
                                onOpenLibrary={props.onOpenLibrary}
                                onDropAdd={addDroppedReferences}
                                onPreview={previewAttachment}
                                onRemove={props.onRemoveAttachment}
                                onMention={interactionBusy ? undefined : mentionAttachment}
                                onReorder={props.onReorderAttachments}
                                findPromptImageAt={imageReferenceAtPoint}
                                onPromptDropTargetChange={setDropTargetReferenceId}
                                onReplaceWithAttachment={props.onReplaceAttachment}
                                onReplaceWithFiles={props.onReplaceReferenceFiles}
                                onDropResultImage={props.onDropResultImage}
                            />
                        ) : null}
                        <div className="creation-chat-editor-main">
                            <CanvasResourceMentionTextarea
                                ref={props.composerFocusRef}
                                value={props.prompt}
                                references={props.references}
                                mentionMenuWidth={400}
                                sendOnEnter
                                onFocus={props.onPromptFocus}
                                onChange={props.setPrompt}
                                onSubmit={props.onSubmit}
                                containerClassName="creation-chat-mention-container"
                                className="creation-chat-mention-editor creation-scrollbar"
                                style={{ color: "var(--creation-text)", height: "auto", maxHeight: "min(320px, 35dvh)" }}
                                placeholder={props.placeholderOverride || placeholder}
                                aria-label="创作提示词，可使用 @ 引用当前参考内容或技能；回车发送，Shift+回车换行"
                                spellCheck
                                disabled={interactionBusy}
                                activeDropReferenceId={dropTargetReferenceId}
                                onPasteFiles={props.onPasteFiles}
                                onReferenceFilesDrop={(reference, files) => {
                                    const target = props.references.find((item) => item.id === reference.id);
                                    if (target?.attachmentId) props.onReplaceReferenceFiles(target.attachmentId, files);
                                }}
                            />
                            {interjectionHint ? (
                                <p role="status" style={{ color: "var(--creation-muted)", fontSize: "var(--fs-label)" }}>
                                    {interjectionHint}
                                </p>
                            ) : props.mode === "agent" && props.agentInputError ? (
                                <p className="creation-agent-error" role="alert">
                                    {props.agentInputError}
                                </p>
                            ) : null}
                        </div>
                    </div>
                </div>
                <footer className="creation-chat-dock">
                    <div className="creation-chat-controls">
                        <CreationModePicker value={activeModeKey} options={modeOptions} variant={props.variant} onSelect={(option) => props.onModeChange(option.mode, option.audioKind)} />
                        {canOptimizePrompt ? (
                            <Tooltip title="用 AI 优化提示词">
                                <button
                                    type="button"
                                    className="creation-chat-control"
                                    onClick={() => setPromptOptimizerOpen(true)}
                                    aria-label="优化提示词"
                                    aria-expanded={promptOptimizerOpen}
                                    aria-haspopup="dialog"
                                    disabled={props.smartCreationActive || interactionBusy}
                                >
                                    <CreationIcon name="edit" />
                                    <span>优化</span>
                                </button>
                            </Tooltip>
                        ) : null}
                        <ModelPicker
                            config={props.config}
                            value={props.model}
                            onChange={props.onModelChange}
                            capability={creationModelCapability(props.mode)}
                            modelFilter={audioModelFilter}
                            requirements={props.modelRequirements}
                            className="creation-model-picker"
                            placeholder={props.mode === "agent" ? "选择模型" : `选择${musicMode ? "音乐" : modeLabels[props.mode]}模型`}
                            showSelectedPrice={false}
                            showOptionPrices
                            variant="creation"
                        />
                        {props.mode === "agent" ? (
                            <>
                                <AgentExecutionSettings {...props} />
                                {skillPicker ? (
                                    <CreationSkillPicker
                                        variant={props.variant}
                                        skills={skillPicker.skills}
                                        library={skillPicker.library}
                                        status={skillPicker.status}
                                        selectedIds={selectedSkillIds}
                                        max={SKILL_RUNTIME_PROFILES.creation.maxSkills}
                                        signInRequired={skillPicker.signInRequired}
                                        disabled={interactionBusy || interjecting}
                                        disabledReason={interjecting ? "Agent 运行中，本轮结束后可以选技能" : undefined}
                                        onRefresh={skillPicker.onRefresh}
                                        onToggle={toggleSkill}
                                        onSignIn={skillPicker.onSignIn}
                                    />
                                ) : null}
                                <AgentPermissionControl mode={props.agentPermissionMode} onChange={props.onAgentPermissionChange} surface="creation" />
                            </>
                        ) : null}
                        {props.mode === "audio" && props.audioConfig && props.onAudioSettingChange ? (
                            <AudioSettingsMenu config={props.audioConfig} onChange={props.onAudioSettingChange} />
                        ) : !props.smartCreationActive && (props.mode === "video" || (props.mode === "image" && imageSettingsSupported)) ? (
                            <GenerationSettingsMenu {...props} />
                        ) : props.smartCreationActive ? (
                            <span className="creation-chat-control creation-chat-control-agent-lock" aria-label="智能创作已接管生成参数">
                                Agent 参数已接管
                            </span>
                        ) : null}
                        {props.mode === "video" ? <DurationMenu profile={props.videoProfile} seconds={props.seconds} resolution={props.videoQuality} onChange={props.setSeconds} /> : null}
                        {props.mode === "text" ? (
                            <>
                                <Tooltip title={interactionBusy ? "生成中，此开关将在下次发送时生效" : props.textStreaming ? "流式输出已开启" : "流式输出已关闭"}>
                                    <button type="button" className="creation-chat-control" aria-pressed={props.textStreaming} disabled={interactionBusy} onClick={() => props.setTextStreaming(!props.textStreaming)}>
                                        <Waves />
                                        <span>流式</span>
                                    </button>
                                </Tooltip>
                                <Tooltip title={interactionBusy ? "生成中，此开关将在下次发送时生效" : props.textThinking ? "思考已开启，会展示模型返回的推理摘要" : "开启模型思考"}>
                                    <button type="button" className="creation-chat-control" aria-pressed={props.textThinking} disabled={interactionBusy} onClick={() => props.setTextThinking(!props.textThinking)}>
                                        <Brain />
                                        <span>思考</span>
                                    </button>
                                </Tooltip>
                            </>
                        ) : null}
                        {/* 技能一直列在 @ 菜单里（读到技能库后都是可用状态），不算要清空的内容。 */}
                        {props.prompt.trim() || props.attachments.length || props.references.some((reference) => reference.active && reference.kind !== "skill") ? (
                            <Tooltip title="清空提示词和参考内容">
                                <button type="button" className="creation-chat-control is-clear" onClick={props.onClearComposer} disabled={interactionBusy} aria-label="清空提示词和参考内容">
                                    <Trash2 />
                                    <span>清空</span>
                                </button>
                            </Tooltip>
                        ) : null}
                    </div>
                    <div className="creation-submit-wrap">
                        {showCost ? (
                            <span className="creation-submit-cost" title={costTitle}>
                                <CreditSymbol />
                                <span>{props.mode === "agent" ? `约 ${formattedCredits}` : routeQuote?.estimated ? `预估:${formattedCredits}` : formattedCredits}</span>
                            </span>
                        ) : null}
                        {props.mode === "agent" ? <AgentContextRing view={props.agentContextView} surface="creation" iconOnly /> : null}
                        <VoiceRecordingButton className="creation-voice-trigger" disabled={interactionBusy} onTranscribed={(text) => props.setPrompt(props.prompt.trim() ? `${props.prompt} ${text}` : text)} />
                        {canStop ? (
                            <Button type="text" className="creation-submit is-icon-only" disabled={stopping || props.busy} onClick={props.onStop} aria-label={stopping ? "正在停止" : "停止生成"} title={stopping ? "正在停止" : "停止生成"}>
                                <span className="creation-submit-action" aria-hidden>
                                    {stopping ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-4" fill="currentColor" />}
                                </span>
                            </Button>
                        ) : null}
                        <Button
                            type="text"
                            className="creation-submit is-icon-only"
                            disabled={stopping || interactionBusy || !canSubmit}
                            style={
                                {
                                    position: "relative",
                                    color: "var(--user-ink)",
                                } as CSSProperties
                            }
                            onClick={props.onSubmit}
                            aria-label={actionLabel}
                            title={!canStop && !stopping && !canSubmit && !interactionBusy ? "输入创作想法后即可生成" : actionLabel}
                        >
                            <span className="creation-submit-action" aria-hidden>
                                {showWorkingSpinner ? <LoaderCircle className="size-4 animate-spin" /> : <CreationIcon name="send" size={18} />}
                            </span>
                        </Button>
                    </div>
                </footer>
                <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
            </div>
        </div>
    );

    if (!promptOptimizerOpen) return composer;

    return (
        <Suspense fallback={composer}>
            <CanvasPromptOptimizerDrawer
                open={promptOptimizerOpen}
                prompt={props.prompt}
                generationMode={props.mode === "video" ? "video" : "image"}
                targetModel={modelOptionName(props.model) || props.model}
                targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(props.model))?.protocol || priceChannel.interfaceType}
                config={props.config}
                optimizerModel={props.config.textModel}
                references={optimizerReferences}
                provider={props.promptOptimizerProvider}
                onClose={() => setPromptOptimizerOpen(false)}
                onApply={props.setPrompt}
            >
                {composer}
            </CanvasPromptOptimizerDrawer>
        </Suspense>
    );
}

function AgentExecutionSettings(props: ComposerProps) {
    const [open, setOpen] = useState(false);
    const syncStatus = useCreationPreferencesStore((state) => state.syncStatus);
    const boundedNumber = (value: string, fallback: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
    const concise = props.agentOutputPreference === "concise";
    // 本机与账号的保存状态要分开说：只有同步完成才说"已保存到账号"。
    const syncText =
        syncStatus === "synced" ? "已保存到账号，换设备也能用" : syncStatus === "error" ? "已保存在本机，同步到账号失败，联网后会自动重试" : syncStatus === "saving" || syncStatus === "loading" ? "正在同步到账号…" : "已保存在本机";
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={
                <div className="creation-agent-settings-menu creation-scrollbar" role="group" aria-label="创作偏好">
                    <header className="creation-pref-header">
                        <strong>创作偏好</strong>
                        <span>改动从下一次发送开始生效</span>
                    </header>
                    <section className="creation-pref-group" aria-label="回复">
                        <div className="creation-pref-row">
                            <div className="creation-pref-copy">
                                <strong>回复风格</strong>
                                <span>{concise ? "先看图和要点，详细说明可以展开看" : "完整写出思路、重点和每张图的方案"}</span>
                            </div>
                            <div className="creation-pref-segmented" role="group" aria-label="回复风格">
                                <button type="button" aria-pressed={concise} onClick={() => props.onAgentOutputPreferenceChange("concise")}>
                                    简洁
                                </button>
                                <button type="button" aria-pressed={!concise} onClick={() => props.onAgentOutputPreferenceChange("detailed")}>
                                    详细
                                </button>
                            </div>
                        </div>
                        <div className="creation-pref-row">
                            <div className="creation-pref-copy">
                                <strong id="creation-pref-thinking">深度思考</strong>
                                <span>先想清楚再动手，复杂需求更稳，回复会慢一点</span>
                            </div>
                            <Switch size="sm" checked={props.agentReasoningMode !== "off"} onChange={(checked) => props.onAgentReasoningModeChange(checked ? "auto" : "off")} aria-labelledby="creation-pref-thinking" />
                        </div>
                        {props.agentWebSearchAvailable ? (
                            <div className="creation-pref-row">
                                <div className="creation-pref-copy">
                                    <strong id="creation-pref-web-search">联网搜索</strong>
                                    <span>查热点和最新资料时自动上网，并附上来源；关掉后仍能读取你发的链接</span>
                                    {props.agentWebSearchPriceMicrocredits ? <span>每次搜索 {formatCredits(props.agentWebSearchPriceMicrocredits)} 积分，没搜到结果不扣；读取网页不扣积分</span> : null}
                                </div>
                                <Switch size="sm" checked={props.agentWebSearch !== "off"} onChange={(checked) => props.onAgentWebSearchChange(checked ? "auto" : "off")} aria-labelledby="creation-pref-web-search" />
                            </div>
                        ) : null}
                    </section>
                    <section className="creation-pref-group">
                        <h3>默认模型</h3>
                        <div className="creation-pref-model">
                            <span>图片</span>
                            <ModelPicker
                                config={props.config}
                                value={props.agentImageModel}
                                onChange={props.onAgentImageModelChange}
                                capability="image"
                                className="creation-model-picker"
                                placeholder="选择默认图片模型"
                                fullWidth
                                showSelectedPrice={false}
                                showOptionPrices
                                variant="creation"
                            />
                        </div>
                        <div className="creation-pref-model">
                            <span>视频</span>
                            <ModelPicker
                                config={props.config}
                                value={props.agentVideoModel}
                                onChange={props.onAgentVideoModelChange}
                                capability="video"
                                className="creation-model-picker"
                                placeholder="选择默认视频模型"
                                fullWidth
                                showSelectedPrice={false}
                                showOptionPrices
                                variant="creation"
                            />
                        </div>
                    </section>
                    <details className="creation-agent-advanced-preferences">
                        <summary>
                            更多设置
                            <span>换用模型、花费上限、图片和视频规格</span>
                        </summary>
                        <div>
                            <section className="creation-pref-group">
                                <h3>模型做不了时</h3>
                                {(["image", "video"] as const).map((kind) => {
                                    const image = kind === "image";
                                    const value = image ? props.agentImageSelectionMode : props.agentVideoSelectionMode;
                                    const change = image ? props.onAgentImageSelectionModeChange : props.onAgentVideoSelectionModeChange;
                                    const id = `creation-pref-${kind}-fallback`;
                                    return (
                                        <div key={kind} className="creation-pref-row">
                                            <div className="creation-pref-copy">
                                                <strong id={id}>{image ? "图片" : "视频"}自动换用其他模型</strong>
                                            </div>
                                            <Switch size="sm" checked={value === "preferred"} onChange={(checked) => change(checked ? "preferred" : "fixed")} aria-labelledby={id} />
                                        </div>
                                    );
                                })}
                                <p className="creation-pref-hint">只在所选模型做不了（不支持当前素材或尺寸）、还没开始生成时换用；花费不超过你已确认的额度。关掉则只用所选模型。</p>
                            </section>
                            <section className="creation-pref-group">
                                <h3>单次花费上限</h3>
                                <label className="creation-pref-field">
                                    <span>最多花费</span>
                                    <input type="number" min="0" value={props.agentMaxCredits} onChange={(event) => props.onAgentBudgetChange("maxCredits", boundedNumber(event.target.value, 200, 100000))} />
                                    <em>积分</em>
                                </label>
                                <label className="creation-pref-field">
                                    <span>最多生成</span>
                                    <input type="number" min="0" value={props.agentMaxGenerationTasks} onChange={(event) => props.onAgentBudgetChange("maxGenerationTasks", boundedNumber(event.target.value, 0, 100))} />
                                    <em>项</em>
                                </label>
                                <label className="creation-pref-field">
                                    <span>视频总时长</span>
                                    <input type="number" min="0" value={props.agentMaxVideoSeconds} onChange={(event) => props.onAgentBudgetChange("maxVideoSeconds", boundedNumber(event.target.value, 30, 3600))} />
                                    <em>秒</em>
                                </label>
                                <p className="creation-pref-hint">每次发送最多用这么多；「最多生成」和「视频总时长」填 0 表示不限。</p>
                            </section>
                            {(["image", "video"] as const).map((kind) => {
                                const image = kind === "image";
                                const manual = (image ? props.agentImageParameterMode : props.agentVideoParameterMode) === "manual";
                                const change = image ? props.onAgentImageParameterModeChange : props.onAgentVideoParameterModeChange;
                                const label = image ? "图片规格" : "视频规格";
                                return (
                                    <section key={kind} className="creation-pref-group">
                                        <div className="creation-pref-row">
                                            <div className="creation-pref-copy">
                                                <strong>{label}</strong>
                                                <span>{manual ? "按下面填的规格生成" : image ? "由阿Q 按需求决定比例、画质和张数" : "由阿Q 按需求决定画幅、清晰度和时长"}</span>
                                            </div>
                                            <div className="creation-pref-segmented" role="group" aria-label={label}>
                                                <button type="button" aria-pressed={!manual} onClick={() => change("auto")}>
                                                    自动
                                                </button>
                                                <button type="button" aria-pressed={manual} onClick={() => change("manual")}>
                                                    自定义
                                                </button>
                                            </div>
                                        </div>
                                        {manual && image ? (
                                            <>
                                                <label className="creation-pref-field">
                                                    <span>比例或尺寸</span>
                                                    <input value={props.agentImageSize} placeholder="如 16:9" onChange={(event) => props.onAgentImageSettingChange("size", event.target.value)} />
                                                </label>
                                                <label className="creation-pref-field">
                                                    <span>画质</span>
                                                    <input value={props.agentImageQuality} placeholder="auto" onChange={(event) => props.onAgentImageSettingChange("quality", event.target.value)} />
                                                </label>
                                                <label className="creation-pref-field">
                                                    <span>张数</span>
                                                    <input type="number" min="1" value={props.agentImageCount} onChange={(event) => props.onAgentImageSettingChange("count", Math.max(1, Number(event.target.value) || 1))} />
                                                    <em>张</em>
                                                </label>
                                            </>
                                        ) : null}
                                        {manual && !image ? (
                                            <>
                                                <label className="creation-pref-field">
                                                    <span>画幅</span>
                                                    <input value={props.agentVideoSize} placeholder="如 16:9" onChange={(event) => props.onAgentVideoSettingChange("size", event.target.value)} />
                                                </label>
                                                <label className="creation-pref-field">
                                                    <span>清晰度</span>
                                                    <input value={props.agentVideoQuality} placeholder="如 720" onChange={(event) => props.onAgentVideoSettingChange("quality", event.target.value)} />
                                                </label>
                                                <label className="creation-pref-field">
                                                    <span>时长</span>
                                                    <input type="number" min="1" value={props.agentVideoSeconds} onChange={(event) => props.onAgentVideoSettingChange("durationSeconds", Math.max(1, Number(event.target.value) || 1))} />
                                                    <em>秒</em>
                                                </label>
                                            </>
                                        ) : null}
                                    </section>
                                );
                            })}
                        </div>
                    </details>
                    <p className="creation-pref-sync" role="status">
                        {syncText}
                    </p>
                </div>
            }
        >
            <button type="button" className="creation-chat-control creation-agent-preferences-trigger" aria-label="Agent 创作偏好" aria-expanded={open}>
                <SlidersHorizontal />
                <span>偏好</span>
            </button>
        </Popover>
    );
}

function GenerationSettingsMenu(props: ComposerProps) {
    const [open, setOpen] = useState(false);
    const activeQualityOptions = props.imageProfile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: imageQualityLabel(value), description: "模型支持的质量/分辨率" });
    const qualityLabel = activeQualityOptions.find((item) => item.value === props.quality)?.label || qualityOptions.find((item) => item.value === props.quality)?.label || props.quality || "自动";
    // 尺寸/比例/分辨率选项取同显示名分组内全部模型的并集，路由模型只决定发送参数。
    const mergedProfile = mergedImageCapabilityConfig(props.config, props.model || props.config.imageModel);
    const usesImageResolutionPicker = props.mode === "image" && supportsImageResolutionPresets(mergedProfile.size);
    const imageResolutionOptions = usesImageResolutionPicker ? buildImageResolutionOptions(mergedProfile.size.values) : [];
    const ratios = props.videoProfile.ratios;
    const referenceImageSize = props.mode === "image" && mergedProfile.size.allowCustom ? props.referenceImageSize : undefined;
    const referenceImageSizeValue = referenceImageSize ? String(referenceImageSize.width) + "x" + String(referenceImageSize.height) : "";
    const referenceImageSizeLabel = referenceImageSize ? String(referenceImageSize.width) + " × " + String(referenceImageSize.height) : "";
    const referenceImageSizeSelected = Boolean(referenceImageSizeValue && props.ratio === referenceImageSizeValue);
    const resolutions = props.mode === "video" ? props.videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: videoResolutionLabel(value) })) : resolutionOptions;
    const selectReferenceImageSize = () => {
        if (!referenceImageSizeValue) return;
        props.setRatio(referenceImageSizeValue);
    };
    const videoResolutionSupported = props.mode === "video" && resolutions.length > 0;
    const imageSummary = [
        ...(mergedProfile.size.parameter !== "none" ? [referenceImageSizeSelected ? referenceImageSizeLabel : usesImageResolutionPicker ? formatImageResolutionSize(props.ratio, imageResolutionOptions) : props.ratio] : []),
        ...(props.imageProfile.quality.supported && props.imageProfile.parameters?.find((field) => field.name === "quality")?.userVisible !== false ? [qualityLabel] : []),
        ...(props.imageProfile.maxOutputs > 1 ? [props.count] : []),
    ].join(" · ");
    const videoRatioSupported = props.mode === "video" && ratios.length > 0;
    const summary = props.mode === "video" ? [...(videoRatioSupported ? [props.ratio] : []), ...(videoResolutionSupported ? [videoResolutionLabel(props.videoQuality)] : [])].join(" · ") : imageSummary;
    const panel =
        props.mode === "image" && props.imageProfile.parameters ? (
            <div className="creation-parameter-menu max-h-[65vh] overflow-y-auto">
                <ImageParameterFields
                    profile={props.imageProfile}
                    config={{ ...props.config, model: props.model, size: props.ratio, quality: props.quality, imageResolution: props.imageResolution, imageParameters: props.imageParameters, count: props.count }}
                    onChange={(key, value) => {
                        const setters = {
                            size: props.setRatio,
                            quality: props.setQuality,
                            imageResolution: props.setImageResolution,
                            imageParameters: props.setImageParameters,
                            count: props.setCount,
                            transparentBackground: props.setTransparentBackground,
                        };
                        setters[key](value);
                    }}
                />
            </div>
        ) : (
            <div className="creation-parameter-menu">
                {props.mode === "image" ? (
                    <ImageSizePicker
                        profile={mergedProfile}
                        size={props.ratio}
                        quality={props.quality}
                        imageResolution={props.imageResolution}
                        onChange={(size, quality, resolution) => {
                            props.setRatio(size);
                            if (quality) props.setQuality(quality);
                            if (resolution) props.setImageResolution(resolution);
                        }}
                    />
                ) : videoRatioSupported ? (
                    <SettingSection title="画幅" value={props.ratio}>
                        <div className="creation-choice-grid is-ratio">
                            {ratios.map((value) => (
                                <button key={value} type="button" aria-pressed={value === props.ratio} className={value === props.ratio ? "is-selected" : ""} onClick={() => props.setRatio(value)}>
                                    <span className="creation-ratio-preview">
                                        <span style={ratioPreviewStyle(value)} />
                                    </span>
                                    <span>{value}</span>
                                </button>
                            ))}
                        </div>
                    </SettingSection>
                ) : null}
                {props.mode === "image" && referenceImageSizeValue ? (
                    <button type="button" className="creation-custom-trigger" onClick={selectReferenceImageSize}>
                        使用参考图尺寸 · {referenceImageSizeLabel}
                    </button>
                ) : null}
                {props.mode === "video" ? (
                    videoResolutionSupported ? (
                        <SettingSection title="清晰度" value={videoResolutionLabel(props.videoQuality)}>
                            <div className="creation-choice-grid is-resolution">
                                {resolutions.map((option) => (
                                    <button key={option.value} type="button" aria-pressed={option.value === props.videoQuality} className={option.value === props.videoQuality ? "is-selected" : ""} onClick={() => props.setVideoQuality(option.value)}>
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </SettingSection>
                    ) : null
                ) : (
                    <>
                        {props.imageProfile.quality.supported && !imageResolutionUsesQuality(mergedProfile) ? (
                            <SettingSection title={activeQualityOptions.some((item) => item.value === "1k" || item.value === "2k") ? "分辨率" : "图片质量"} value={qualityLabel}>
                                <div className="creation-choice-grid is-quality">
                                    {activeQualityOptions.map((option) => (
                                        <button key={option.value} type="button" aria-pressed={option.value === props.quality} className={option.value === props.quality ? "is-selected" : ""} onClick={() => props.setQuality(option.value)}>
                                            <span>{option.label}</span>
                                            <small>{option.description}</small>
                                        </button>
                                    ))}
                                </div>
                            </SettingSection>
                        ) : null}
                        {props.imageProfile.maxOutputs > 1 ? (
                            <SettingSection title="生成数量" value={`${props.count} 张`}>
                                <div className="creation-parameter-content">
                                    <div className="creation-choice-grid is-count">
                                        {countOptions
                                            .filter((option) => Number(option) <= props.imageProfile.maxOutputs)
                                            .map((option) => (
                                                <button key={option} type="button" aria-pressed={option === props.count} className={option === props.count ? "is-selected" : ""} onClick={() => props.setCount(option)}>
                                                    {option}
                                                </button>
                                            ))}
                                    </div>
                                    <label className="creation-custom-value">
                                        <span>自定义</span>
                                        <input
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={props.count}
                                            onChange={(event) => props.setCount(String(Math.max(1, Math.min(props.imageProfile.maxOutputs, Number(event.target.value) || 1))))}
                                            aria-label={`生成数量，范围 1 到 ${props.imageProfile.maxOutputs}`}
                                        />
                                        <em>张</em>
                                    </label>
                                </div>
                            </SettingSection>
                        ) : null}
                    </>
                )}
            </div>
        );
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={panel}
        >
            <button type="button" className="creation-chat-control" aria-label={`生成设置：${summary}`}>
                <SlidersHorizontal />
                <span>{summary}</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

function AudioSettingsMenu({ config, onChange }: { config: AiConfig; onChange: (key: CanvasAudioSettingKey, value: string) => void }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useActiveTheme()];
    const music = isMusicAudioConfig(config);
    const summary = music ? (musicInstrumentalForConfig(config) ? "纯音乐" : "歌曲") : [audioVoiceLabelForConfig(config, config.audioVoice) || "默认音色", audioFormatLabelForConfig(config, config.audioFormat)].filter(Boolean).join(" · ");
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={
                <div className="creation-parameter-menu creation-audio-settings max-h-[65vh] overflow-y-auto">
                    <Suspense fallback={<LoaderCircle className="animate-spin" aria-label="正在加载音频设置" />}>
                        <AudioSettingsPanel config={config} onConfigChange={onChange} theme={theme} showTitle={false} className="space-y-4" />
                    </Suspense>
                </div>
            }
        >
            <button type="button" className="creation-chat-control" aria-label={`${music ? "音乐设置" : "音频设置"}：${summary}`}>
                <SlidersHorizontal />
                <span>{summary}</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

function SettingSection({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
    return (
        <section className="creation-parameter-section">
            <header>
                <h3>{title}</h3>
                {value ? <span>{value}</span> : null}
            </header>
            {children}
        </section>
    );
}

function DurationMenu({ profile, seconds, resolution, onChange }: { profile: VideoCapabilityConfig; seconds: string; resolution: string; onChange: (value: string) => void }) {
    const [open, setOpen] = useState(false);
    const duration = videoDurationConfigForResolution(profile, resolution);
    const value = Number(normalizeVideoValue(profile, { seconds, resolution }).seconds);
    const presets = duration.selection === "enum" ? videoDurationOptions(profile, resolution) : [];
    const fallbackPreset = presets.length ? presets : [duration.default];
    const min = duration.selection === "range" ? duration.min || 1 : Math.min(...fallbackPreset);
    const max = duration.selection === "range" ? Math.max(min, duration.max || min) : Math.max(...fallbackPreset);
    const step = Math.max(1, duration.step || 1);
    const durationControl =
        duration.selection === "range" ? (
            <>
                <input className="h-8 w-full" style={{ accentColor: "var(--creation-text)" }} type="range" min={min} max={max} step={step} value={value} aria-label="视频时长（秒）" onChange={(event) => onChange(event.target.value)} />
                <div className="flex justify-between px-0.5 text-[var(--fs-tiny)] text-[var(--creation-muted)]">
                    <span>{min}s</span>
                    <span>{max}s</span>
                </div>
                <label className="creation-custom-value is-duration">
                    <span>自定义时长</span>
                    <span className="creation-duration-custom-field">
                        <input
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            inputMode="numeric"
                            value={seconds}
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={() => onChange(String(value))}
                            onChange={(event) => onChange(event.target.value)}
                            aria-label="自定义视频时长，单位秒"
                        />
                        <em>秒</em>
                    </span>
                </label>
            </>
        ) : (
            <div className="creation-duration-choices">
                {presets.map((item) => (
                    <button key={item} type="button" className={item === value ? "is-selected" : ""} onClick={() => onChange(String(item))}>
                        {item}s
                    </button>
                ))}
            </div>
        );
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottom"
            arrow={false}
            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
            content={
                <div className="creation-duration-menu">
                    <div className="creation-duration-heading">
                        <span>时长</span>
                        <strong>{value} 秒</strong>
                    </div>
                    {durationControl}
                </div>
            }
        >
            <button type="button" className="creation-chat-control is-duration" aria-label={`视频时长：${value}秒`}>
                <Clock3 />
                <span>{value}s</span>
                <ChevronDown className={open ? "is-open" : ""} />
            </button>
        </Popover>
    );
}

function ratioPreviewStyle(value: string) {
    const [width, height] = value.replace("x", ":").split(":").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 10, height: 10 };
    // 画幅容器的可用空间是 14×10；同时计算宽高，避免 CSS 的 max-width/max-height 把宽银幕比例压扁。
    const scale = Math.min(14 / width, 10 / height);
    return { width: Math.max(4, Math.round(width * scale)), height: Math.max(4, Math.round(height * scale)) };
}
