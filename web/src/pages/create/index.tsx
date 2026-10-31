import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Spin } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { ArrowDown, History, Maximize2, PenLine } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useCreationHomeNavigation } from "./use-creation-home-navigation";
import { useCreationConversationRoute } from "./use-creation-conversation-route";
import { createCreationHistoryWriter, creationConversationPath, creationHistoryInput, restoreCreationConversation } from "./creation-conversation-history";

import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CreationTypeIcon } from "@/components/creation/creation-type-icon";
import { generationErrorMessage } from "@/lib/generation-error";
import { isGenerationTaskCapacityError } from "@/lib/canvas/canvas-generation-batch";
import { creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { getActiveUserScope } from "@/lib/user-scope";
import { createClientId } from "@/lib/client-id";
import { continueCreationConversationOnCanvas } from "@/services/creation-canvas-conversation";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { useIdleReady } from "@/hooks/use-idle-ready";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { imageParameterRequest, normalizeImageParameters } from "@/lib/image-parameters";
import { inferVideoOperation, modelGroupReferenceLimits, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { ApiError } from "@/services/api/request";
import { createAgentMemory, listAgentMemories, updateAgentMemory } from "@/services/api/agent-memories";
import {
    clearPendingCreationAgentSubmission,
    flushCreationConversationsSave,
    loadCreationConversations,
    loadPendingCreationAgentSubmission,
    pendingCreationTaskIds,
    queueCreationConversationsSave,
    removeCreationConversationSnapshot,
    removeStoredCreationConversation,
    savePendingCreationAgentSubmission,
    updateCreationConversationSnapshot,
} from "@/services/creation-conversation-store";
import { resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { audioModelsOfKind, isMusicAudioModel, type AudioGenerationKind } from "@/lib/audio-generation";
import {
    createAgentRun,
    decideAgentApproval,
    deleteAgentSession,
    getAgentRun,
    getAgentSession,
    isAgentAdmissionRejection,
    listAgentSessions,
    sendAgentInterjection,
    sendAgentMessage,
    subscribeAgentEvents,
    updateAgentApprovalItems,
    type AgentApprovalItemEdit,
    type CreateAgentRunInput,
} from "@/services/api/agent";
import { subscribeGenerationTasks } from "@/services/api/task-center";
import { creationConfigWithPreferences, useCreationAgentPreferences, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { loadAssetsForUse, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { resolveCreationCopy } from "@/lib/creation-copy";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider, SmartCreationAgentPlan, SmartCreationAgentProvider, SmartCreationTaskSettings } from "@/lib/plugins/plugin-types";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { resolveSmartCreationExecution } from "@/lib/plugins/smart-creation-agent";
import { resolveSmartCreationPlugin, type SmartCreationRemotePolicy } from "@/lib/plugins/smart-creation-policy";
import { fetchSmartCreationPlugins } from "@/services/api/plugins";
import type { HomepageCreationGenerationRequest } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import {
    buildCreationMentionReferences,
    expandCreationPrompt,
    reconcileCreationAttachmentLimit,
    reconcileCreationAttachmentLimits,
    removeCreationReferenceTokens,
    replaceCreationAttachmentReference,
    selectedCreationReferences,
    type CreationReference,
    type CreationReferenceLimits,
} from "./creation-references";
import {
    creationAttachmentFromAsset,
    creationAttachmentFromAudio,
    creationAttachmentFromAudioAsset,
    creationAttachmentFromDocument,
    creationAttachmentFromExternalAsset,
    creationAttachmentFromImage,
    creationAttachmentFromVideo,
    creationAttachmentFromVideoAsset,
    creationAttachmentKind,
    creationAudioAsset,
    creationFileAccepted,
    creationImageAsset,
    creationMediaAspectRatio,
    creationUploadAccept,
    creationVideoAsset,
    removeCreationAttachment,
    splitCreationAttachments,
    type CreationAttachment,
} from "./creation-assets";
import {
    creationHasInput,
    creationModelCapability,
    defaultCreationMode,
    modeLabels,
    creationModelKey,
    type CreationConversation,
    type CreationHistoryEntry,
    type CreationMessage,
    type CreationMode,
    type CreationRetryContext,
    type CreationSettings,
    type CreationShotRailEntry,
    type CreationStatus,
} from "./creation-types";
import {
    applyRecoveredCreationResult,
    attachCreationTaskContexts,
    bindCreationSubmissionTask,
    completedCreationGenerationTask,
    consumeCreationImageResults,
    conversationTimestamp,
    creationConversationMode,
    creationMessageNeedsResultSync,
    creationShotRail,
    creationVideoShotOrdinal,
    isImageAttachment,
    isVideoAttachment,
    materializeCreationTaskResults,
    mergeCreationTaskObservations,
    newConversation,
    newMessage,
    projectCreationTaskWaitFailure,
    reconcileCreationTaskMessages,
    recoverCreationGenerationSubmission,
    refreshCreationMessageTasks,
    selectCreationConversationMode,
    type PersistedCreationTask,
} from "./creation-conversations";
import { CreationComposer, CreationHistoryDrawer, CreationPlayStrip, CreationWorkspaceToolbar, creationAssetCategoryLabels } from "./creation-workspace";
import { CreationThreadRow, creationThreadRows, type CreationThreadActions } from "./creation-thread-row";
import { CreationAmbientBackdrop, CreationGridBackdrop, latestCreationResultImage } from "./creation-backdrops";
import { creationAgentPreauthorizedCredits, useCreationAgentEstimate } from "./creation-agent-estimate";
import { CreationSurfaceSwitch, type CreationSurface } from "./creation-workspace-empty";
import { creationHistoryFingerprint, forgetSyncedCreationHistory, rememberSyncedCreationHistory, syncedCreationHistoryFingerprint } from "./creation-history-sync-cache";
import type { CreationResultImageHandler, CreationResultImageRef } from "./creation-workspace-messages";
import { creationImageRedoRequirements, creationImageRedoSource, type CreationImageRedoRequest } from "./creation-image-redo";
import type { CreationImageSettingsPatch, CreationPixelSize } from "./creation-image-tools";
import { isCreationImageToolIntent } from "./creation-image-tool-catalog";
import type { CreationImageDescribePurpose, CreationImageRedoTarget, CreationImageToolRequest, CreationImageToolTarget } from "./creation-image-tool-dialog";
import type { ReferenceImage } from "@/types/image";
import { resolveResourceUrl } from "@/services/api/resources";
import { declaredInspirationSources } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { openLoginModal } from "@/stores/use-login-modal-store";
import { expandSmartCreationPlan, projectSmartCreationBatch, runSmartCreationSchedule } from "./smart-creation-runtime";
import { createCreationSubmitGate, createCreationSubmitGateRelease, withCreationSubmitGate } from "./creation-submit-gate";
import { creationVideoConfig } from "./creation-generation-config";
import { buildCreationAgentRunInput, creationAgentAttachmentSelection, creationAgentImageInputError, creationAgentImageReferenceLimit, creationAgentSkills, creationManagedModelSelection } from "./creation-agent-request";
import type { CreationSkillsStatus } from "./creation-skill-picker";
import {
    appendCreationAgentEvent,
    applyCreationAgentTaskState,
    assertCreationAgentSession,
    beginCreationAgentSubmission,
    bindCreationAgentSubmission,
    creationAgentConversationTitle,
    creationAgentHistoryGapKey,
    creationAgentRecoveryClient,
    creationAgentRetryRun,
    failCreationAgentSubmission,
    mergeCreationAgentConversation,
    mergeCreationConversationHistory,
    projectCreationAgentConversation,
    recoverCreationAgentHistory,
    restoreCreationAgentConversation,
    retryCreationHistoryRead,
    settleCreationAgentSubmission,
} from "./creation-agent-conversation";
import { creationAgentRunsToStop, stopCreationAgentRuns } from "./creation-agent-cancel";
import { creationLibraryDisabledReason, creationLibrarySelectionToAttachments } from "./creation-library";
import type { CreationAgentProposalOptions } from "./creation-agent-proposals";
import { emptyAgentContextUsage, presentAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import type { AgentPermissionMode } from "@/services/api/agent";
import { creationAgentInterjectionRun, pendingCreationAgentInterjection, submitCreationAgentInterjection, upsertCreationAgentInterjection } from "./creation-agent-interjection";
import { CreationAgentPlanPanel, creationAgentPlanSource } from "./creation-agent-plan-panel";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));
// 结果图工具弹窗（高清、扩图、局部重绘、消除、变体、宫格……）只在用到时加载。
const CreationImageToolDialog = lazy(() => import("./creation-image-tool-dialog").then((module) => ({ default: module.CreationImageToolDialog })));
const CreationImageRedoDialog = lazy(() => import("./creation-image-tool-dialog").then((module) => ({ default: module.CreationImageRedoDialog })));
const InspirationHall = lazy(() => import("@/pages/inspirations"));
// 「画布」面的两块都只在切到画布时加载：新建画布 + 最近画布，以及和首页同一个组件的精选画布。
const CreationCanvasStart = lazy(() => import("./creation-canvas-start").then((module) => ({ default: module.CreationCanvasStart })));
const CreationFeaturedCanvases = lazy(() => import("@/pages/home/home-featured-canvases").then((module) => ({ default: module.HomeFeaturedCanvases })));
const loadCreationRuntime = () => import("./creation-runtime");
type CreationRuntime = Awaited<ReturnType<typeof loadCreationRuntime>>;

const TEXT_STREAMING_PREF_KEY = "creation.composer.text-streaming";
const TEXT_THINKING_PREF_KEY = "creation.composer.text-thinking";

function readComposerPref(key: string, fallback: boolean): boolean {
    try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? fallback : stored === "1";
    } catch {
        return fallback;
    }
}
function writeComposerPref(key: string, value: boolean) {
    try {
        window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
        // 存储不可用（隐私模式/禁用）：仅当前会话生效，忽略
    }
}

function smartPlanContext(plan: SmartCreationAgentPlan, brand: string) {
    const tasks = plan.tasks.map((task) => {
        const settings = task.settings;
        return `- ${task.title}（${task.purpose}）：${task.prompt}；画幅 ${settings.aspectRatio}；质量 ${settings.quality}；数量 ${settings.count}`;
    });
    return [
        `【${brand} 已确认的创作计划】`,
        `目标：${plan.intent}`,
        `平台：${plan.targetPlatform}${plan.targetMarket !== "UNKNOWN" ? ` / ${plan.targetMarket}` : ""}；语言：${plan.targetLanguage}`,
        ...(plan.visualDirection ? [`整套视觉指导：${plan.visualDirection}`] : []),
        ...(plan.styleBible ? [`统一风格锁：${plan.styleBible.globalPrompt}`] : []),
        ...tasks,
        "后续消息默认沿用此计划，只有用户明确修改时才调整；不要重复询问已经确定的内容。",
    ].join("\n");
}

function smartPlanSummary(plan: SmartCreationAgentPlan) {
    const target = plan.targetPlatform === "amazon" ? `Amazon ${plan.targetMarket} / ${plan.targetLanguage}` : "通用图片创作";
    const tasks = plan.tasks.map((task) => `${task.title}（${task.settings.count} 张）`).join("、");
    return `我已根据提示词和参考图完成规划：${target}；${tasks}。后续默认沿用这套方案，除非你明确要求修改。`;
}

function smartCreationMemoryRequest(plan: SmartCreationAgentPlan, conversationId: string, owner: { brand: string; pluginId: string }) {
    const target = plan.targetPlatform === "amazon" ? `Amazon ${plan.targetMarket} / ${plan.targetLanguage}` : "通用图片创作";
    return {
        topic: `${owner.pluginId}:smart-creation:${conversationId}`,
        category: "smart_creation",
        situation: `创作 Composer 对话中的智能创作方案（${target}）`,
        lesson: smartPlanContext(plan, owner.brand),
        steps: plan.tasks.map((task) => ({
            tool: owner.brand,
            action: `${task.title}：${task.prompt}`,
            note: `${task.settings.aspectRatio} / ${task.settings.quality} / ${task.settings.count} 张`,
        })),
        source: owner.pluginId,
    };
}

async function persistSmartCreationMemory(plan: SmartCreationAgentPlan, conversationId: string, owner: { brand: string; pluginId: string }) {
    const request = smartCreationMemoryRequest(plan, conversationId, owner);
    try {
        const existing = await listAgentMemories("approved", 200);
        const current = existing.memories.find((memory) => memory.category === request.category && memory.topic === request.topic);
        if (current) {
            await updateAgentMemory(current.id, request);
        } else {
            await createAgentMemory(request);
        }
    } catch (error) {
        // 记忆写入不应阻塞当前图片生成；当前会话仍会把计划保存在本地对话消息中。
        console.warn("智能创作计划未能同步到 Agent 记忆", error);
    }
}

function inheritedSmartCreationReferences(messages: CreationMessage[]) {
    const latest = [...messages].reverse().find((message) => message.attachments?.some(isImageAttachment));
    return (latest?.attachments || []).filter(isImageAttachment).map((attachment) => ({
        title: attachment.name || "历史参考图",
        url: attachment.previewUrl || attachment.url,
        dataUrl: attachment.dataUrl,
        storageKey: attachment.storageKey,
        kind: "image",
        mimeType: attachment.type,
    }));
}

function inheritedSmartCreationAttachments(messages: CreationMessage[]) {
    const latest = [...messages].reverse().find((message) => message.attachments?.some(isImageAttachment));
    return latest?.attachments?.filter(isImageAttachment) || [];
}

export default function CreatePage() {
    const [smartCreationActive, setSmartCreationActive] = useState(false);
    const [smartCreationPlanning, setSmartCreationPlanning] = useState(false);
    const { message: toast, modal } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const [openingCanvas, setOpeningCanvas] = useState(false);
    // 标题下方的"生成 | 画布"；只在空态出现，不记到偏好里。选择写在地址栏 ?mode=canvas（参考 kunrouai.com/?mode=canvas）：
    // 原地切换、压一条历史，刷新、后退和从画布返回都停在同一面；其他取值都按「生成」处理。
    const [searchParams, setSearchParams] = useSearchParams();
    const creationSurface: CreationSurface = searchParams.get("mode") === "canvas" ? "canvas" : "generate";
    const selectCreationSurface = (next: CreationSurface) => {
        if (next === creationSurface) return;
        setSearchParams((current) => {
            const params = new URLSearchParams(current);
            if (next === "canvas") params.set("mode", "canvas");
            else params.delete("mode");
            return params;
        });
    };
    const openingCanvasRef = useRef(false);
    const appearance = useAppearanceStore((state) => state.appearance);
    const brandName = appearance.brandName;
    // 标题和副标题按当前这一面取，两面都在后台「外观设置 → 创作首页」配置。
    const creationCopy =
        creationSurface === "canvas"
            ? resolveCreationCopy(appearance.brandName, appearance.creationCanvasTitle, appearance.creationCanvasDescription, "canvas")
            : resolveCreationCopy(appearance.brandName, appearance.creationTitle, appearance.creationDescription);
    const sharedConfig = useEffectiveConfig();
    const creationModels = useCreationPreferencesStore((state) => state.preferences.models);
    const creationImagePreferences = useCreationPreferencesStore((state) => state.preferences.image);
    const config = useMemo(() => creationConfigWithPreferences(sharedConfig, { models: creationModels, image: creationImagePreferences }), [sharedConfig, creationModels, creationImagePreferences]);
    const composerPreferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberMode = useCreationPreferencesStore((state) => state.rememberMode);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const rememberActiveConversation = useCreationPreferencesStore((state) => state.rememberActiveConversation);
    const agentOutputPreference = useCreationPreferencesStore((state) => state.preferences.outputPreference || "concise");
    const rememberOutputPreference = useCreationPreferencesStore((state) => state.rememberOutputPreference);
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const promptOptimizerProvider = useMemo<PromptOptimizerProvider | null>(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, config));
    }, [config, promptOptimizerEnabled, promptOptimizerInstallation]);
    const smartCreationPlugins = useMemo(() => listRegisteredPlugins().filter((plugin) => plugin.createSmartCreationAgent && plugin.manifest.contributes.smartCreation), []);
    const smartCreationInstallations = usePluginStore((state) => state.installations);
    const smartCreationPluginStates = usePluginStore((state) => state.pluginStates);
    const smartCreationUserId = useUserStore((state) => state.user?.id);
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);
    const activeTaskLimit = useUserStore((state) => state.runtimeLimits.activeTaskLimit);
    // 插件包里的最新策略由后端下发；插件更新后创作页刷新即可生效，无需改宿主代码。
    const [smartCreationRemotePolicies, setSmartCreationRemotePolicies] = useState<SmartCreationRemotePolicy[] | undefined>(undefined);
    useEffect(() => {
        if (!smartCreationUserId || !smartCreationPlugins.length) return;
        const controller = new AbortController();
        fetchSmartCreationPlugins({ signal: controller.signal })
            .then((policies) => setSmartCreationRemotePolicies(policies))
            // 请求失败时保留本地内置声明，智能创作入口仍可使用。
            .catch(() => undefined);
        return () => controller.abort();
    }, [smartCreationPluginStates, smartCreationUserId, smartCreationPlugins]);
    const smartCreationResolved = useMemo(
        () =>
            resolveSmartCreationPlugin({
                plugins: smartCreationPlugins,
                installations: smartCreationInstallations,
                effectiveEnabled: Object.fromEntries(Object.entries(smartCreationPluginStates).map(([id, state]) => [id, state.effectiveEnabled])),
                remote: smartCreationRemotePolicies,
            }),
        [smartCreationInstallations, smartCreationPluginStates, smartCreationPlugins, smartCreationRemotePolicies],
    );
    const smartCreationProvider = useMemo<SmartCreationAgentProvider | null>(() => {
        if (!smartCreationResolved?.plugin.createSmartCreationAgent) return null;
        const { plugin, installation, manifest } = smartCreationResolved;
        if (!plugin.createSmartCreationAgent) return null;
        return plugin.createSmartCreationAgent(createPluginHostContext({ ...plugin, manifest }, installation, config));
    }, [config, smartCreationResolved]);
    const smartCreationExecution = useMemo(() => resolveSmartCreationExecution(smartCreationResolved?.contribution), [smartCreationResolved]);
    const smartCreationLabel = smartCreationResolved?.contribution.label?.trim() || "智能创作";
    const smartCreationBrand = smartCreationResolved?.manifest.name || "智能创作";
    useEffect(() => {
        if (!smartCreationProvider) setSmartCreationActive(false);
    }, [smartCreationProvider]);
    const updateConfig = useCreationPreferencesStore((state) => state.rememberModel);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [conversations, setConversations] = useState<CreationConversation[]>([]);
    const conversationsRef = useRef<CreationConversation[]>([]);
    const conversationUserRef = useRef(smartCreationUserId);
    const recoveryTaskSnapshotRef = useRef<{ userId: string | undefined; tasks: Map<string, PersistedCreationTask> }>({ userId: smartCreationUserId, tasks: new Map() });
    const conversationSaveChainRef = useRef(Promise.resolve());
    const cloudHistoryWriterRef = useRef(createCreationHistoryWriter());
    const cloudHistoryFingerprintsRef = useRef(new Map<string, string>());
    const [cloudHistoryError, setCloudHistoryError] = useState("");
    const [conversationRetentionDays, setConversationRetentionDays] = useState<number | undefined>(undefined);
    const [activeId, setActiveId] = useState("");
    const activeIdRef = useRef("");
    const [hydrated, setHydrated] = useState(false);
    const [mode, setMode] = useState<CreationMode>(defaultCreationMode);
    const {
        agentPermissionMode,
        setAgentPermissionMode,
        agentReasoningMode,
        setAgentReasoningMode,
        agentWebSearch,
        setAgentWebSearch,
        agentImageSelectionMode,
        setAgentImageSelectionMode,
        agentVideoSelectionMode,
        setAgentVideoSelectionMode,
        agentImageParameterMode,
        setAgentImageParameterMode,
        agentVideoParameterMode,
        setAgentVideoParameterMode,
        agentBudget,
        setAgentBudget,
        agentImageSettings,
        setAgentImageSettings,
        agentVideoSettings,
        setAgentVideoSettings,
    } = useCreationAgentPreferences();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    // Agent 模式发送前显示"约 N 积分"（1 张当前图片模型）；需要确认的模式下点发送即同意 N × 1.2 以内的消耗。
    const agentEstimateCredits = useCreationAgentEstimate(config, config.imageModel, creditsEnabled && mode === "agent" && agentPermissionMode !== "read_only");
    const [agentConnectionError, setAgentConnectionError] = useState("");
    const [agentConnectionEpoch, setAgentConnectionEpoch] = useState(0);
    const [agentTaskSyncFailures, setAgentTaskSyncFailures] = useState<Set<string>>(new Set());
    const [agentTaskRecoveryEpoch, setAgentTaskRecoveryEpoch] = useState(0);
    const [agentApprovalSubmitting, setAgentApprovalSubmitting] = useState(false);
    const [agentApprovalBaseline, setAgentApprovalBaseline] = useState("");
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const promptRef = useRef(prompt);
    const attachmentsRef = useRef(attachments);
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [skillsStatus, setSkillsStatus] = useState<CreationSkillsStatus>("idle");
    const addedSkillsRequestedRef = useRef(false);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [imageResolution, setImageResolution] = useState("auto");
    const [imageParameters, setImageParameters] = useState("{}");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [audioSettings, setAudioSettings] = useState<Partial<Pick<AiConfig, CanvasAudioSettingKey>>>({});
    // 音乐生成、音频生成各自最后用的模型；只在本页记，不写进账号偏好。
    const lastAudioModelsRef = useRef<Partial<Record<AudioGenerationKind, string>>>({});
    const [textStreaming, setTextStreaming] = useState(() => readComposerPref(TEXT_STREAMING_PREF_KEY, true));
    const [textThinking, setTextThinking] = useState(() => readComposerPref(TEXT_THINKING_PREF_KEY, false));
    const webSearchAvailable = useUserStore((state) => state.webSearchEnabled);
    const webSearchPriceMicrocredits = useUserStore((state) => (state.features.creditsEnabled ? state.webSearchPriceMicrocredits : null));
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const [busy, setBusy] = useState(false);
    const [submittingMessageIds, setSubmittingMessageIds] = useState<Set<string>>(() => new Set());
    const [stoppingConversationId, setStoppingConversationId] = useState("");
    const stoppingConversationRef = useRef("");
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [referencePasteBusy, setReferencePasteBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyPending, setHistoryPending] = useState<CreationHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historySyncError, setHistorySyncError] = useState("");
    const [historyRefreshEpoch, setHistoryRefreshEpoch] = useState(0);
    const [historyDeleteOpen, setHistoryDeleteOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const externalAssetSources = useExternalAssetSources(libraryOpen);
    const abortRef = useRef<AbortController | null>(null);
    const unmountedRef = useRef(false);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const launchpadRef = useRef<HTMLElement>(null);
    const reducedMotion = useReducedMotion();
    const [launchpadCondensed, setLaunchpadCondensed] = useState(false);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const activeGenerationTaskIdsRef = useRef(new Set<string>());
    const historyRecoveryDeletedRef = useRef(new Set<string>());
    const historySelectionRef = useRef<AbortController | null>(null);
    const retryPreparingRef = useRef(new Set<string>());
    const submitGateRef = useRef(createCreationSubmitGate());
    const smartPlanningGateRef = useRef(createCreationSubmitGate());
    const pendingRetryRef = useRef<{ context?: CreationRetryContext; lockKey: string } | null>(null);
    const [retrySequence, setRetrySequence] = useState(0);
    // 图上工具：弹窗确认后先切到图片模式，等下一次渲染拿到新状态再按工具自己的模型和参数提交。
    const pendingGenerationOverrideRef = useRef<HomepageGenerationOverride | null>(null);
    const [generationOverrideSequence, setGenerationOverrideSequence] = useState(0);
    const [imageToolTarget, setImageToolTarget] = useState<CreationImageToolTarget | null>(null);
    // 结果下方「重做」打开的弹窗：带着还原出的原提示词、参考图、模型和尺寸。
    const [imageRedoTarget, setImageRedoTarget] = useState<CreationImageRedoTarget | null>(null);
    // 图上工具上传底图、标注图期间不接受第二次提交。
    const resultImagePreparingRef = useRef(false);
    // 递增即重建恢复监听：订阅服务会缓存已结束的任务快照，任务被重新拉起或交接时需要重新订阅。
    const [recoveryEpoch, setRecoveryEpoch] = useState(0);
    const resultRefreshIdsRef = useRef(new Set<string>());
    const [resultRefreshIds, setResultRefreshIds] = useState<ReadonlySet<string>>(() => new Set());
    const resultRefreshControllersRef = useRef(new Set<AbortController>());
    const [composerPreferencesInitialized, setComposerPreferencesInitialized] = useState(false);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [activeId, conversations]);
    const activeAgentRun = activeConversation?.agentRuns?.find((run) => run.id === activeConversation.agentRunId);
    const agentPlanSource = useMemo(
        () => (activeConversation ? creationAgentPlanSource(activeConversation.messages, activeConversation.agentRuns, activeConversation.agentRunId) : undefined),
        [activeConversation],
    );
    // 方案卡里可选的画幅、质量与时长取本轮所选模型的能力；服务端仍按实际模型校验。
    const agentProposalOptions = useMemo<CreationAgentProposalOptions>(() => {
        const image = mergedImageCapabilityConfig(config, config.imageModel);
        const video = config.videoModel ? modelCapabilityConfigFor(config, config.videoModel).video : undefined;
        return {
            image: { sizes: image.size.parameter === "none" ? [] : image.size.values, qualities: image.quality.supported ? image.quality.values : image.resolution.supported ? image.resolution.values : [] },
            video: { sizes: video?.ratios || [], durations: video ? videoDurationOptions(video) : [] },
        };
    }, [config]);
    // 宽屏右侧有空位时默认展开；窄屏只露出一行进度，避免挡住对话。
    const planPanelDefaultOpen = useMemo(() => typeof window === "undefined" || window.matchMedia?.("(min-width: 1440px)").matches !== false, []);
    const agentAttachmentSelection = creationAgentAttachmentSelection(attachments);
    const agentInputError = creationAgentImageInputError(config, config.textModel, agentAttachmentSelection.imageCount);
    const agentContextView = useMemo(() => presentAgentContextUsage(activeConversation?.agentContextUsage || emptyAgentContextUsage("")), [activeConversation?.agentContextUsage]);
    const agentSettingsFingerprint = JSON.stringify({
        permissionMode: agentPermissionMode,
        imageModel: config.imageModel,
        videoModel: config.videoModel,
        imageSelectionMode: agentImageSelectionMode,
        videoSelectionMode: agentVideoSelectionMode,
        imageParameterMode: agentImageParameterMode,
        videoParameterMode: agentVideoParameterMode,
        imageSettings: agentImageSettings,
        videoSettings: agentVideoSettings,
        budget: agentBudget,
    });
    useEffect(() => {
        setAgentApprovalBaseline(activeConversation?.agentApproval?.approvalId ? agentSettingsFingerprint : "");
    }, [activeConversation?.agentApproval?.approvalId]);
    const agentApprovalSettingsChanged = Boolean(activeConversation?.agentApproval && agentApprovalBaseline && agentApprovalBaseline !== agentSettingsFingerprint);
    const historyConversations = useMemo(() => {
        const entries = new Map<string, CreationHistoryEntry>(conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).map((conversation) => [conversation.agentSessionId || conversation.id, conversation]));
        for (const pending of historyPending) {
            if (historyRecoveryDeletedRef.current.has(pending.id)) continue;
            const cached = conversations.find((conversation) => conversation.agentSessionId === pending.id);
            entries.set(pending.id, { ...pending, ...cached, title: pending.title, updatedAt: pending.updatedAt, historyStatus: pending.historyStatus });
        }
        return [...entries.values()].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
    }, [activeId, conversations, historyPending]);
    const pendingApprovals = historyConversations.filter((conversation) => conversation.agentApproval);
    const pendingApproval = pendingApprovals.find((conversation) => conversation.id === activeId) || pendingApprovals[0];
    const preferredModel = mode === "text" || mode === "agent" ? config.textModel : mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : config.audioModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(
        () => ({
            capability: creationModelCapability(mode),
            input: {
                textCount: hasPrompt ? 1 : 0,
                imageCount: mode === "agent" ? 0 : attachments.filter(isImageAttachment).length,
                videoCount: mode === "agent" ? 0 : attachments.filter(isVideoAttachment).length,
                audioCount: mode === "agent" ? 0 : attachments.filter((attachment) => creationAttachmentKind(attachment) === "audio").length,
                characterCount: 0,
            },
            videoSeconds: mode === "video" ? seconds : undefined,
            imageSize: mode === "image" && !smartCreationActive ? ratio : undefined,
            options:
                mode === "image" && !smartCreationActive
                    ? (imageParameterRequest(modelCapabilityConfigFor(config, preferredModel).image!, { ...config, size: ratio, imageResolution, quality, count, imageParameters }) ?? {
                          size: ratio,
                          imageResolution,
                          quality,
                          count: Number(count),
                          transparentBackground: config.transparentBackground === "true",
                      })
                    : mode === "video"
                      ? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality }
                      : {},
        }),
        [attachments, config, preferredModel, count, hasPrompt, imageResolution, imageParameters, mode, quality, ratio, seconds, smartCreationActive, videoQuality],
    );
    const selectedModel = mode === "agent" ? preferredModel : resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    // 音频设置（音色、格式、语速…）只在本页生效：从账号默认值开始，切换音频模型后清空重来。
    const audioConfig = useMemo<AiConfig>(() => ({ ...config, ...audioSettings, model: mode === "audio" ? selectedModel : config.audioModel, audioModel: mode === "audio" ? selectedModel : config.audioModel }), [audioSettings, config, mode, selectedModel]);
    const generationConfig = useMemo(() => (mode === "video" ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality }) : mode === "audio" ? audioConfig : config), [audioConfig, config, mode, ratio, seconds, selectedModel, videoQuality]);
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    // 同名逻辑模型可能把文生视频、图生视频和全模态参考拆到不同路由。
    // 入口需要展示整个模型组的引用能力，添加素材后再由兼容路由选择具体模型。
    const videoReferenceLimits = useMemo(() => (mode === "video" ? modelGroupReferenceLimits(config, preferredModel || selectedModel, "video") || { maxImages: 0, maxVideos: 0, maxAudios: 0 } : undefined), [config, mode, preferredModel, selectedModel]);
    const maxReferences =
        mode === "audio"
            ? 0
            : mode === "video"
              ? (videoReferenceLimits?.maxImages || 0) + (videoReferenceLimits?.maxVideos || 0) + (videoReferenceLimits?.maxAudios || 0)
              : mode === "image"
                ? imageProfile.references.maxImages
                : creationAgentImageReferenceLimit(config, config.textModel);
    const referenceImageSize = useMemo(() => {
        const imageAttachments = attachments.filter(isImageAttachment);
        if (imageAttachments.length !== 1) return undefined;
        const { width, height } = imageAttachments[0];
        if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return undefined;
        return { width, height };
    }, [attachments]);
    const isEmpty = !activeConversation?.messages.length;
    // 灵感库在空态首屏下方，挂载一次要创建几百个节点：等首屏画完、浏览器空闲后再挂，不和切页后的第一帧抢主线程。
    const inspirationHallReady = useIdleReady(hydrated && isEmpty);
    // 输入、历史目录等状态会让整页重新渲染，灵感库不依赖它们：复用同一个元素，React 直接跳过这一整块。
    const startPromptRef = useRef<(nextMode: CreationMode, nextPrompt: string) => void>(() => undefined);
    const inspirationHall = useMemo(() => <InspirationHall onUse={(item) => startPromptRef.current(item.mode, fillablePrompt(item))} />, []);
    const inspirationHallPlaceholder = (
        <div className="creation-hall-loading" role="status">
            正在准备灵感大厅…
        </div>
    );
    // 历史抽屉第一次打开前不渲染：列表每一行都带菜单，关着时也会在每次整页渲染里重新生成。
    const [historyDrawerMounted, setHistoryDrawerMounted] = useState(false);
    if (historyOpen && !historyDrawerMounted) setHistoryDrawerMounted(true);
    // 首页 Agent 只能用声明了首页入口的技能（「技能」菜单和 @ 菜单都只列这些）。
    const creationAgentSurface = mode === "agent";
    const creationSkills = useMemo(() => creationAgentSkills(addedSkills), [addedSkills]);
    const mentionReferences = useMemo(() => buildCreationMentionReferences(creationAgentSurface ? creationSkills : addedSkills, attachments, draftReferences), [addedSkills, attachments, creationAgentSurface, creationSkills, draftReferences]);

    // 空首页从顶部开始；有消息的对话由跟随消息逻辑管理滚动。
    useLayoutEffect(() => {
        if (!hydrated || !isEmpty) return;
        const frame = window.requestAnimationFrame(() => {
            threadScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeId, hydrated, isEmpty]);
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(conversations), [conversations]);
    const recoveryTaskKey = useMemo(() => {
        const ids = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        return ids.length ? `${recoveryEpoch}:${ids.join("|")}` : "";
    }, [pendingTaskIds, recoveryEpoch]);
    const videoShots = useMemo(() => creationShotRail(activeConversation?.messages || []), [activeConversation]);
    const threadRows = useMemo(() => creationThreadRows(activeConversation?.messages || []), [activeConversation?.messages]);
    // 视口外的旧消息平时跳过渲染、只按估计高度占位（creation-results.css）；跳到某条消息前先排出整段对话，定位才准。
    // 标记记下是哪段对话，换对话时清掉。
    const revealThreadMessages = () => {
        const container = threadScrollRef.current;
        if (container && activeIdRef.current) container.dataset.threadRevealed = activeIdRef.current;
    };
    const jumpToShot = (shot: CreationShotRailEntry) => {
        const id = shot.result?.id;
        if (!id) return;
        revealThreadMessages();
        document.getElementById(`creation-shot-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    useEffect(() => {
        writeComposerPref(TEXT_STREAMING_PREF_KEY, textStreaming);
        writeComposerPref(TEXT_THINKING_PREF_KEY, textThinking);
    }, [textStreaming, textThinking]);
    useEffect(() => {
        if (!composerPreferencesHydrated || composerPreferencesInitialized) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        const nextMode = defaultCreationMode;
        if (nextMode === "image" && saved.image) {
            if (saved.image.ratio) setRatio(saved.image.ratio);
            if (saved.image.quality) setQuality(saved.image.quality);
            if (saved.image.count) setCount(saved.image.count);
        }
        if (nextMode === "video" && saved.video) {
            if (saved.video.ratio) setRatio(saved.video.ratio);
            if (saved.video.seconds) setSeconds(saved.video.seconds);
            if (saved.video.videoQuality) setVideoQuality(saved.video.videoQuality);
        }
        setComposerPreferencesInitialized(true);
    }, [composerPreferencesHydrated, composerPreferencesInitialized]);

    // 换到图片 / 视频、换模型或能力表更新后，把参数换成当前模型支持的值。
    // 记下上次换算用的模式、模型和能力表，变了就在渲染里直接改（同一次渲染内生效），不放副作用：副作用要等提交后再改一次状态，
    // 整页连同全部消息会紧接着再渲染一遍；切进创作页恢复图片 / 视频对话时，这一遍正好压在首帧前面。
    const composerSettingsSource = composerPreferencesHydrated && composerPreferencesInitialized && (mode === "image" || mode === "video") ? { mode, model: selectedModel, profile: mode === "image" ? imageProfile : videoProfile } : null;
    const [normalizedComposerSettings, setNormalizedComposerSettings] = useState<typeof composerSettingsSource>(null);
    if (composerSettingsSource?.mode !== normalizedComposerSettings?.mode || composerSettingsSource?.model !== normalizedComposerSettings?.model || composerSettingsSource?.profile !== normalizedComposerSettings?.profile) {
        setNormalizedComposerSettings(composerSettingsSource);
        if (composerSettingsSource?.mode === "image") {
            const saved = useCreationPreferencesStore.getState().preferences.image;
            // 优先恢复用户上次选择；只有当前模型不支持该值时，normalizeImageValue 才回退到模型默认值。
            const normalized = normalizeImageValue(imageProfile, {
                size: saved?.ratio || imageProfile.size.default,
                quality: saved?.quality || imageProfile.quality.default,
                imageResolution: saved?.imageResolution || imageProfile.resolution.default,
                imageParameters: saved?.model === selectedModel ? saved.imageParameters : undefined,
                count: saved?.count || count,
            });
            setRatio(normalized.size);
            setQuality(normalized.quality);
            setImageResolution(normalized.imageResolution || imageProfile.resolution.default);
            setImageParameters(JSON.stringify(normalizeImageParameters(imageProfile.parameters, saved?.model === selectedModel ? saved.imageParameters : undefined)));
            setCount(normalized.count);
        } else if (composerSettingsSource?.mode === "video") {
            const saved = useCreationPreferencesStore.getState().preferences.video;
            // 优先恢复用户上次选择；只有当前模型不支持该值时，normalizeVideoValue 才回退到模型默认值。
            const normalized = normalizeVideoValue(videoProfile, {
                seconds: saved?.seconds || String(videoProfile.duration.default),
                ratio: saved?.ratio || videoProfile.defaultRatio,
                resolution: saved?.videoQuality || videoProfile.defaultResolution,
            });
            setSeconds(normalized.seconds);
            setRatio(normalized.ratio);
            setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        }
    }

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const scope = getActiveUserScope();
        if (conversationUserRef.current !== smartCreationUserId) {
            historySelectionRef.current?.abort();
            conversationUserRef.current = smartCreationUserId;
            historyRecoveryDeletedRef.current.clear();
            setHistoryPending([]);
            conversationsRef.current = [];
            activeIdRef.current = "";
            setHydrated(false);
            setConversations([]);
            setActiveId("");
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
            addedSkillsRequestedRef.current = false;
            setAddedSkills([]);
            setSkillsStatus("idle");
            cloudHistoryWriterRef.current = createCreationHistoryWriter();
            cloudHistoryFingerprintsRef.current.clear();
            setCloudHistoryError("");
            setConversationRetentionDays(undefined);
        }
        if (!composerPreferencesHydrated) return;
        setHistoryLoading(Boolean(smartCreationUserId));
        setHistorySyncError("");
        void (async () => {
            let stored: CreationConversation[] | null = null;
            try {
                stored = await loadCreationConversations<CreationConversation>(scope);
            } catch (error) {
                if (!cancelled) toast.warning(error instanceof Error ? error.message : "本地草稿暂时无法恢复");
            }
            if (cancelled) return;
            // 恢复后的整页（对话或空态首屏）一次要挂上大量节点：放进过渡里分片渲染，切到创作页时侧栏动画和输入不被一整段渲染卡住。
            startTransition(() => {
                if (!conversationsRef.current.length) {
                    const restored = mergeCreationConversationHistory(stored || [], [], useCreationPreferencesStore.getState().preferences.activeConversationId);
                    const next = restored.conversations.length ? restored.conversations : [newConversation()];
                    const selected = next.find((item) => item.id === restored.activeId) || next[0];
                    conversationsRef.current = next;
                    activeIdRef.current = selected.id;
                    setConversations(next);
                    setActiveId(selected.id);
                    setMode(creationConversationMode(selected));
                }
                setHydrated(true);
            });
            if (smartCreationUserId)
                try {
                    const { sessions, deletedSessionIds = [], conversationRetentionDays: retentionDays } = await retryCreationHistoryRead(async () => {
                        const page = await listAgentSessions({ surface: "creation", limit: 100, signal: controller.signal });
                        let cursor = page.nextCursor;
                        const seen = new Set<string>();
                        while (cursor) {
                            if (seen.has(cursor)) throw new Error("历史记录加载中断，请重试");
                            seen.add(cursor);
                            const next = await listAgentSessions({ surface: "creation", limit: 100, before: cursor, signal: controller.signal });
                            page.sessions.push(...next.sessions);
                            cursor = next.nextCursor;
                        }
                        return page;
                    }, controller.signal);
                    if (cancelled) return;
                    // 目录晚到也会让整页重新渲染，同样放进过渡，不打断已经可以操作的页面。
                    startTransition(() => {
                        setConversationRetentionDays(retentionDays);
                        for (const id of deletedSessionIds) historyRecoveryDeletedRef.current.add(id);
                        const retained = conversationsRef.current.filter((entry) => !historyRecoveryDeletedRef.current.has(entry.agentSessionId || entry.id));
                        if (retained.length !== conversationsRef.current.length) {
                            conversationsRef.current = retained.length ? retained : [newConversation()];
                            setConversations(conversationsRef.current);
                            if (!conversationsRef.current.some((entry) => entry.id === activeIdRef.current)) {
                                activeIdRef.current = conversationsRef.current[0].id;
                                setActiveId(activeIdRef.current);
                            }
                        }
                        // 目录只保存标题与时间；正文、事件和图片只在用户打开该会话时读取。
                        setHistoryPending((current) =>
                            sessions
                                .filter((session) => !historyRecoveryDeletedRef.current.has(session.id))
                                .map((session) => ({
                                    ...projectCreationAgentConversation(session, []),
                                    historyStatus: current.find((entry) => entry.id === session.id)?.historyStatus === "loading" ? "loading" : conversationsRef.current.some((entry) => entry.agentSessionId === session.id) ? undefined : "unloaded",
                                })),
                        );
                    });
                } catch (error) {
                    if (!cancelled) setHistorySyncError(error instanceof Error ? `Agent 历史暂时无法同步：${error.message}` : "Agent 历史暂时无法同步，请重试");
                }
        })().finally(() => {
            if (!cancelled) {
                // 和上面的目录一起落在同一次过渡渲染里，不单独触发一次整页同步渲染。
                startTransition(() => setHistoryLoading(false));
            }
        });
        return () => {
            cancelled = true;
            controller.abort();
            // 页面卸载只停止当前页面的状态更新，后台任务由任务中心继续执行，返回页面后再恢复状态。
        };
    }, [smartCreationUserId, composerPreferencesHydrated, historyRefreshEpoch, toast]);

    useEffect(() => {
        unmountedRef.current = false;
        const flush = () => {
            void flushCreationConversationsSave(conversationSaveChainRef.current).catch(() => undefined);
        };
        window.addEventListener("pagehide", flush);
        return () => {
            window.removeEventListener("pagehide", flush);
            flush();
            unmountedRef.current = true;
            historySelectionRef.current?.abort();
            abortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        activeIdRef.current = activeId;
        if (hydrated && composerPreferencesHydrated && activeId) rememberActiveConversation(activeId);
    }, [activeId, hydrated, composerPreferencesHydrated, rememberActiveConversation]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (hydrated) {
            const save = queueCreationConversationsSave(conversationSaveChainRef.current, conversations, smartCreationUserId || "guest", { defer: true });
            conversationSaveChainRef.current = save;
            void save.catch(() => undefined);
        }
    }, [conversations, hydrated]);

    useEffect(
        () => () => {
            for (const controller of resultRefreshControllersRef.current) controller.abort();
            resultRefreshControllersRef.current.clear();
        },
        [],
    );

    // 技能库：输入框第一次获得焦点时读取（@ 菜单要用），打开「技能」菜单或技能商店时再刷新（listAddedSkills 15 秒内复用缓存，
    // 技能商店里加入技能后缓存作废，会重新读）。刷新失败保留已读到的列表；换账号后丢弃旧账号的结果。
    // 返回的 Promise 在读完后结束，不会失败：技能商店等它结束，再把刚加入的技能标成可以使用。
    const refreshAddedSkills = useCallback(() => {
        const scope = getActiveUserScope();
        addedSkillsRequestedRef.current = true;
        setSkillsStatus((current) => (current === "ready" ? current : "loading"));
        return import("@/services/api/skills")
            .then(({ listAddedSkills }) => listAddedSkills())
            .then(({ skills }) => {
                if (scope !== getActiveUserScope()) return;
                setAddedSkills(skills);
                setSkillsStatus("ready");
            })
            .catch(() => {
                if (scope === getActiveUserScope()) setSkillsStatus((current) => (current === "ready" ? current : "error"));
            });
    }, []);
    const loadAddedSkills = useCallback(() => {
        if (!addedSkillsRequestedRef.current) void refreshAddedSkills();
    }, [refreshAddedSkills]);

    useLayoutEffect(() => {
        if (isEmpty || !followLatestMessageRef.current) return;
        // 历史恢复与任务复核都在绘制前定位，避免先展示旧位置再跳到底部。
        const container = threadScrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);
    useEffect(() => {
        setShowJumpToLatest(false);
        const container = threadScrollRef.current;
        if (container && container.dataset.threadRevealed !== activeConversation?.id) delete container.dataset.threadRevealed;
    }, [activeConversation?.id, isEmpty]);
    // 输入框随输入增高（或手机键盘弹起）时对话区变矮：原本跟着最新一条就继续贴住底部，最后几行不被挤到视口下面。
    const attachThreadScroll = useCallback((container: HTMLElement | null) => {
        threadScrollRef.current = container;
        if (!container) return;
        let height = container.clientHeight;
        const observer = new ResizeObserver(() => {
            const next = container.clientHeight;
            if (next < height && followLatestMessageRef.current) container.scrollTop = container.scrollHeight;
            height = next;
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (threadScrollRef.current === container) threadScrollRef.current = null;
        };
    }, []);

    const updateConversation = useCallback((id: string, updater: (conversation: CreationConversation) => CreationConversation) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, id, updater);
        conversationsRef.current = next;
        setConversations(next);
        return next;
    }, []);
    const updateActive = useCallback((updater: (conversation: CreationConversation) => CreationConversation) => updateConversation(activeId, updater), [activeId, updateConversation]);

    const syncConversationHistory = useCallback(
        async (conversation: CreationConversation, title?: string) => {
            const scope = getActiveUserScope();
            if (!smartCreationUserId || scope !== smartCreationUserId) throw new Error("请先登录后保存会话");
            const id = await cloudHistoryWriterRef.current(conversation, scope, title);
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开会话");
            const current = conversationsRef.current.find((item) => item.id === conversation.id);
            if (current && current.agentSessionId !== id) {
                const next = updateConversation(current.id, (item) => ({ ...item, agentSessionId: id }));
                const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                conversationSaveChainRef.current = save;
                await save;
            }
            const fingerprint = creationHistoryFingerprint(creationHistoryInput(conversation));
            cloudHistoryFingerprintsRef.current.set(conversation.id, fingerprint);
            rememberSyncedCreationHistory(conversation.id, fingerprint);
            setCloudHistoryError("");
            return id;
        },
        [smartCreationUserId, updateConversation],
    );

    useEffect(() => {
        if (!hydrated || !smartCreationUserId) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                for (const conversation of conversationsRef.current) {
                    if (cancelled) break;
                    if (!conversation.messages.length || historyRecoveryDeletedRef.current.has(conversation.agentSessionId || conversation.id)) continue;
                    // 内容和上次成功写入的一样就跳过；摘要按账号存在本机，重新打开页面也不整份重传。
                    const fingerprint = creationHistoryFingerprint(creationHistoryInput(conversation));
                    if (cloudHistoryFingerprintsRef.current.get(conversation.id) === fingerprint || syncedCreationHistoryFingerprint(conversation.id) === fingerprint) continue;
                    try {
                        await syncConversationHistory(conversation);
                    } catch (error) {
                        if (!cancelled) setCloudHistoryError(`会话已缓存到本机，云端同步未完成：${error instanceof Error ? error.message : "请稍后重试"}`);
                    }
                }
            })();
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [conversations, hydrated, smartCreationUserId, syncConversationHistory]);

    useEffect(() => {
        const id = activeConversation?.id;
        const runId = activeConversation?.agentRunId;
        const run = activeConversation?.agentRuns?.find((item) => item.id === runId);
        if (!id || !runId || !run || ["completed", "failed", "cancelled", "rejected"].includes(run.status)) return;
        const after = Math.max(0, ...(run.events || []).map((event) => event.seq));
        const scope = getActiveUserScope();
        setAgentConnectionError("");
        return subscribeAgentEvents(
            runId,
            (event) => {
                if (scope !== getActiveUserScope()) return;
                const next = updateCreationConversationSnapshot(conversationsRef.current, id, (conversation) => appendCreationAgentEvent(conversation, event));
                conversationsRef.current = next;
                setConversations(next);
                if (
                    event.type.startsWith("user_interjection") ||
                    event.type === "approval_requested" ||
                    event.type === "user_question" ||
                    (event.type === "run_status" && ["completed", "failed", "cancelled", "rejected"].includes(String(event.payload?.status)))
                ) {
                    const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                    conversationSaveChainRef.current = saved;
                    void saved.catch(() => undefined);
                }
            },
            {
                after,
                onError: (error) => {
                    if (scope === getActiveUserScope()) setAgentConnectionError(error instanceof Error ? error.message : "Agent 连接中断");
                },
            },
        );
    }, [activeConversation?.id, activeConversation?.agentRunId, agentConnectionEpoch]);

    const agentHistoryGapKey = useMemo(() => creationAgentHistoryGapKey(activeConversation), [activeConversation]);
    useEffect(() => {
        const id = activeConversation?.id;
        if (!hydrated || !id || !agentHistoryGapKey || !smartCreationUserId) return;
        const controller = new AbortController();
        const scope = getActiveUserScope();
        const current = () => (!controller.signal.aborted && scope === getActiveUserScope() && activeIdRef.current === id ? conversationsRef.current.find((conversation) => conversation.id === id) : undefined);
        void recoverCreationAgentHistory(current, creationAgentRecoveryClient, controller.signal)
            .then((restored) => {
                if (!restored || !current()) return;
                updateConversation(id, (latest) => mergeCreationAgentConversation(latest, restored));
                setAgentConnectionError("");
            })
            .catch((error) => {
                if (current()) setAgentConnectionError(error instanceof Error ? error.message : "原任务记录暂时无法同步，请重新连接");
            });
        return () => controller.abort();
    }, [hydrated, activeConversation?.id, agentHistoryGapKey, smartCreationUserId, agentConnectionEpoch, updateConversation]);

    // Agent 任务的结果由下面的订阅直接写进消息；恢复链路里的资源化会在消息变成完成时被中断，
    // 素材库里就没有这张图，「添加到画布」「画布中继续」都找不到素材。任务成功后在这里单独保存到素材库：
    // 按任务去重，物化本身幂等，不随订阅重建中断；换号时由生成消费者生命周期统一取消。
    const agentTaskMaterializingRef = useRef(new Set<string>());
    const materializeAgentTaskAssets = useCallback((task: GenerationTask) => {
        const key = `${getActiveUserScope()}:${task.id}`;
        if (agentTaskMaterializingRef.current.has(key)) return;
        agentTaskMaterializingRef.current.add(key);
        void loadCreationRuntime()
            .then((runtime) => materializeCreationTaskResults(runtime, attachCreationTaskContexts([task], conversationsRef.current)))
            .then(([result]) => {
                if (result?.creationError) console.warn("Agent 生成结果保存到素材库失败", { taskId: task.id, error: result.creationError });
            })
            .catch((error) => console.warn("Agent 生成结果保存到素材库失败", { taskId: task.id, error }))
            .finally(() => agentTaskMaterializingRef.current.delete(key));
    }, []);

    const activeAgentTaskKey = activeConversation?.agentSessionId ? activeConversation.messages.flatMap((message) => message.taskIds || []).join("|") : "";
    useEffect(() => {
        // 已经是空集合就不换新对象：恢复历史、切换对话时这里每次都会执行，换成新 Set 会让整页（连同全部消息）再渲染一遍。
        setAgentTaskSyncFailures((current) => (current.size ? new Set() : current));
        const id = activeConversation?.id;
        const taskIds = [...new Set(activeAgentTaskKey.split("|").filter(Boolean))];
        if (!id || !taskIds.length) return;
        let active = true;
        const scope = getActiveUserScope();
        const apply = (task: GenerationTask) => {
            if (!active || scope !== getActiveUserScope()) return;
            setAgentTaskSyncFailures((current) => {
                if (!current.has(task.id)) return current;
                const next = new Set(current);
                next.delete(task.id);
                return next;
            });
            const next = updateCreationConversationSnapshot(conversationsRef.current, id, (conversation) => applyCreationAgentTaskState(conversation, task));
            conversationsRef.current = next;
            setConversations(next);
            if (["succeeded", "failed", "cancelled"].includes(task.status)) {
                const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                conversationSaveChainRef.current = saved;
                void saved.catch(() => undefined);
            }
            if (task.status === "succeeded") materializeAgentTaskAssets(task);
        };
        const unsubscribe = subscribeGenerationTasks(taskIds, apply, (taskId) => {
            if (!active || scope !== getActiveUserScope()) return;
            setAgentTaskSyncFailures((current) => (current.has(taskId) ? current : new Set([...current, taskId])));
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, [activeConversation?.id, activeAgentTaskKey, agentTaskRecoveryEpoch, materializeAgentTaskAssets]);

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => (item.id === id ? updater(item) : item)),
        }));
        conversationsRef.current = next;
        setConversations(next);
        const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, conversationUserRef.current || "guest");
        conversationSaveChainRef.current = save;
        await save;
    }, []);

    /**
     * 把后端任务快照接回创作消息：成功的任务先资源化再挂到对应消息上。
     * 刷新恢复、断线重连和“重新获取结果”共用这一条链路，只读取原任务，从不创建新任务。
     */
    const applyCreationTaskSnapshots = useCallback(
        async (runtime: CreationRuntime, tasks: GenerationTask[], signal: AbortSignal): Promise<PersistedCreationTask[]> => {
            const contextual = attachCreationTaskContexts(tasks, conversationsRef.current);
            const persistedTasks = await materializeCreationTaskResults(runtime, contextual, signal);
            if (signal.aborted) return persistedTasks;
            const attachable = persistedTasks.filter((task) => task.status === "succeeded" && Boolean(task.clientContext?.conversationId && task.clientContext.messageId) && Boolean(task.creationResultUrls?.length || task.creationResultStorageKeys?.length));
            for (const task of attachable) {
                const conversationId = task.clientContext!.conversationId!;
                const messageId = task.clientContext!.messageId!;
                try {
                    await runtime.consumeGenerationTaskMessage(task, messageId, async ({ effectKey, resultUrls, resultStorageKeys }) => {
                        if (signal.aborted) return;
                        await updateConversationMessage(conversationId, messageId, (item) =>
                            runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                ...current,
                                status: "done" as const,
                                content: current.mode === "video" ? "视频已生成" : "图片已生成",
                                error: undefined,
                                errorKind: undefined,
                                syncInterrupted: undefined,
                                mediaRecoverable: undefined,
                                generationStatus: "succeeded" as const,
                                ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}),
                                ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}),
                            })).value,
                        );
                    }, { signal, materialize: async () => task, materializedUrls: runtime.generationTaskMaterializedUrls, materializedStorageKeys: runtime.generationTaskMaterializedStorageKeys });
                } catch (error) {
                    if (signal.aborted) return persistedTasks;
                    console.warn("创作任务结果挂载失败，将使用已物化结果收敛消息状态", error);
                }
            }
            return persistedTasks;
        },
        [updateConversationMessage],
    );

    useEffect(() => {
        if (!hydrated || !recoveryTaskKey || !pendingTaskIds.length) return;
        // 当前页面主动提交的任务由 submit 自己等待并收尾；恢复监听只接管刷新前遗留、或 submit 交接过来的任务，避免同一任务被双重轮询。
        const recoverableTaskIds = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        if (!recoverableTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        // 一条消息可能对应多张图的多个任务：保留每个任务的最新快照一起收敛，不会只看到其中一个就提前定论。
        const knownTasks = new Map<string, PersistedCreationTask>();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const runtime = await loadCreationRuntime();
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, observationController.signal);
            if (cancelled) return;
            taskSyncWarningRef.current = false;
            for (const task of persistedTasks) knownTasks.set(task.id, task);
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, [...knownTasks.values()]));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn("创作任务状态同步失败", error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning("任务状态暂时无法同步，请稍后刷新");
            }
        };
        let applyChain = Promise.resolve();
        let unsubscribe: () => void = () => {};
        void loadCreationRuntime()
            .then((runtime) => {
                if (cancelled) return;
                unsubscribe = runtime.subscribeGenerationTasks(recoverableTaskIds, (task) => {
                    applyChain = applyChain.then(() => applyTasks([task])).catch(warnSync);
                });
            })
            .catch(warnSync);
        return () => {
            cancelled = true;
            observationController.abort();
            unsubscribe();
        };
    }, [applyCreationTaskSnapshots, hydrated, recoveryTaskKey, toast]);

    const beginResultRefresh = (messageId: string) => {
        if (resultRefreshIdsRef.current.has(messageId)) return null;
        resultRefreshIdsRef.current.add(messageId);
        setResultRefreshIds(new Set(resultRefreshIdsRef.current));
        const controller = new AbortController();
        resultRefreshControllersRef.current.add(controller);
        return {
            signal: controller.signal,
            finish() {
                resultRefreshControllersRef.current.delete(controller);
                resultRefreshIdsRef.current.delete(messageId);
                setResultRefreshIds(new Set(resultRefreshIdsRef.current));
            },
        };
    };

    // 重新查询原任务并接回结果：任务仍在进行就回到生成中继续跟进，已成功就补回作品；不会提交新任务。
    const refreshMessageResult = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            if (tasks.some((task) => task.status === "queued" || task.status === "running")) {
                setRecoveryEpoch((value) => value + 1);
                toast.info("任务仍在生成，完成后会自动显示");
            } else if (persistedTasks.some((task) => task.status === "succeeded" && !task.creationResultUrls?.length && !task.creationResultStorageKeys?.length)) {
                toast.warning("作品已生成，但暂时无法载入，请稍后再试");
            }
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(`暂时无法获取结果：${generationErrorMessage(error)}`);
        } finally {
            refresh.finish();
        }
    };

    // 作品已生成但后端保存失败：重放保存检查点，不重新生成、不重复扣费，随后回到生成中跟进保存结果。
    const recoverMessageMedia = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const recovered = await Promise.allSettled(taskIds.map((id) => runtime.recoverGenerationTaskMedia(id)));
            if (!recovered.some((entry) => entry.status === "fulfilled")) {
                const rejected = recovered.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                throw rejected?.reason instanceof Error ? rejected.reason : new Error("作品暂时无法重新保存");
            }
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            setRecoveryEpoch((value) => value + 1);
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(`重新保存失败：${generationErrorMessage(error)}`);
        } finally {
            refresh.finish();
        }
    };

    const selectMode = (requested: CreationMode, audioKind?: AudioGenerationKind) => {
        const next = requested === "text" ? "agent" : requested;
        if (next !== "image") setSmartCreationActive(false);
        setMode(next);
        updateActive((conversation) => selectCreationConversationMode(conversation, next));
        if (next !== "agent") rememberMode(next);
        const key = creationModelKey(next);
        if (next === "audio" && audioKind) {
            // 音乐和音频共用 audioModel：换类时先记下这一类最后用的模型，换回来时还原，没有再取第一个。
            const current = config.audioModel;
            if (current) lastAudioModelsRef.current[isMusicAudioModel(config, current) ? "music" : "speech"] = current;
            const models = audioModelsOfKind(config, audioKind);
            const remembered = lastAudioModelsRef.current[audioKind];
            const target = models.includes(current) ? current : remembered && models.includes(remembered) ? remembered : models[0];
            if (target && target !== current) {
                setAudioSettings({});
                updateConfig(key, target);
            }
            return;
        }
        const nextModels = selectableModelsByCapability(config, creationModelCapability(next));
        if (!nextModels.includes(config[key]) && nextModels[0]) updateConfig(key, nextModels[0]);
    };

    const executeSmartCreationPlan = async (plan: SmartCreationAgentPlan, requestAttachments: CreationAttachment[], displayPrompt = plan.intent, parentUserMessageId?: string) => {
        if (!plan.tasks.length) throw new Error("智能创作计划没有可执行任务");
        const { tasks: generationTasks, truncated } = expandSmartCreationPlan(plan, smartCreationExecution);
        if (!generationTasks.length) throw new Error("智能创作计划没有可执行任务");
        if (truncated) toast.warning(`计划共 ${generationTasks.length + truncated} 张，已按插件上限提交前 ${generationTasks.length} 张`);
        const batchId = `smart-creation-batch:${Date.now()}`;
        const batchSettings = generationTasks[0]?.settings;
        const batchUserMessage = newMessage("user", displayPrompt, {
            mode: "image",
            model: selectedModel,
            attachments: requestAttachments,
            settings: {
                ratio: batchSettings?.aspectRatio || ratio,
                seconds,
                quality: batchSettings?.quality || quality,
                videoQuality,
                count: String(generationTasks.length),
            },
            batchId,
            batchTotal: generationTasks.length,
        });
        const batchAssistantMessage = newMessage("assistant", "", {
            mode: "image",
            model: selectedModel,
            status: "pending",
            settings: batchUserMessage.settings,
            batchId,
            batchTotal: generationTasks.length,
            batchCompletedCount: 0,
            batchFailedCount: 0,
        });
        updateActive((conversation) => {
            const nextMessages = parentUserMessageId
                ? conversation.messages
                      .map((message) =>
                          message.id === parentUserMessageId ? { ...message, batchId, batchTotal: generationTasks.length, settings: message.settings ? { ...message.settings, count: String(generationTasks.length) } : batchUserMessage.settings } : message,
                      )
                      .concat(batchAssistantMessage)
                : [...conversation.messages, batchUserMessage, batchAssistantMessage];
            return {
                ...conversation,
                title: conversation.messages.length ? conversation.title : displayPrompt.slice(0, 24),
                updatedAt: new Date().toISOString(),
                messages: nextMessages,
            };
        });
        // 在并发窗口内逐张提交：账号任务数满时等空位，而不是一次推满后被后端拒绝。
        const concurrency = Math.max(1, Math.min(smartCreationExecution.maxConcurrency, activeTaskLimit || smartCreationExecution.maxConcurrency));
        const outcomes = await runSmartCreationSchedule(
            generationTasks,
            (task) =>
                submit(undefined, undefined, {
                    source: "smart-creation-agent",
                    batchId,
                    batchMessageId: batchAssistantMessage.id,
                    batchTotal: generationTasks.length,
                    prompt: task.prompt,
                    itemId: task.itemId,
                    queuePosition: task.position,
                    queueSize: generationTasks.length,
                    imageCount: 1,
                    planVersion: plan.planVersion,
                    targetPlatform: plan.targetPlatform,
                    targetMarket: plan.targetMarket,
                    targetLanguage: plan.targetLanguage,
                    styleFingerprint: plan.styleBible?.fingerprint,
                    settings: { ...task.settings, count: 1 },
                    attachments: requestAttachments,
                    displayPrompt: `${task.title}（${task.position}/${generationTasks.length}） · ${displayPrompt}`,
                }),
            {
                concurrency,
                capacityWaitMs: smartCreationExecution.capacityWaitMs,
                anchorFirst: smartCreationExecution.anchorFirst,
                isCapacityError: isGenerationTaskCapacityError,
            },
        );
        const rejected = outcomes.filter((outcome) => outcome.status === "rejected").length;
        if (rejected === generationTasks.length) {
            const reason = outcomes.find((outcome) => outcome.status === "rejected");
            throw reason?.status === "rejected" && reason.reason instanceof Error ? reason.reason : new Error("智能创作任务全部提交失败");
        }
        toast.success(`${smartCreationBrand} 已提交 ${generationTasks.length - rejected} 张图片任务${rejected ? `，${rejected} 张提交失败` : ""}，结果将聚合返回`);
    };

    const setComposerRatio = (value: string) => {
        setRatio(value);
        if (mode === "image") rememberImageSettings({ ratio: value });
        if (mode === "video") rememberVideoSettings({ ratio: value });
    };
    const setComposerSeconds = (value: string) => {
        setSeconds(value);
        if (mode === "video") rememberVideoSettings({ seconds: value });
    };
    const setComposerQuality = (value: string) => {
        setQuality(value);
        if (mode === "image") rememberImageSettings({ quality: value });
    };
    const setComposerImageResolution = (value: string) => {
        setImageResolution(value);
        if (mode === "image") rememberImageSettings({ imageResolution: value });
    };
    const setComposerVideoQuality = (value: string) => {
        const normalized = normalizeVideoValue(videoProfile, { seconds, ratio, resolution: value });
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        setSeconds(normalized.seconds);
        if (mode === "video") rememberVideoSettings({ videoQuality: value });
        if (mode === "video") rememberVideoSettings({ seconds: normalized.seconds });
    };
    const setComposerCount = (value: string) => {
        setCount(value);
        if (mode === "image") rememberImageSettings({ count: value });
    };

    const externalLibraryItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            externalAssetSources.items.map((item) => ({
                ...item,
                disabledReason: creationLibraryDisabledReason(mode, item.external?.item.kind, videoReferenceLimits),
            })),
        [externalAssetSources.items, mode, videoReferenceLimits],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => [
            ...assets
                .filter((asset): asset is Extract<Asset, { kind: "image" | "video" | "audio" }> => asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
                .map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    category: asset.category || "other",
                    kindLabel: asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片",
                    asset,
                    searchText: (asset.tags || []).join(" "),
                    disabledReason: creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits),
                })),
            ...externalLibraryItems,
        ],
        [assets, externalLibraryItems, mode, videoReferenceLimits],
    );
    const uploadCreationAsset = async (file: File) => {
        const { uploadImage, uploadMediaFile } = await loadCreationRuntime();
        if (file.type.startsWith("video/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationVideoAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromVideo(file, uploaded),
            };
        }
        if (file.type.startsWith("audio/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationAudioAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromAudio(file, uploaded),
            };
        }
        if (!file.type.startsWith("image/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return { attachment: creationAttachmentFromDocument(file, uploaded) };
        }
        const uploaded = await uploadImage(file);
        return {
            asset: creationImageAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
            attachment: creationAttachmentFromImage(file, uploaded),
        };
    };
    const uploadLibraryAssets = async (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => creationFileAccepted(mode, file));
        if (!next.length) return [];
        const settled = await Promise.allSettled(
            next.map(async (file) => {
                const { asset } = await uploadCreationAsset(file);
                return asset ? addAsset(asset) : "";
            }),
        );
        const assetIds = settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []));
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(`${assetIds.length} 个素材已上传到素材库并自动选中`);
        if (failed.length) toast.error(`${failed.length} 个素材上传失败，请重试`);
        return assetIds;
    };

    const handleLibrarySelect = async (selectedIds: string[], pickedItems = libraryItems) => {
        const next = creationLibrarySelectionToAttachments(selectedIds, pickedItems, mode, videoReferenceLimits);
        if (!next.length) return;
        const selected = new Set(selectedIds);
        const cachedIds = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
        const uncachedAssetIds = pickedItems.filter((item) => item.asset && selected.has(item.id) && !cachedIds.has(item.id)).map((item) => item.id);
        if (uncachedAssetIds.length) await loadAssetsForUse(uncachedAssetIds);
        setAttachments((current) => {
            const candidates = [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next];
            const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
            if (reconciled.attachments.length < candidates.length) toast.warning("部分素材超出当前模型的参考内容上限，未添加到创作中");
            return reconciled.attachments;
        });
        setLibraryOpen(false);
    };

    const removeAttachment = (id: string) => {
        const reference = mentionReferences.find((item) => item.attachmentId === id);
        setAttachments((current) => removeCreationAttachment(current, id));
        if (reference) setPrompt((current) => removeCreationReferenceTokens(current, [reference]));
    };

    const clearComposer = () => {
        promptRef.current = "";
        attachmentsRef.current = [];
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    const reorderAttachments = useCallback((next: CreationAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);

    const replaceAttachmentReference = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        const currentAttachments = attachmentsRef.current;
        const target = currentAttachments.find((attachment) => attachment.id === targetAttachmentId);
        if (!target) throw new Error("要替换的参考图不存在");
        if (creationAttachmentKind(target) !== "image" || creationAttachmentKind(replacement) !== "image") throw new Error("目前只支持替换提示词中的图片引用");
        if (target.id === replacement.id) return false;

        const result = replaceCreationAttachmentReference(promptRef.current, currentAttachments, targetAttachmentId, { ...replacement, role: target.role || replacement.role });
        promptRef.current = result.prompt;
        attachmentsRef.current = result.attachments;
        setPrompt(result.prompt);
        setAttachments(result.attachments);
        return true;
    }, []);

    const replaceReferenceFromTrack = useCallback(
        (targetAttachmentId: string, replacement: CreationAttachment) => {
            try {
                if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success("参考图已替换，槽位不变，提示词无需修改");
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "参考图替换失败");
            }
        },
        [replaceAttachmentReference, toast],
    );

    const replaceReferenceFromFiles = useCallback(
        async (targetAttachmentId: string, files: File[]) => {
            if (busy || referenceReplacementBusy) return;
            const file = files.find((item) => item.type.startsWith("image/"));
            if (!file) {
                toast.warning("请拖入图片文件进行替换");
                return;
            }
            setReferenceReplacementBusy(true);
            try {
                const { asset, attachment } = await uploadCreationAsset(file);
                if (creationAttachmentKind(attachment) !== "image") throw new Error("上传结果不是可用图片");
                if (asset) addAsset(asset);
                if (replaceAttachmentReference(targetAttachmentId, attachment)) toast.success("参考图已替换，槽位不变，提示词无需修改");
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "参考图上传或替换失败");
            } finally {
                setReferenceReplacementBusy(false);
            }
        },
        [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, toast],
    );

    const addPastedReferenceFiles = useCallback(
        async (files: File[]) => {
            if (busy || referenceReplacementBusy || referencePasteBusy) return;
            const imageFiles = files.filter((file) => file.type.startsWith("image/"));
            if (!imageFiles.length) return;
            const availableSlots = Math.max(0, maxReferences - attachmentsRef.current.length);
            if (!availableSlots) {
                toast.warning(`当前模型最多支持 ${maxReferences} 个参考素材`);
                return;
            }
            const acceptedFiles = imageFiles.slice(0, availableSlots);
            setReferencePasteBusy(true);
            try {
                const settled = await Promise.allSettled(acceptedFiles.map((file) => uploadCreationAsset(file)));
                const uploads = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
                const nextAttachments = uploads.map((item) => item.attachment).filter((attachment) => creationAttachmentKind(attachment) === "image");
                uploads.forEach(({ asset }) => {
                    if (asset) addAsset(asset);
                });
                if (nextAttachments.length) {
                    const candidates = [...attachmentsRef.current, ...nextAttachments];
                    const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, mentionReferences, maxReferences);
                    attachmentsRef.current = reconciled.attachments;
                    setAttachments(reconciled.attachments);
                    if (reconciled.removedReferences.length) setPrompt((current) => removeCreationReferenceTokens(current, reconciled.removedReferences));
                    toast.success(`已添加 ${nextAttachments.length} 张参考图`);
                }
                const failed = settled.filter((entry) => entry.status === "rejected");
                if (failed.length) toast.error(`${failed.length} 张图片上传失败，请重试`);
                if (imageFiles.length > acceptedFiles.length) toast.warning(`已添加前 ${acceptedFiles.length} 张图片，当前模型最多支持 ${maxReferences} 个参考素材`);
            } finally {
                setReferencePasteBusy(false);
            }
        },
        [addAsset, busy, maxReferences, mentionReferences, mode, referencePasteBusy, referenceReplacementBusy, toast, videoReferenceLimits],
    );

    type HomepageGenerationOverride = Omit<HomepageCreationGenerationRequest, "styleFingerprint"> & {
        styleFingerprint?: string;
        attachments?: CreationAttachment[];
        displayPrompt?: string;
        /** create-page：本页的图上工具（高清、扩图、局部重绘……）；失败已写进结果卡，不再向调用方抛出。 */
        source?: "homepage-agent" | "smart-creation-agent" | "create-page";
        /** 透明像素为可编辑区域；只在模型支持蒙版时传。 */
        mask?: ReferenceImage;
        /** 图上工具自带的清晰度档位、工作流参数和透明背景；不传时沿用输入框。 */
        imageResolution?: string;
        imageParameters?: string;
        transparentBackground?: string;
        /** 图上工具提交前输入框的创作类型；提交发出后切回去，工具不改变输入框。 */
        restoreMode?: CreationMode;
        /** 重做沿用原消息的素材、技能引用；不传时按输入框当前的引用解析。 */
        references?: CreationReference[];
        batchId?: string;
        batchMessageId?: string;
        batchTotal?: number;
        planVersion?: string;
        targetPlatform?: string;
        targetMarket?: string;
        targetLanguage?: string;
        settings?: SmartCreationTaskSettings;
        imageCount?: number;
    };

    const submitSmartCreation = async () => {
        const text = prompt.trim();
        if (!smartCreationProvider || mode !== "image" || !text || busy || smartCreationPlanning || !activeConversation) return;
        const currentAttachments = [...attachmentsRef.current];
        const explicitlyDropsReferences = /(不要|不需要|去掉|移除|忽略).{0,12}(参考图|参考图片|图片|素材)/i.test(text);
        const inheritedAttachments = currentAttachments.length || explicitlyDropsReferences ? [] : inheritedSmartCreationAttachments(activeConversation.messages);
        const requestAttachments = Array.from(new Map([...currentAttachments, ...inheritedAttachments].map((attachment) => [attachment.storageKey || attachment.id, attachment])).values());
        const originConversationId = activeConversation.id;
        const references = selectedCreationReferences(text, mentionReferences);
        const settings = { ratio, seconds, quality, videoQuality, count };
        const previousPlan = [...activeConversation.messages].reverse().find((message) => message.agentPlan)?.agentPlan;
        const conversation = activeConversation.messages.filter((message) => message.content.trim()).map((message) => ({ role: message.role, content: message.content }));
        if (previousPlan) conversation.push({ role: "assistant", content: smartPlanContext(previousPlan, smartCreationBrand) });
        conversation.push({ role: "user", content: text });
        const currentReferences = mentionReferences
            .filter((reference) => reference.active)
            .map((reference) => ({ title: reference.title || reference.label, url: reference.previewUrl, storageKey: reference.storageKey, kind: reference.kind, text: reference.text }));
        const inheritedReferences = currentAttachments.length || explicitlyDropsReferences ? [] : inheritedSmartCreationReferences(activeConversation.messages);
        const agentReferences = Array.from(new Map([...currentReferences, ...inheritedReferences].map((reference) => [reference.storageKey || reference.url || reference.title, reference])).values());
        const planningUserMessage = newMessage("user", text, { mode: "image", model: selectedModel, attachments: requestAttachments, references, settings });
        const planningAssistantMessage = newMessage("assistant", "正在理解你的提示词和参考图，规划生成方案…", { mode: "text", model: selectedModel, status: "streaming", settings });
        followLatestMessageRef.current = true;
        updateActive((conversationItem) => ({
            ...conversationItem,
            title: conversationItem.messages.length ? conversationItem.title : text.slice(0, 24),
            updatedAt: new Date().toISOString(),
            messages: [...conversationItem.messages, planningUserMessage, planningAssistantMessage],
        }));
        setSmartCreationPlanning(true);
        let planningCompleted = false;
        let executionStarted = false;
        try {
            const response = await smartCreationProvider.plan({
                conversation,
                generationMode: "image",
                targetModel: selectedModel,
                targetProtocol: resolveModelChannel(config, selectedModel).interfaceType,
                references: agentReferences,
            });
            const plan = response.plan;
            if (!plan) throw new Error(response.message || "智能创作 Agent 没有返回可执行计划");
            if (plan.questions.length) {
                await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                    ...item,
                    content: response.message || `为了准确生成，我只需要确认：\n- ${plan.questions[0]}`,
                    status: "done",
                    agentPlan: plan,
                }));
                planningCompleted = true;
                setPrompt("");
                return;
            }
            await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                ...item,
                content: smartPlanSummary(plan),
                status: "done",
                agentPlan: plan,
            }));
            planningCompleted = true;
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
            void persistSmartCreationMemory(plan, originConversationId, { brand: smartCreationBrand, pluginId: smartCreationResolved?.manifest.id || "smart-creation" });
            executionStarted = true;
            await executeSmartCreationPlan(plan, requestAttachments, text, planningUserMessage.id);
        } catch (error) {
            if (!planningCompleted || executionStarted) {
                await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                    ...item,
                    content: executionStarted ? "智能创作生成失败，请重试。" : "智能创作规划失败，请检查需求或重试。",
                    status: "error",
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
            toast.error(error instanceof Error ? error.message : "智能创作规划失败，请重试");
        } finally {
            setSmartCreationPlanning(false);
        }
    };

    const stopCreationGeneration = async () => {
        const conversation = activeConversation;
        if (!conversation?.agentSessionId || busy || stoppingConversationRef.current) return;
        const scope = getActiveUserScope();
        stoppingConversationRef.current = conversation.id;
        setStoppingConversationId(conversation.id);
        try {
            await stopCreationAgentRuns(conversation, (run) => {
                if (unmountedRef.current || scope !== getActiveUserScope()) return;
                updateConversation(conversation.id, (current) =>
                    mergeCreationAgentConversation(
                        current,
                        projectCreationAgentConversation({ id: conversation.agentSessionId!, title: current.title, surface: "creation", status: "active", revision: 0, createdAt: run.createdAt, updatedAt: run.updatedAt }, [run]),
                    ),
                );
            });
            if (!unmountedRef.current && scope === getActiveUserScope()) toast.success("Agent 已停止；已提交的图片、视频继续生成并正常计费，可继续发送新需求");
        } catch (error) {
            if (!unmountedRef.current && scope === getActiveUserScope()) toast.error(error instanceof Error ? error.message : "未能确认停止，请重试");
        } finally {
            stoppingConversationRef.current = "";
            if (!unmountedRef.current) setStoppingConversationId("");
        }
    };

    const interjectCreationAgent = async (conversation: CreationConversation, text: string, messageId?: string, heldToken?: symbol): Promise<boolean> => {
        if ((!heldToken && busy) || stoppingConversationRef.current === conversation.id) return false;
        const token = heldToken || submitGateRef.current.tryAcquire();
        if (!token) return false;
        const scope = getActiveUserScope();
        const assertCurrent = () => {
            if (scope !== getActiveUserScope() || unmountedRef.current) throw new Error("账号或页面已切换，原补充说明仍保留在原会话");
            if (!conversationsRef.current.some((item) => item.id === conversation.id && item.agentSessionId === conversation.agentSessionId)) throw new Error("原会话已关闭，请从历史核对补充说明");
        };
        let accepted = false;
        const clearAcceptedDraft = () => {
            const current = conversationsRef.current.find((item) => item.id === conversation.id);
            if (activeIdRef.current === conversation.id && current && creationConversationMode(current) === "agent" && promptRef.current.trim() === text && !attachmentsRef.current.length) {
                setPrompt("");
                setDraftReferences([]);
            }
        };
        setBusy(true);
        try {
            if (!messageId && (await loadPendingCreationAgentSubmission(conversation.id))) throw new Error("上一条 Agent 创建回执仍待确认，请先核对原任务，再发送补充说明");
            assertCurrent();
            const result = await submitCreationAgentInterjection(
                { conversation, text, messageId, attachments: messageId ? undefined : attachmentsRef.current },
                {
                    assertCurrent,
                    accepted: () => {
                        accepted = true;
                    },
                    createId: () => `interjection-${createClientId()}`,
                    read: async (id, after) => (await getAgentRun(id, undefined, { sinceSeq: after, fromStart: after === 0, eventLimit: 500 })).run,
                    send: sendAgentInterjection,
                    observe: (run) =>
                        updateConversation(conversation.id, (current) =>
                            mergeCreationAgentConversation(
                                current,
                                projectCreationAgentConversation({ id: conversation.agentSessionId!, title: current.title, surface: "creation", status: "active", revision: 0, createdAt: run.createdAt, updatedAt: run.updatedAt }, [run]),
                            ),
                        ),
                    save: async (message) => {
                        assertCurrent();
                        const next = updateConversation(conversation.id, (current) => upsertCreationAgentInterjection(current, message));
                        const persisted = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                        conversationSaveChainRef.current = persisted;
                        await persisted;
                    },
                },
            );
            assertCurrent();
            if (result.message.agentInterjection === "undelivered") {
                toast.warning(result.message.error || "本轮已结束，补充说明未送达；草稿已保留");
                return false;
            }
            clearAcceptedDraft();
            return true;
        } catch (error) {
            if (accepted) {
                if (scope === getActiveUserScope() && !unmountedRef.current) {
                    clearAcceptedDraft();
                    toast.warning("补充说明已被原轮次接收，本地记录暂未同步；可从历史核对，不需要再次发送");
                }
                return true;
            }
            if (scope === getActiveUserScope() && !unmountedRef.current) toast.warning(error instanceof Error ? error.message : "补充说明回执待确认，请核对原消息");
            return false;
        } finally {
            setBusy(false);
            submitGateRef.current.release(token);
        }
    };

    /**
     * action 表示这次不是输入框的普通发送：retry/recoverPending 会重放或核对原请求；
     * inheritAttachments（回答提问卡）只发送这段文字、沿用本会话素材，不带走输入框里的草稿和附件。
     */
    const submitCreationAgent = async (
        textOverride?: string,
        conversationOverride?: CreationConversation,
        replanning = false,
        action?: { retry?: CreateAgentRunInput["retry"]; recoverPending?: boolean; inheritAttachments?: boolean },
    ): Promise<boolean> => {
        let conversation = conversationOverride || conversationsRef.current.find((item) => item.id === activeIdRef.current) || activeConversation;
        const text = (textOverride ?? prompt).trim();
        const replay = Boolean(action?.retry || action?.recoverPending);
        if ((!action && !creationHasInput("agent", text, attachments)) || busy || !conversation || stoppingConversationRef.current === conversation.id) return false;
        if (!action && agentInputError) {
            toast.warning(agentInputError);
            return false;
        }
        const submittedConversation = conversation;
        let parentRunId = conversation.agentRunId;
        const submitToken = submitGateRef.current.tryAcquire();
        if (!submitToken) return false;
        const conversationId = conversation.id;
        const submissionId = `agent-submission-${conversationId}`;
        const scope = getActiveUserScope();
        const assertScope = () => {
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开创作会话");
        };
        const submittedAttachmentKeys = attachments.map((item) => item.storageKey || item.id).join("|");
        let mayClearDraft = true;
        const clearSubmittedDraft = () => {
            if (action || !mayClearDraft || activeIdRef.current !== conversationId || promptRef.current.trim() !== text || attachmentsRef.current.map((item) => item.storageKey || item.id).join("|") !== submittedAttachmentKeys) return;
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
        };
        setBusy(true);
        followLatestMessageRef.current = true;
        let submissionKey: string | undefined;
        let recoveringPending = false,
            requestSent = false,
            accepted = false;
        try {
            const pending = await loadPendingCreationAgentSubmission(conversationId);
            recoveringPending = Boolean(pending);
            if (pending) parentRunId = pending.parentRunId;
            if (pending) mayClearDraft = text === pending.prompt && attachments.map((item) => item.storageKey).join("|") === (pending.request.attachments || []).map((item) => item.storageKey).join("|");
            assertScope();
            if (action?.recoverPending && !pending) throw new Error("待确认请求已处理，请刷新本会话后查看结果");
            const sessionId = pending?.sessionId || (await syncConversationHistory({ ...conversation, title: conversation.messages.length ? conversation.title : creationAgentConversationTitle(text, attachments) }));
            assertScope();
            if (activeIdRef.current === conversationId) conversationRoute.show(sessionId, true);
            const snapshot = pending || conversation.agentSessionId ? await getAgentSession(sessionId) : undefined;
            assertScope();
            if (snapshot) {
                assertCreationAgentSession(snapshot.session, snapshot.runs);
                const projected = projectCreationAgentConversation(snapshot.session, snapshot.runs);
                const merged = updateConversation(conversationId, (current) => mergeCreationAgentConversation(current, projected));
                conversation = merged.find((item) => item.id === conversationId) || conversation;
                // A different tab may have added a newer requirement. Fresh
                // submissions follow that run; unknown submissions keep their
                // original immutable parent and request identity.
                if (!pending) parentRunId = projected.agentRunId;
            }
            if (pending && snapshot?.runs.some((run) => run.idempotencyKey === pending.key)) {
                accepted = true;
                const restored = await restoreCreationAgentConversation(sessionId, creationAgentRecoveryClient);
                assertScope();
                const merged = updateConversation(conversationId, (current) => mergeCreationAgentConversation(current, restored));
                conversation = merged.find((item) => item.id === conversationId) || conversation;
                await clearPendingCreationAgentSubmission(conversationId, scope, pending.key);
                assertScope();
                // A received run is a fact even if the user has since edited
                // the composer. Confirm it before comparing the old request
                // fingerprint, then send new text only to its active run.
                if (!replay && !mayClearDraft) {
                    if (!replanning && (creationAgentInterjectionRun(conversation) || pendingCreationAgentInterjection(conversation))) return await interjectCreationAgent(conversation, text, undefined, submitToken);
                    toast.warning("原请求已确认，当前草稿已保留；请核对最新结果后发送");
                    return false;
                }
                clearSubmittedDraft();
                return true;
            }
            if (!pending && !action && !replanning && (creationAgentInterjectionRun(conversation) || pendingCreationAgentInterjection(conversation))) return await interjectCreationAgent(conversation, text, undefined, submitToken);
            if (parentRunId) {
                const parent = snapshot?.runs.find((run) => run.id === parentRunId) || (await getAgentRun(parentRunId)).run;
                assertScope();
                if (parent.sessionId !== sessionId || parent.canvasId || parent.surface !== "creation") throw new Error("此轮次不属于当前首页会话，请从对应历史入口继续");
                if (!pending && (parent.cleanupPending || ["queued", "running", "waiting_approval"].includes(parent.status))) {
                    toast.warning(parent.status === "waiting_approval" ? "请先处理当前待审批计划" : "Agent 正在运行，请等待本轮结束后继续");
                    return false;
                }
            }
            assertScope();
            updateConversation(conversationId, (current) =>
                beginCreationAgentSubmission(current, {
                    id: submissionId,
                    prompt: pending?.prompt ?? text,
                    attachments: action || pending ? [] : attachments,
                    // 和普通生成一样记下提示词里引用的技能和素材，气泡里显示成 @名称，而不是 @[skill:…] 令牌。
                    references: action || pending ? [] : selectedCreationReferences(text, mentionReferences),
                    silent: Boolean(action?.retry || pending?.request.retry),
                    createdAt: new Date().toISOString(),
                    model: config.textModel,
                }),
            );
            const key = pending?.key || createClientId();
            const imageSelection = config.imageModel ? creationManagedModelSelection(config, config.imageModel) : undefined;
            const videoSelection = config.videoModel ? creationManagedModelSelection(config, config.videoModel) : undefined;
            const request =
                replay && pending
                    ? pending.request
                    : buildCreationAgentRunInput({
                          conversation: pending ? submittedConversation : conversation,
                          retry: action?.retry,
                          prompt: text,
                          idempotencyKey: key,
                          sessionId,
                          permissionMode: agentPermissionMode,
                          reasoningMode: agentReasoningMode,
                          webSearch: agentWebSearch !== "off",
                          textSelection: creationManagedModelSelection(config, config.textModel),
                          imageSelection,
                          videoSelection,
                          imageParameters: { selectionMode: agentImageSelectionMode, parameterMode: replanning ? "auto" : agentImageParameterMode, size: agentImageSettings.size, quality: agentImageSettings.quality, count: agentImageSettings.count },
                          videoParameters: {
                              selectionMode: agentVideoSelectionMode,
                              parameterMode: replanning ? "auto" : agentVideoParameterMode,
                              size: agentVideoSettings.size,
                              quality: agentVideoSettings.quality,
                              durationSeconds: agentVideoSettings.durationSeconds,
                          },
                          budget: agentBudget,
                          // 待确认的旧请求按原额度核对指纹，避免报价刷新后被误判为另一次提交。
                          preauthorizedCredits: pending ? pending.request.budget?.autoApproveCredits : creationAgentPreauthorizedCredits(agentEstimateCredits, agentBudget.maxCredits),
                          attachments: action ? [] : attachments,
                          attachmentMode: action ? "inherit" : agentAttachmentSelection.attachmentMode,
                          outputPreference: pending ? pending.request.outputPreference : agentOutputPreference,
                          // 提示词里选中或 @ 的首页技能固定到本轮（技能令牌、@名称、/名称都算）。
                          skills: addedSkills,
                      });
            const effectiveParentRunId = replay && pending ? pending.parentRunId : parentRunId;
            const fingerprint = JSON.stringify({ ...request, idempotencyKey: "", parentRunId: effectiveParentRunId });
            if (pending && pending.fingerprint !== fingerprint) throw new Error("上次 Agent 请求结果待确认，请保持原提示词和设置后重试，避免重复提交");
            submissionKey = key;
            if (!pending) await savePendingCreationAgentSubmission(conversationId, { sessionId, key, fingerprint, prompt: text, request, parentRunId, createdAt: new Date().toISOString() });
            assertScope();
            const bound = updateConversation(conversationId, (current) => bindCreationAgentSubmission(current, submissionId, sessionId, key));
            const persisted = queueCreationConversationsSave(conversationSaveChainRef.current, bound, scope);
            conversationSaveChainRef.current = persisted;
            await persisted;
            assertScope();
            requestSent = true;
            const response = effectiveParentRunId ? await sendAgentMessage(effectiveParentRunId, request) : await createAgentRun(request);
            if (!response.run?.id) throw new Error("Agent 未返回运行回执，请恢复原请求核对结果");
            accepted = true;
            assertScope();
            const run = { ...response.run, userPrompt: response.run.userPrompt ?? request.prompt, sessionId };
            const session = {
                id: sessionId,
                title: conversation.title === "新创作" ? creationAgentConversationTitle(text, attachments) : conversation.title,
                surface: "creation",
                status: "active",
                revision: 0,
                createdAt: conversation.updatedAt,
                updatedAt: run.updatedAt,
            };
            const projected = projectCreationAgentConversation(session, [...(conversation.agentRuns || []), run]);
            updateConversation(conversationId, (current) => settleCreationAgentSubmission(current, projected, submissionId));
            await clearPendingCreationAgentSubmission(conversationId, scope, key);
            clearSubmittedDraft();
            void restoreCreationAgentConversation(sessionId, creationAgentRecoveryClient)
                .then((restored) => {
                    if (scope !== getActiveUserScope()) return;
                    const current = conversationsRef.current.find((item) => item.id === conversationId);
                    if (current?.agentRunId === run.id) updateConversation(conversationId, (latest) => mergeCreationAgentConversation(latest, restored));
                })
                .catch(() => undefined);
            return true;
        } catch (error) {
            if (accepted) {
                if (scope === getActiveUserScope()) {
                    clearSubmittedDraft();
                    toast.warning("Agent 请求已提交，本地恢复记录暂未清理；请从当前会话或历史查看进度");
                }
                return true;
            }
            let rejectedKey: string | undefined;
            let cleanupError: unknown;
            if (submissionKey && !recoveringPending && (!requestSent || isAgentAdmissionRejection(error))) {
                try {
                    await clearPendingCreationAgentSubmission(conversationId, scope, submissionKey);
                    rejectedKey = submissionKey;
                } catch (cause) {
                    cleanupError = cause;
                }
            }
            if (scope === getActiveUserScope()) {
                const failure = error instanceof Error ? error.message : "Agent 请求失败；运行记录仍可从历史恢复";
                const detail = cleanupError ? `${failure}；本地待确认记录未能清理（${cleanupError instanceof Error ? cleanupError.message : "存储不可用"}），已保留原请求以便恢复核对` : failure;
                updateConversation(conversationId, (current) => failCreationAgentSubmission(current, submissionId, detail, rejectedKey));
                toast.error(detail);
            }
            return false;
        } finally {
            setBusy(false);
            submitGateRef.current.release(submitToken);
        }
    };

    /** 方案卡改写提示词或参数：服务端重新报价并轮换审批 ID，随后按会话恢复读取新方案。 */
    const updateCreationApprovalItems = async (edits: AgentApprovalItemEdit[]): Promise<boolean> => {
        const conversation = activeConversation;
        const approval = conversation?.agentApproval;
        const runId = conversation?.agentRunId;
        if (!conversation?.agentSessionId || !runId || !approval || agentApprovalSubmitting || !edits.length) return false;
        const scope = getActiveUserScope();
        setAgentApprovalSubmitting(true);
        try {
            await updateAgentApprovalItems(runId, approval.approvalId, edits);
            const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
            if (scope !== getActiveUserScope()) return false;
            updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            return true;
        } catch (error) {
            if (scope !== getActiveUserScope()) return false;
            toast.error(error instanceof Error ? error.message : "方案未能更新，请稍后重试");
            try {
                const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
                if (scope === getActiveUserScope()) updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            } catch {
                /* 保留当前方案，下次同步再刷新。 */
            }
            return false;
        } finally {
            setAgentApprovalSubmitting(false);
        }
    };

    const decideCreationApproval = async (decision: "approve" | "reject" | "refresh", options?: { skipItemIds?: string[] }): Promise<CreationConversation | undefined> => {
        const conversation = activeConversation;
        const approval = conversation?.agentApproval;
        const runId = conversation?.agentRunId;
        if (!conversation?.agentSessionId || !runId || !approval || agentApprovalSubmitting) return;
        if (decision === "approve" && agentApprovalSettingsChanged) {
            toast.error("设置已变更，请填写备注修改方案后重新审批");
            return;
        }
        const scope = getActiveUserScope();
        setAgentApprovalSubmitting(true);
        try {
            const current = (await getAgentRun(runId)).run;
            if (current.surface !== "creation" || current.canvasId || current.sessionId !== conversation.agentSessionId) throw new Error("此审批不属于当前首页会话，请在对应画布中处理");
            if (current.status !== "waiting_approval" || current.approval?.approvalId !== approval.approvalId) throw new Error("审批状态已变化，已重新读取会话，请核对最新方案");
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开创作会话");
            await decideAgentApproval(runId, approval.approvalId, decision, undefined, undefined, undefined, decision === "approve" ? options?.skipItemIds : undefined);
            const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
            if (scope !== getActiveUserScope()) return;
            updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            if (decision === "refresh") toast.success("报价已更新，核对后可继续批准");
            return { ...restored, id: conversation.id };
        } catch (error) {
            if (scope !== getActiveUserScope()) return;
            toast.error(error instanceof Error ? error.message : "审批未能提交，请核对运行状态");
            try {
                const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
                if (scope === getActiveUserScope()) updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            } catch {
                /* Keep the last reviewable plan until recovery succeeds. */
            }
        } finally {
            setAgentApprovalSubmitting(false);
        }
    };

    const modifyCreationPlan = async (notes: string): Promise<boolean> => {
        const plan = activeConversation?.agentCommercePlan;
        if (!plan || busy || agentApprovalSubmitting || !notes.trim()) return false;
        let conversation = activeConversation;
        if (conversation.agentApproval) {
            const restored = await decideCreationApproval("reject");
            if (!restored) return false;
            conversation = restored;
        }
        const text = `请根据备注修改方案 ${plan.planId} 第 ${plan.version} 版。原创作目标：${plan.intent}；平台/站点 ${plan.platform}/${plan.site}，语言 ${plan.language}，共 ${plan.items.length} 项。未提及的产品身份、素材角色、规格与文案沿用本会话最新方案；备注覆盖冲突的旧要求。

修改备注：${notes.trim()}

请使用同一计划 ID、递增版本，重新规划完整方案、风格锁定与真实报价。${agentPermissionMode === "auto" ? "沿用当前自动执行权限与预算继续生成，不额外请求确认。" : agentPermissionMode === "read_only" ? "沿用当前只读权限，仅更新方案，不生成媒体。" : "沿用当前执行权限与预算，按原有权限流程继续处理。"}`;
        return submitCreationAgent(text, conversation, true);
    };

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string, generationOverride?: HomepageGenerationOverride, bypassSmartCreation = false) => {
        if (!generationOverride && mode === "agent") return submitCreationAgent();
        if (!generationOverride && !bypassSmartCreation && smartCreationActive && smartCreationProvider && mode === "image") {
            await withCreationSubmitGate(smartPlanningGateRef.current, submitSmartCreation);
            return;
        }
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        const smartBatchSubmission = generationOverride?.source === "smart-creation-agent";
        const submitToken = smartBatchSubmission ? null : submitGateRef.current.tryAcquire();
        if (!smartBatchSubmission && !submitToken) {
            releaseRetryLock();
            if (generationOverride) throw new Error("已有创作任务正在运行，请等待当前任务完成");
            return;
        }
        const releaseSubmitGate = submitToken ? createCreationSubmitGateRelease(submitGateRef.current, submitToken) : () => undefined;
        const text = (generationOverride?.prompt || prompt).trim();
        if (!text || (!smartBatchSubmission && busy) || !activeConversation) {
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("Agent 运行时缺少可用的创作会话");
            return;
        }
        const originConversationId = activeConversation.id;
        const requestScope = getActiveUserScope();
        const requestModel = generationOverride?.settings?.model?.trim() || selectedModel;
        if (!requestModel) {
            toast.warning(`请先在设置中配置${modeLabels[mode]}模型`);
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("请先在设置中配置图片模型");
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds), videoQuality)) {
            toast.error("当前模型不支持所选视频时长，请重新选择");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        // 图上工具在弹窗里选了模型：参考图上限、尺寸换算和张数按这个模型算，不受输入框当前模型影响。
        // 只在图片模式求值，视频、音频提交不读图片能力。
        const toolImageProfile = mode === "image" && generationOverride?.source === "create-page" ? modelCapabilityConfigFor(config, requestModel).image : undefined;
        const requestAttachments = generationOverride?.attachments || attachments;
        const unsupportedReference = requestAttachments.map((attachment) => creationLibraryDisabledReason(mode, creationAttachmentKind(attachment), videoReferenceLimits)).find(Boolean);
        if (unsupportedReference) {
            toast.warning(`${unsupportedReference}；原草稿已保留，请移除不支持的素材或切换模式`);
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error(unsupportedReference);
            return;
        }
        const reconciledAttachments =
            mode === "video" && videoReferenceLimits
                ? reconcileCreationAttachmentLimits(requestAttachments, mentionReferences, videoReferenceLimits)
                : reconcileCreationAttachmentLimit(requestAttachments, mentionReferences, toolImageProfile ? toolImageProfile.references.maxImages : maxReferences);
        if (reconciledAttachments.attachments !== requestAttachments) {
            toast.warning("参考内容超出当前模型能力，请移除不支持的素材或切换模型；原草稿已保留");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("参考素材不符合当前图片模型限制");
            return;
        }
        const requestCount = generationOverride?.imageCount ? String(generationOverride.imageCount) : generationOverride?.source !== "smart-creation-agent" && generationOverride?.queueSize ? "1" : count;
        const requestRatio = generationOverride?.settings?.aspectRatio || ratio;
        const requestQuality = generationOverride?.source === "smart-creation-agent" ? imageProfile.quality.default || "auto" : generationOverride?.settings?.quality || quality;
        const requestImageResolution = generationOverride?.imageResolution || imageResolution;
        const requestImageParameters = generationOverride?.imageParameters ?? imageParameters;
        const requestTransparentBackground = generationOverride?.transparentBackground ?? config.transparentBackground;
        const settings = {
            ratio: requestRatio,
            seconds,
            quality: requestQuality,
            videoQuality,
            count: requestCount,
            ...(mode === "image" ? { imageResolution: requestImageResolution, imageParameters: requestImageParameters, transparentBackground: requestTransparentBackground } : {}),
        };
        const references = generationOverride?.references ?? selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(requestAttachments);
        const videoOperation = inferVideoOperation({
            textCount: text ? 1 : 0,
            imageCount: referenceImages.length,
            videoCount: referenceVideos.length,
            audioCount: referenceAudios.length,
            characterCount: 0,
        });
        const skillReferences = references.flatMap((reference) => (reference.skill ? [reference.skill] : []));
        let runtime: CreationRuntime;
        try {
            runtime = await loadCreationRuntime();
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成运行时加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw error;
            return;
        }
        let skillExecution: Awaited<ReturnType<typeof runtime.skillRuntime.prepare>>;
        try {
            skillExecution = await runtime.skillRuntime.prepare({
                profile: "creation",
                prompt: expandCreationPrompt(text, references, requestAttachments),
                skills: skillReferences,
                selectedSkillIds: skillReferences.map((skill) => skill.skillId),
            });
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "技能上下文加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw error;
            return;
        }
        const expandedPrompt = skillExecution.prompt;
        const referenceMetadata: Record<string, unknown> = { ...skillExecution.metadata };
        followLatestMessageRef.current = true;
        const batchSubmission = Boolean(generationOverride?.batchMessageId);
        const clientOperationId = retryContext?.clientOperationId || createClientId();
        const trackSubmission = !batchSubmission && (mode === "image" || mode === "video" || mode === "audio");
        const userMessage = newMessage("user", generationOverride?.displayPrompt || text, { mode, model: requestModel, attachments: requestAttachments, references, settings });
        const assistantMessage = batchSubmission
            ? ({ id: generationOverride!.batchMessageId!, createdAt: new Date().toISOString() } as CreationMessage)
            : newMessage("assistant", "", { mode, model: requestModel, status: mode === "text" && textStreaming ? "streaming" : "pending", settings, ...retryContext, clientOperationId, ...(trackSubmission ? { submissionPending: true } : {}) });
        const updateOriginAssistant = (updater: (item: CreationMessage) => CreationMessage) => updateConversationMessage(originConversationId, assistantMessage.id, updater);
        // 仅表示本页请求仍在发送；不落盘，刷新后仍按原操作身份核对回执。
        const finishSubmitting = () =>
            setSubmittingMessageIds((ids) => {
                if (!ids.has(assistantMessage.id)) return ids;
                const next = new Set(ids);
                next.delete(assistantMessage.id);
                return next;
            });
        if (trackSubmission) setSubmittingMessageIds((ids) => new Set(ids).add(assistantMessage.id));
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const boundTasks = new Map<string, GenerationTask>();
        const bindTask = (task: GenerationTask) => {
            const taskAccepted = task.status !== "failed" && task.status !== "cancelled" && !task.errorCode;
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
            boundTaskIds.add(task.id);
            activeGenerationTaskIdsRef.current.add(task.id);
            boundTasks.set(task.id, task);
            if (taskAccepted) releaseSubmitGate();
            updateOriginAssistant((item) => bindCreationSubmissionTask(item, task));
            if (taskAccepted && abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
                // 任务已经建出来了：提交阶段到此结束。立刻放闸，这样上一条还在生成时
                // 也能继续提交下一条，不必等它跑完。
                releaseSubmitGate();
            }
        };
        if (!batchSubmission)
            updateActive((conversation) => ({
                ...conversation,
                title: conversation.messages.length ? conversation.title : text.slice(0, 24),
                updatedAt: new Date().toISOString(),
                messages: [...conversation.messages, userMessage, assistantMessage],
            }));
        if (!generationOverride && activeIdRef.current === originConversationId) {
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
        }
        setBusy(true);
        const controller = new AbortController();
        const requestLifecycle = runtime.beginGenerationConsumer(controller.signal);
        abortRef.current = controller;
        const requestImageProfile = mode === "image" ? toolImageProfile || imageProfile : undefined;
        const normalizedImage = requestImageProfile
            ? requestImageProfile.parameters
                ? { size: generationOverride?.settings?.size || requestRatio, quality: requestQuality, imageResolution: requestImageResolution, imageParameters: requestImageParameters, count: requestCount }
                : normalizeImageValue(
                      requestImageProfile,
                      { size: generationOverride?.settings?.size || requestRatio, quality: requestQuality, imageResolution: requestImageResolution, imageParameters: requestImageParameters, count: requestCount },
                      resolveModelRequestConfig(config, requestModel).interfaceType,
                  )
            : undefined;
        const requestConfig = {
            ...generationConfig,
            model: requestModel,
            imageModel: requestModel,
            imageResolution: normalizedImage?.imageResolution || requestImageResolution,
            imageParameters: normalizedImage?.imageParameters || requestImageParameters,
            videoModel: requestModel,
            textModel: requestModel,
            audioModel: requestModel,
            ...(mode === "image"
                ? { size: normalizedImage?.size || requestRatio, quality: normalizedImage?.quality || requestQuality, count: normalizedImage?.count || requestCount, videoSeconds: config.videoSeconds, transparentBackground: requestTransparentBackground }
                : {}),
        };
        let handedOverToRecovery = false;
        try {
            // 先保存本次操作标识。创建回执丢失或刷新后仍能沿原请求恢复。
            if (trackSubmission) await updateOriginAssistant((item) => item);
            const current = conversationsRef.current.find((item) => item.id === originConversationId);
            if (!current) throw new Error("创作会话已关闭，未提交生成请求");
            const creationSessionId = await syncConversationHistory(current);
            referenceMetadata.creationSessionId = creationSessionId;
            if (activeIdRef.current === originConversationId) conversationRoute.show(creationSessionId, true);
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
            if (mode === "text") {
                const result = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "text",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        textHistory: (activeConversation.messages || []).filter((item) => item.content.trim()).map((item) => ({ role: item.role, content: item.content })),
                        signal: requestLifecycle.signal,
                        metadata: {
                            source: generationOverride?.source || (generationOverride ? "homepage-agent" : "create-page"),
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            ...(generationOverride?.itemId
                                ? { homepageItemId: generationOverride.itemId, queuePosition: generationOverride.queuePosition, queueSize: generationOverride.queueSize, styleFingerprint: generationOverride.styleFingerprint }
                                : {}),
                            ...(generationOverride?.targetLanguage ? { targetLanguage: generationOverride.targetLanguage } : {}),
                            ...(generationOverride?.targetPlatform ? { targetPlatform: generationOverride.targetPlatform, targetMarket: generationOverride.targetMarket, planVersion: generationOverride.planVersion } : {}),
                            ...referenceMetadata,
                        },
                        onTaskUpdate: bindTask,
                        streamText: textStreaming,
                        enableThinking: textThinking,
                        onTextDelta: textStreaming ? (value) => updateOriginAssistant((item) => ({ ...item, content: value })) : undefined,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (!result.text?.trim()) throw new Error("后端任务没有返回文本");
                updateOriginAssistant((item) => ({ ...item, content: result.text || "", reasoning: result.reasoning }));
            } else if (mode === "image") {
                const maxOutputs = (toolImageProfile || imageProfile).maxOutputs;
                const taskCount = generationOverride?.imageCount
                    ? Math.max(1, Math.min(maxOutputs, Math.floor(generationOverride.imageCount)))
                    : generationOverride?.source !== "smart-creation-agent" && generationOverride?.queueSize
                      ? 1
                      : Math.max(1, Math.min(maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTaskBatch({
                        mode: "image",
                        prompt: expandedPrompt,
                        config: { ...requestConfig, count: "1" },
                        referenceImages,
                        ...(generationOverride?.mask ? { mask: generationOverride.mask } : {}),
                        signal: requestLifecycle.signal,
                        metadata: {
                            source: generationOverride?.source || (generationOverride ? "homepage-agent" : "create-page"),
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            ...(generationOverride?.itemId
                                ? { homepageItemId: generationOverride.itemId, queuePosition: generationOverride.queuePosition, queueSize: generationOverride.queueSize, styleFingerprint: generationOverride.styleFingerprint }
                                : {}),
                            ...(generationOverride?.targetLanguage ? { targetLanguage: generationOverride.targetLanguage } : {}),
                            ...(generationOverride?.targetPlatform ? { targetPlatform: generationOverride.targetPlatform, targetMarket: generationOverride.targetMarket, planVersion: generationOverride.planVersion } : {}),
                            ...referenceMetadata,
                        },
                        onTaskUpdate: bindTask,
                        count: taskCount,
                        onSubmissionUnconfirmed: finishSubmitting,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (requestLifecycle.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedTasks = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return [
                        {
                            result: entry.value,
                            taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                            batchIndex,
                        },
                    ];
                });
                const unconfirmed = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected" && runtime.isGenerationSubmissionUnconfirmed(entry.reason));
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected" && !runtime.isGenerationSubmissionUnconfirmed(entry.reason));
                const storedImages = await Promise.allSettled(
                    generatedTasks.map(async ({ result, taskId, batchIndex }) => {
                        if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                        const task = completedCreationGenerationTask(runtime, {
                            taskId,
                            task: boundTasks.get(taskId),
                            mode: "image",
                            prompt: expandedPrompt,
                            result,
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            batchIndex,
                            batchCount: taskCount,
                        });
                        return consumeCreationImageResults(runtime, task, assistantMessage.id, taskCount, updateOriginAssistant, requestLifecycle.signal);
                    }),
                );
                const successfulImages = storedImages.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                const completedCount = successfulImages.length;
                if (!completedCount) {
                    const reason = unconfirmed[0]?.reason || taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failedCount) toast.warning(`${completedCount} 张图片已生成，${failedCount} 张生成失败`);
                if (!batchSubmission) updateOriginAssistant((item) => ({ ...item, content: failedCount ? `${completedCount} 张图片已生成，${failedCount} 张失败` : "图片已生成" }));
            } else if (mode === "audio") {
                // 和视频同一条路：一个后端任务、一个结果，物化成音频素材后写回结果卡。
                const result = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "audio",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        onSubmissionUnconfirmed: finishSubmitting,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (!result.audio?.dataUrl && !result.audios?.some((audio) => audio.dataUrl)) throw new Error("后端任务没有返回音频");
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "audio", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(
                    task,
                    assistantMessage.id,
                    async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant(
                            (item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "音频已生成", resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) })).value,
                        );
                    },
                    { signal: requestLifecycle.signal },
                );
                if (!runtime.generationTaskMaterializedUrls(materialized)[0]) throw new Error("音频结果资源不可用");
            } else {
                const result = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "video",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: videoOperation, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        onSubmissionUnconfirmed: finishSubmitting,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(
                    task,
                    assistantMessage.id,
                    async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant(
                            (item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "视频已生成", resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) })).value,
                        );
                    },
                    { signal: requestLifecycle.signal },
                );
                if (!runtime.generationTaskMaterializedUrls(materialized)[0]) throw new Error("视频结果资源不可用");
            }
            if (!batchSubmission) {
                const submissionPending = trackSubmission && (await runtime.hasPendingGenerationSubmission(clientOperationId));
                await updateOriginAssistant((item) => ({ ...item, status: submissionPending ? "pending" : "done", submissionPending: submissionPending || undefined }));
            }
        } catch (error) {
            // 批次任务在提交阶段就被账号任务上限拒绝时，交还调度器等空位重试，不计入批次失败。
            if (batchSubmission && !boundTaskIds.size && isGenerationTaskCapacityError(error)) throw error;
            if (trackSubmission && (runtime.isGenerationSubmissionUnconfirmed(error) || (await runtime.hasPendingGenerationSubmission(clientOperationId)))) {
                await updateOriginAssistant((item) => ({ ...item, status: "pending", submissionPending: true, error: undefined, generationErrorCode: undefined }));
                return;
            }
            const cancelled = runtime.isGenerationTaskCancelled(error, requestLifecycle.signal);
            await updateOriginAssistant((item) =>
                projectCreationTaskWaitFailure({ ...item, submissionPending: undefined }, error, {
                    cancelled,
                    unmounted: unmountedRef.current,
                    boundTaskCount: boundTaskIds.size,
                    batchSubmission,
                    batchTotal: generationOverride?.batchTotal || item.batchTotal || 0,
                    operation: mode === "video" ? videoOperation : mode,
                }),
            );
            if ((!batchSubmission && cancelled) || (unmountedRef.current && boundTaskIds.size > 0)) return;
            if (generationOverride && generationOverride.source !== "create-page") throw error;
        } finally {
            if (trackSubmission) finishSubmitting();
            for (const taskId of boundTaskIds) activeGenerationTaskIdsRef.current.delete(taskId);
            if (handedOverToRecovery) setRecoveryEpoch((value) => value + 1);
            requestLifecycle.release();
            releaseRetryLock();
            releaseSubmitGate();
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        }
    };

    useEffect(() => {
        if (!retrySequence) return;
        const pending = pendingRetryRef.current;
        if (!pending) return;
        pendingRetryRef.current = null;
        void submit(pending.context, pending.lockKey, undefined, true);
    }, [retrySequence]);

    useEffect(() => {
        if (!generationOverrideSequence) return;
        const pending = pendingGenerationOverrideRef.current;
        if (!pending) return;
        pendingGenerationOverrideRef.current = null;
        // 结果卡出现之前的拒绝（模型未配置、参考图超限、已有任务在提交）只会抛出，这里提示。
        void submit(undefined, undefined, pending).catch((error: unknown) => toast.error(generationErrorMessage(error)));
        // submit 已按本次渲染的图片模式取好参数；输入框随即回到工具打开前的创作类型。
        if (pending.restoreMode) setMode(pending.restoreMode);
    }, [generationOverrideSequence]);

    const startNewConversation = () => {
        cancelHistorySelection();
        const next = newConversation();
        followLatestMessageRef.current = true;
        conversationsRef.current = [next, ...conversationsRef.current];
        setConversations(conversationsRef.current);
        activeIdRef.current = next.id;
        setActiveId(next.id);
        setMode(defaultCreationMode);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
        void navigate("/create", { replace: false });
    };

    const continueOnCanvas = async (selectedAssetIds?: string[]) => {
        if (!activeConversation || openingCanvasRef.current) return;
        openingCanvasRef.current = true;
        setOpeningCanvas(true);
        const scope = getActiveUserScope();
        const source = activeConversation;
        try {
            const assets = useAssetStore.getState().assets;
            const generatedAssetIds =
                selectedAssetIds ||
                source.messages.flatMap((item) => {
                    const resultStorageKeys = item.resultStorageKeys || [];
                    const resultUrls = item.resultUrls || [];
                    if (!resultStorageKeys.length && !resultUrls.length) return [];
                    const ids = creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls, resultStorageKeys });
                    if (ids.length !== Math.max(resultStorageKeys.length, resultUrls.length)) throw new Error("部分生成素材还未保存完成，请稍后转入画布。");
                    return ids;
                });
            const referenceKeys = new Set(source.messages.flatMap((item) => (item.attachments || []).map((attachment) => attachment.storageKey).filter(Boolean)));
            const referenceAssetIds = assets.filter((asset) => (asset.kind === "image" || asset.kind === "video") && asset.data.storageKey && referenceKeys.has(asset.data.storageKey)).map((asset) => asset.id);
            const assetIds = [...generatedAssetIds, ...referenceAssetIds];
            if (assetIds.length) await saveRemoteUserDataNow([]);
            const result = await continueCreationConversationOnCanvas(source);
            if (scope !== getActiveUserScope()) return;
            const next = updateCreationConversationSnapshot(conversationsRef.current, source.id, (item) => ({ ...item, canvasId: result.id }));
            conversationsRef.current = next;
            setConversations(next);
            const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
            conversationSaveChainRef.current = saved;
            await saved;
            if (scope !== getActiveUserScope()) return;
            if (result.syncError) toast.warning("会话已保存在本机，云端同步尚未完成。");
            const params = new URLSearchParams({ conversation: result.sessionId });
            if (assetIds.length) {
                params.set("mode", "handoff");
                [...new Set(assetIds)].forEach((id) => params.append("asset", id));
            }
            navigate(`/canvas/${result.id}?${params.toString()}`);
        } catch (cause) {
            if (scope === getActiveUserScope()) toast.error(cause instanceof Error ? cause.message : "转入画布失败，原会话已保留");
        } finally {
            openingCanvasRef.current = false;
            setOpeningCanvas(false);
        }
    };

    const refreshHistory = () => setHistoryRefreshEpoch((current) => current + 1);
    const openHistory = () => {
        setHistoryOpen(true);
        refreshHistory();
    };

    const cancelHistorySelection = () => {
        historySelectionRef.current?.abort();
        historySelectionRef.current = null;
        setHistoryPending((current) => current.map((entry) => (entry.historyStatus === "loading" ? { ...entry, historyStatus: "unloaded" } : entry)));
    };

    const selectConversation = async (conversation: CreationConversation, options: { fromRoute?: boolean; signal?: AbortSignal } = {}) => {
        cancelHistorySelection();
        const controller = new AbortController();
        options.signal?.addEventListener("abort", () => controller.abort(), { once: true, signal: controller.signal });
        if (options.signal?.aborted) controller.abort();
        historySelectionRef.current = controller;
        const scope = getActiveUserScope();
        let selected = conversation;
        const sessionId = conversation.agentSessionId;
        if (sessionId) {
            setHistoryPending((current) => [...current.filter((entry) => entry.id !== sessionId), { ...conversation, id: sessionId, historyStatus: "loading" }]);
            try {
                const incoming = await restoreCreationConversation(sessionId, controller.signal);
                if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                if (historyRecoveryDeletedRef.current.has(sessionId)) throw new Error("会话已删除或已超过保留期限");
                const merged = mergeCreationConversationHistory(conversationsRef.current, [incoming], conversation.id, false);
                selected = merged.conversations.find((entry) => entry.agentSessionId === sessionId)!;
                conversationsRef.current = merged.conversations;
                setConversations(merged.conversations);
                setHistoryPending((current) => current.filter((entry) => entry.id !== sessionId));
                for (const confirmed of merged.confirmedSubmissions) {
                    try {
                        const pending = await loadPendingCreationAgentSubmission(confirmed.conversationId);
                        if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                        if (pending?.key === confirmed.key) await clearPendingCreationAgentSubmission(confirmed.conversationId, scope);
                    } catch {
                        if (!controller.signal.aborted) toast.warning("运行已恢复，待确认请求记录暂时无法清理，请稍后刷新");
                    }
                }
            } catch (error) {
                if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                setHistoryPending((current) => current.map((entry) => (entry.id === sessionId ? { ...entry, historyStatus: "error" } : entry)));
                toast.error(error instanceof Error ? error.message : "对话加载失败，请点击该标题重试");
                if (options.fromRoute) throw error;
                return;
            }
        }
        if (controller.signal.aborted || scope !== getActiveUserScope()) return;
        historySelectionRef.current = null;
        followLatestMessageRef.current = true;
        activeIdRef.current = selected.id;
        setActiveId(selected.id);
        setMode(creationConversationMode(selected));
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
        if (!options.fromRoute) {
            try {
                const id = await syncConversationHistory(selected);
                if (!controller.signal.aborted && scope === getActiveUserScope() && activeIdRef.current === selected.id) conversationRoute.show(id);
            } catch (error) {
                if (scope === getActiveUserScope()) setCloudHistoryError(`会话已缓存到本机，云端同步未完成：${error instanceof Error ? error.message : "请重试"}`);
            }
        }
    };

    const conversationRoute = useCreationConversationRoute(
        hydrated && composerPreferencesHydrated,
        smartCreationUserId,
        async (id, signal) => {
            if (!smartCreationUserId) throw new Error("请先登录后打开该会话");
            const cached = conversationsRef.current.find((item) => (item.agentSessionId || item.id) === id);
            const conversation = cached || { id, agentSessionId: id, title: "创作会话", updatedAt: new Date().toISOString(), messages: [] };
            await selectConversation({ ...conversation, agentSessionId: id }, { fromRoute: true, signal });
        },
        historyRecoveryDeletedRef.current,
    );

    useEffect(() => {
        if (!hydrated || location.state?.creationHome || conversationRoute.conversationId || !activeConversation?.agentSessionId || !activeConversation.messages.length) return;
        conversationRoute.show(activeConversation.agentSessionId, true);
    }, [hydrated, location.state, conversationRoute.conversationId, conversationRoute.show, activeConversation?.id, activeConversation?.agentSessionId]);

    const copyConversationLink = async (conversation: CreationConversation) => {
        try {
            const id = await syncConversationHistory(conversation);
            await navigator.clipboard.writeText(new URL(creationConversationPath({ id }), window.location.origin).href);
            toast.success("会话链接已复制，仅登录该账号后可访问");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "会话链接复制失败");
        }
    };

    const confirmDeleteConversation = (conversation: CreationConversation) => {
        const scope = getActiveUserScope();
        const title = conversation.title.trim() || "新创作";
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        setHistoryDeleteOpen(true);
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: "删除历史对话？",
            content: `确定删除「${label}」吗？这会将该对话从历史记录中移除，不会删除已上传或生成的任何素材。此操作不可撤销。${conversation.agentSessionId ? "如有任务正在运行，请先停止或等待任务结束。" : ""}`,
            okText: "删除对话",
            okButtonProps: { danger: true },
            cancelText: "保留",
            afterClose: () => setHistoryDeleteOpen(false),
            onOk: async () => {
                try {
                    if (scope !== getActiveUserScope()) throw new Error("账号已切换，请在当前账号重新选择历史对话");
                    const current = conversationsRef.current.find((item) => item.id === conversation.id) || (conversation.agentSessionId ? conversation : undefined);
                    if (!current) throw new Error("要删除的创作对话不存在");
                    if (current.messages.some((message) => message.role === "assistant" && message.mode === "agent" && message.status === "streaming" && message.clientOperationId)) {
                        throw new Error("Agent 请求正在提交，请等待提交完成后再删除");
                    }
                    if (current.agentSessionId) await deleteAgentSession(current.agentSessionId);
                    if (scope !== getActiveUserScope()) {
                        const cleanup = conversationSaveChainRef.current.catch(() => undefined).then(() => removeStoredCreationConversation(conversation.id, scope));
                        conversationSaveChainRef.current = cleanup;
                        await cleanup;
                        return;
                    }
                    historyRecoveryDeletedRef.current.add(current.agentSessionId || current.id);
                    setHistoryPending((entries) => entries.filter((entry) => entry.id !== (current.agentSessionId || current.id)));
                    const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversation.id);
                    const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
                    const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
                    const next = remaining.length ? remaining : [fallback];
                    const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                    conversationSaveChainRef.current = save;
                    conversationsRef.current = next;
                    setConversations(next);
                    if (activeIdRef.current === conversation.id) {
                        followLatestMessageRef.current = true;
                        activeIdRef.current = fallback.id;
                        setActiveId(fallback.id);
                        setMode(creationConversationMode(fallback));
                        setPrompt("");
                        setAttachments([]);
                        setDraftReferences([]);
                        if (fallback.agentSessionId) conversationRoute.show(fallback.agentSessionId, true);
                        else void navigate("/create", { replace: true });
                    }
                    await save;
                    void clearPendingCreationAgentSubmission(conversation.id, scope).catch(() => undefined);
                    if (scope !== getActiveUserScope()) return;
                    toast.success("历史对话已删除，素材仍保留");
                } catch (error) {
                    if (scope === getActiveUserScope()) toast.error(error instanceof Error ? error.message : "历史对话删除失败");
                    throw error;
                }
            },
        });
    };

    const renameConversationTitle = async (conversation: CreationConversation, title: string) => {
        const nextTitle = title.trim().slice(0, 120);
        if (!nextTitle || nextTitle === conversation.title.trim()) return;
        const scope = getActiveUserScope();
        try {
            await syncConversationHistory(conversation, nextTitle);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "对话重命名保存失败");
            return;
        }
        if (scope !== getActiveUserScope()) return;
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversation.id, (item) => ({ ...item, title: nextTitle }));
        conversationsRef.current = next;
        setConversations(next);
        const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, conversationUserRef.current || "guest");
        conversationSaveChainRef.current = saved;
        void saved.catch((error) => toast.error(error instanceof Error ? error.message : "对话重命名保存失败"));
    };

    // 首页精选灵感、灵感大厅与灵感广场「做同款」只带模式、比例和提示词过来：预填表单，不替换模型，也不自动生成。
    // 文本灵感进入 Agent 模式。
    useEffect(() => {
        if (!composerPreferencesInitialized || !location.state) return;
        const state = location.state as { mode?: CreationMode; ratio?: string; prompt?: string; creationHome?: boolean };
        // 先等「开新对话」处理完（它会去掉 creationHome 并保留其余字段），再预填到新对话里。
        if (state.creationHome) return;
        if (state.mode !== "image" && state.mode !== "video" && state.mode !== "text") return;
        selectMode(state.mode);
        if (state.mode !== "text" && typeof state.ratio === "string" && state.ratio) {
            setRatio(state.ratio);
            if (state.mode === "image") rememberImageSettings({ ratio: state.ratio });
            else rememberVideoSettings({ ratio: state.ratio });
        }
        if (typeof state.prompt === "string") setPrompt(state.prompt);
        navigate(location.pathname, { replace: true, state: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [composerPreferencesInitialized, location.state, location.pathname]);

    const restoreMessageDraft = (item: CreationMessage) => {
        const nextMode = item.mode || "text";
        const nextSettings = item.settings;
        selectMode(nextMode);
        setPrompt(item.content);
        const nextAttachments = item.attachments ? [...item.attachments] : [];
        setAttachments(nextAttachments);
        attachmentsRef.current = nextAttachments;
        setDraftReferences(item.references ? [...item.references] : []);
        if (item.model) updateConfig(creationModelKey(nextMode), item.model);
        if (!nextSettings) return;
        setRatio(nextSettings.ratio);
        setSeconds(nextSettings.seconds);
        setQuality(nextSettings.quality);
        if (nextMode === "image") {
            setImageResolution(nextSettings.imageResolution || "auto");
            setImageParameters(nextSettings.imageParameters || "{}");
        }
        setVideoQuality(nextSettings.videoQuality);
        setCount(nextSettings.count);
        if (nextMode === "image")
            rememberImageSettings({
                model: item.model,
                ratio: nextSettings.ratio,
                quality: nextSettings.quality,
                count: nextSettings.count,
                imageResolution: nextSettings.imageResolution,
                imageParameters: nextSettings.imageParameters,
                transparentBackground: nextSettings.transparentBackground,
            });
        if (nextMode === "video") rememberVideoSettings({ ratio: nextSettings.ratio, seconds: nextSettings.seconds, videoQuality: nextSettings.videoQuality });
    };

    const retryFailedMessage = async (item: CreationMessage, index: number, failedItems?: CreationMessage[]) => {
        const previous =
            item.role === "assistant"
                ? activeConversation?.messages
                      .slice(0, index)
                      .reverse()
                      .find((message) => message.role === "user")
                : item;
        if (!previous || !creationHasInput(previous.mode || "text", previous.content, previous.attachments) || busy) return;
        if (item.mode === "agent" && item.clientOperationId) {
            const scope = getActiveUserScope();
            try {
                const pending = await loadPendingCreationAgentSubmission(activeConversation!.id);
                if (scope !== getActiveUserScope() || activeIdRef.current !== activeConversation!.id) return;
                if (pending) {
                    await submitCreationAgent(previous.content, activeConversation, false, { recoverPending: true });
                    return;
                }
                if (item.agentSubmissionRejected) {
                    restoreMessageDraft({ ...previous, mode: "agent", model: item.model || previous.model });
                    window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                    toast.info("原请求未被受理，已恢复原输入；请确认模型偏好与预算后发送");
                    return;
                }
            } catch (error) {
                if (scope === getActiveUserScope()) toast.error(generationErrorMessage(error));
                return;
            }
        }
        const expectedTaskCount = item.mode === "image" ? item.batchTotal || Number(item.settings?.count) || 1 : 1;
        if ((item.submissionPending || (item.taskIds?.length || 0) < expectedTaskCount) && item.clientOperationId && !item.agentRunId && !item.id.startsWith("task-") && (item.mode === "image" || item.mode === "video")) {
            const scope = getActiveUserScope();
            const originId = activeConversation!.id;
            const key = `submission:${item.clientOperationId}`;
            if (retryPreparingRef.current.has(key)) return;
            retryPreparingRef.current.add(key);
            try {
                const runtime = await loadCreationRuntime();
                if (scope !== getActiveUserScope()) return;
                await recoverCreationGenerationSubmission(runtime, originId, item, async (updater) => {
                    if (scope !== getActiveUserScope()) return;
                    await updateConversationMessage(originId, item.id, updater);
                });
                return;
            } catch (error) {
                if (scope !== getActiveUserScope()) return;
                if (!(error instanceof ApiError && error.reason === "generation_submission_rejected")) {
                    toast.error(generationErrorMessage(error));
                    return;
                }
            } finally {
                retryPreparingRef.current.delete(key);
            }
        }
        if (item.mode === "agent" || item.agentRunId || item.id.startsWith("task-")) {
            let origin = activeConversation;
            const scope = getActiveUserScope();
            const retryKey = `agent:${item.agentRunId || item.id}`;
            if (retryPreparingRef.current.has(retryKey)) return;
            retryPreparingRef.current.add(retryKey);
            try {
                if (!origin?.agentSessionId) {
                    toast.error("缺少原创作会话记录，请从历史对话重新打开后重试");
                    return;
                }
                const projected = await restoreCreationAgentConversation(origin.agentSessionId, creationAgentRecoveryClient);
                if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                origin = mergeCreationAgentConversation(origin, projected);
                updateConversation(origin.id, (current) => mergeCreationAgentConversation(current, projected));
                const run = creationAgentRetryRun(projected, item);
                if (!run) {
                    toast.error("已查询原会话，暂未找到此消息对应的轮次，请从历史对话核对原任务");
                    return;
                }
                const runId = run.id;
                if (run.cleanupPending || ["queued", "running", "waiting_approval"].includes(run.status)) {
                    toast.info(run.status === "waiting_approval" ? "原轮次正在等待审批，请先处理原方案" : "原轮次仍在处理中，已恢复最新状态");
                    return;
                }
                const targets = failedItems || [item];
                if (targets.some((target) => creationAgentRetryRun(projected, target)?.id !== runId || target.status !== "error")) {
                    toast.info("只能重试同一轮中失败的任务");
                    return;
                }
                const targetTaskIds = targets.map((target) => (target.taskIds?.length ? target.taskIds : target.id.startsWith("task-") ? [target.id.slice(5)] : []));
                let taskIds = [...new Set(targetTaskIds.flat())];
                if (!taskIds.length && !failedItems) taskIds = [...new Set((run.events || []).flatMap((event) => (event.type === "generation_task_created" && typeof event.payload.taskId === "string" ? [event.payload.taskId] : [])))];
                if (failedItems && targetTaskIds.some((ids) => !ids.length)) {
                    toast.error("失败项缺少任务记录，请刷新历史后重试");
                    return;
                }
                if (taskIds.length) {
                    const runtime = await loadCreationRuntime();
                    const refreshed = await refreshCreationMessageTasks(runtime, origin, { ...item, taskIds });
                    if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                    updateConversation(origin.id, (current) => mergeCreationAgentConversation(current, refreshed.conversation));
                    taskIds = refreshed.retryableTaskIds;
                    if (!taskIds.length) {
                        toast.info("已刷新原任务状态，进行中、已完成或待恢复的任务不会重复生成");
                        return;
                    }
                    origin = refreshed.conversation;
                } else if (run.status === "completed") {
                    await updateConversationMessage(origin.id, item.id, (current) => ({ ...current, status: "done", agentRunId: runId, error: undefined }));
                    toast.info("原轮次已完成，已恢复最新结果");
                    return;
                }
                if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                await submitCreationAgent("重试失败项", origin, false, { retry: { runId, ...(taskIds.length > 1 ? { taskIds } : taskIds.length ? { taskId: taskIds[0] } : {}) } });
            } catch (error) {
                if (scope === getActiveUserScope()) toast.error(generationErrorMessage(error));
            } finally {
                retryPreparingRef.current.delete(retryKey);
            }
            return;
        }
        const retryOf = item.taskIds?.[0];
        const restoreForRetry = (retryCount?: number, preserveResults = false) => {
            followLatestMessageRef.current = true;
            restoreMessageDraft(retryCount && previous.settings ? { ...previous, settings: { ...previous.settings, count: String(retryCount) } } : previous);
            if (preserveResults) return;
            const removedIds = new Set([item.id, previous.id]);
            updateActive((conversation) => {
                const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
                const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : "新创作", updatedAt: new Date().toISOString(), messages };
            });
        };
        if (!retryOf) {
            const key = `message:${item.id}`;
            if (retryPreparingRef.current.has(key)) return;
            retryPreparingRef.current.add(key);
            restoreForRetry();
            pendingRetryRef.current = { lockKey: key };
            setRetrySequence((current) => current + 1);
            return;
        }
        if (retryPreparingRef.current.has(retryOf)) return;
        retryPreparingRef.current.add(retryOf);
        try {
            const runtime = await loadCreationRuntime();
            const origin = activeConversation;
            const scope = getActiveUserScope();
            if (!origin) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            const refreshed = await refreshCreationMessageTasks(runtime, origin, item);
            if (getActiveUserScope() !== scope || activeIdRef.current !== origin.id) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            if (!refreshed.canRetry) {
                const recovered = refreshed.conversation.messages.find((message) => message.id === item.id);
                if (recovered) await updateConversationMessage(origin.id, item.id, (current) => (JSON.stringify(current.taskIds || []) === JSON.stringify(item.taskIds || []) ? recovered : current));
                retryPreparingRef.current.delete(retryOf);
                toast.info(recovered?.status === "done" ? "已恢复原任务结果" : "原任务仍在处理或保存结果，请稍后查看任务状态");
                return;
            }
            const taskIds = refreshed.retryableTaskIds.length ? refreshed.retryableTaskIds : [...new Set(item.taskIds || [])];
            const attemptGroupId = item.attemptGroupId || item.retryOf || retryOf;
            const context: CreationRetryContext = {
                ...(await runtime.createGenerationRetryContext(taskIds[0], attemptGroupId)),
                ...(taskIds.length > 1 ? { retryContextsByBatchIndex: await runtime.createGenerationBatchRetryContexts(taskIds, attemptGroupId) } : {}),
            };
            if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            const preserveResults = taskIds.length < new Set(item.taskIds).size;
            if (preserveResults) {
                const recovered = refreshed.conversation.messages.find((message) => message.id === item.id);
                if (recovered) await updateConversationMessage(origin.id, item.id, () => recovered);
            }
            restoreForRetry(item.mode === "image" ? taskIds.length : undefined, preserveResults);
            pendingRetryRef.current = { context, lockKey: retryOf };
            setRetrySequence((current) => current + 1);
        } catch (error) {
            retryPreparingRef.current.delete(retryOf);
            toast.error(generationErrorMessage(error));
        }
    };

    // 作品可能已经生成（页面只是没拿到结果，或仍在重连）时，重新生成会提交新任务并再次扣费，先确认。
    const regenerateMessage = (item: CreationMessage, index: number) => {
        if (!creationMessageNeedsResultSync(item) && !(item.syncInterrupted && (item.status === "pending" || item.status === "streaming"))) {
            void retryFailedMessage(item, index);
            return;
        }
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: "作品可能已经生成",
            content: "页面只是没有及时拿到结果，建议先点「重新获取结果」。重新生成会提交新任务并再次扣费。",
            okText: "仍要重新生成",
            cancelText: "先不",
            onOk: () => retryFailedMessage(item, index),
        });
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous =
            item.role === "assistant"
                ? activeConversation?.messages
                      .slice(0, index)
                      .reverse()
                      .find((message) => message.role === "user")
                : item;
        if (!previous || !creationHasInput(previous.mode || "text", previous.content, previous.attachments) || busy) return;
        if (item.mode === "agent" || item.agentRunId || item.id.startsWith("task-")) {
            selectMode("agent");
            setPrompt(previous.content ? `请基于之前的结果创作一个新版本：${previous.content}` : "请基于之前的结果创作一个新版本");
            window.requestAnimationFrame(() => composerFocusRef.current?.focus());
            return;
        }
        restoreMessageDraft(previous);
    };

    const resultImageAttachment = (image: CreationResultImageRef, size?: CreationPixelSize): CreationAttachment => {
        const url = resolveResourceUrl(image.storageKey, image.url);
        return { id: `result:${image.storageKey || image.url}`, name: `生成结果 ${image.index + 1}`, type: "image/png", dataUrl: url, url, storageKey: image.storageKey, previewUrl: image.url || url, ...size };
    };
    const fillComposerWithImage = (attachment: CreationAttachment, starter: string) => {
        const next = [...attachmentsRef.current.filter((item) => item.id !== attachment.id), attachment];
        attachmentsRef.current = next;
        setAttachments(next);
        if (starter && !promptRef.current.trim()) {
            promptRef.current = starter;
            setPrompt(starter);
        }
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };
    const savedImageSettings = (): CreationImageSettingsPatch => {
        const saved = useCreationPreferencesStore.getState().preferences.image;
        return { ratio: saved?.ratio, quality: saved?.quality, imageResolution: saved?.imageResolution };
    };
    // 图上工具确认后直接生成：参考图按弹窗给的顺序准备好（结果图本身不重传，扩图底图和标注图先上传），
    // 再按工具选的模型、尺寸和数量交给 submit。工具不改输入框：不写图片偏好，提交发出后切回原来的创作类型。
    // 失败原因抛回弹窗，用户改完可以直接重试。
    const runImageTool = async (image: CreationResultImageRef, request: CreationImageToolRequest) => {
        if (busy || resultImagePreparingRef.current) throw new Error("上一条还在提交，请稍候再试");
        if (!request.model) throw new Error("请先在设置中配置图片模型");
        const profile = modelCapabilityConfigFor(config, request.model).image;
        const maxImages = profile?.references.maxImages ?? 0;
        if (maxImages < 1) throw new Error("当前图片模型不支持参考图编辑，请换一个支持图片编辑的模型");
        if (request.references.length > maxImages) throw new Error(`当前图片模型最多接收 ${maxImages} 张参考图，请换一个模型`);
        resultImagePreparingRef.current = true;
        try {
            const requestAttachments: CreationAttachment[] = [];
            for (const reference of request.references) {
                if (reference.kind === "source") {
                    requestAttachments.push(resultImageAttachment(image, reference.size));
                    continue;
                }
                const { attachment } = await uploadCreationAsset(reference.file);
                requestAttachments.push({ ...attachment, name: reference.name, ...reference.size });
            }
            const saved = savedImageSettings();
            const remembered = useCreationPreferencesStore.getState().preferences.image;
            const size = request.size.ratio || saved.ratio || ratio;
            const imageCount = Math.max(1, Math.min(profile?.maxOutputs || 1, Math.floor(request.count || 1)));
            pendingGenerationOverrideRef.current = {
                itemId: "",
                queuePosition: 0,
                queueSize: 0,
                source: "create-page",
                prompt: request.prompt,
                displayPrompt: request.displayPrompt,
                attachments: requestAttachments,
                ...(request.mask && profile?.references.maskSupported ? { mask: { id: `${request.tool}-mask`, name: "mask.png", type: "image/png", dataUrl: request.mask } } : {}),
                imageCount,
                settings: { model: request.model, size, aspectRatio: size, quality: request.size.quality || saved.quality || quality, count: imageCount },
                imageResolution: request.size.imageResolution || saved.imageResolution || imageResolution,
                imageParameters: JSON.stringify(normalizeImageParameters(profile?.parameters, remembered?.model === request.model ? remembered.imageParameters : undefined)),
                // 只有去除背景要透明底；其他工具不沿用输入框里的透明背景开关。
                transparentBackground: request.transparentBackground ? "true" : "false",
                restoreMode: mode === "image" ? undefined : mode,
            };
            setMode("image");
            setGenerationOverrideSequence((current) => current + 1);
        } finally {
            resultImagePreparingRef.current = false;
        }
    };
    // 重做：原提示词（弹窗里可能改过）、原参考图按弹窗选的模型、尺寸和张数重新生成一次，结果接在对话末尾。
    // 参考图都已是素材库资源，不重新上传；所选模型按尺寸和参考图数量落到同名组里能接的那个。和图上工具一样不改输入框。
    const runImageRedo = async (request: CreationImageRedoRequest) => {
        if (busy || resultImagePreparingRef.current) throw new Error("上一条还在提交，请稍候再试");
        if (!request.model) throw new Error("请先在设置中配置图片模型");
        if (!request.prompt.trim()) throw new Error("请填写提示词");
        const referenceCount = request.attachments.length;
        const requirements = creationImageRedoRequirements(config, request.model, request.settings, request.count, referenceCount);
        const model = resolveCompatibleModel(config, request.model, requirements) || request.model;
        const profile = modelCapabilityConfigFor(config, model).image;
        const maxImages = profile?.references.maxImages ?? 0;
        if (referenceCount > maxImages) throw new Error(maxImages < 1 ? "当前图片模型不支持参考图，这张图用了参考图，请换一个模型" : `当前图片模型最多接收 ${maxImages} 张参考图，这张图用了 ${referenceCount} 张，请换一个模型`);
        const imageCount = Math.max(1, Math.min(profile?.maxOutputs || 1, Math.floor(request.count || 1)));
        pendingGenerationOverrideRef.current = {
            itemId: "",
            queuePosition: 0,
            queueSize: 0,
            source: "create-page",
            prompt: request.prompt,
            attachments: request.attachments,
            references: request.references,
            imageCount,
            settings: { model, size: request.settings.ratio, aspectRatio: request.settings.ratio, quality: request.settings.quality, count: imageCount },
            imageResolution: request.settings.imageResolution,
            imageParameters: request.settings.imageParameters,
            transparentBackground: request.settings.transparentBackground,
            restoreMode: mode === "image" ? undefined : mode,
        };
        setMode("image");
        setGenerationOverrideSequence((current) => current + 1);
    };
    // 裁剪、宫格切分不调用模型：结果上传后和「作为参考」一样放进输入框；超出当前模型参考上限的部分不加入、不上传。
    const addToolImagesToComposer = async (files: File[], label: string) => {
        const capacity = Math.max(0, maxReferences - attachmentsRef.current.length);
        if (!capacity) throw new Error("输入框里的参考内容已达到当前模型上限，请先移除一些再放入");
        const accepted = files.slice(0, capacity);
        const uploaded = await Promise.all(accepted.map((file) => uploadCreationAsset(file)));
        const added = uploaded.map(({ attachment }, index) => ({ ...attachment, name: accepted.length > 1 ? `${label} ${index + 1}` : label }));
        const candidates = [...attachmentsRef.current, ...added];
        const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
        attachmentsRef.current = reconciled.attachments;
        setAttachments(reconciled.attachments);
        const kept = added.filter((attachment) => reconciled.attachments.includes(attachment)).length;
        if (kept < files.length) toast.warning(`已放入 ${kept} 张，其余超出当前模型的参考图上限`);
        else toast.success(kept > 1 ? `已把 ${kept} 张图放进输入框作为参考` : "已放进输入框作为参考");
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };
    // 文字编辑、反推提示词：用输入框的文本模型看这张图，返回模型原文，由弹窗解析和展示。
    const describeResultImage = async (image: CreationResultImageRef, instruction: string, purpose: CreationImageDescribePurpose, signal: AbortSignal) => {
        const model = config.textModel;
        if (!model) throw new Error("请先在设置中配置文本模型");
        const inputError = creationAgentImageInputError(config, model, 1);
        if (inputError) throw new Error(inputError);
        const runtime = await loadCreationRuntime();
        const { referenceImages } = splitCreationAttachments([resultImageAttachment(image)]);
        const result = await runtime.runBackendGenerationTask({
            mode: "text",
            prompt: instruction,
            config: { ...config, model, textModel: model },
            referenceImages,
            signal,
            metadata: { source: "create-page", edit: purpose, ...(activeConversation ? { conversationId: activeConversation.id } : {}) },
        });
        const text = String(result.text || "").trim();
        if (!text) throw new Error("模型没有返回内容，请重试");
        return text;
    };
    const fillComposerPrompt = (text: string) => {
        if (promptRef.current.trim()) toast.info("已用反推结果替换输入框里的文字");
        promptRef.current = text;
        setPrompt(text);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };
    // 转视频要用能收参考图的视频模型：当前视频模型不行时换成第一个支持图生视频的模型。
    const imageToVideoModel = () => {
        const accepts = (model: string) => Boolean(model) && (modelGroupReferenceLimits(config, model, "video")?.maxImages || 0) > 0;
        if (accepts(config.videoModel)) return config.videoModel;
        return selectableModelsByCapability(config, "video").find(accepts) || "";
    };

    // 结果图上的操作条（参考即梦）。作为参考：把这张图放进输入框；转视频：切到视频生成，带上这张图和一句提示词开头。
    // 两者都不覆盖已经写好的提示词。其余工具先打开弹窗，选好参数后直接生成，结果接在对话末尾。
    const reuseResultImage: CreationResultImageHandler = (image, intent) => {
        if (!image.url && !image.storageKey) return;
        if (isCreationImageToolIntent(intent)) {
            setImageToolTarget({ tool: intent, image, url: resolveResourceUrl(image.storageKey, image.url) });
            return;
        }
        if (busy) return;
        if (intent === "video") {
            const videoModel = imageToVideoModel();
            if (!videoModel) return void toast.warning("还没有能用图片生成视频的模型，请先在设置里配置图生视频模型");
            selectMode("video");
            if (videoModel !== config.videoModel) updateConfig("videoModel", videoModel);
            fillComposerWithImage(resultImageAttachment(image), "让画面动起来：镜头缓慢推近，人物和场景保持不变");
            return;
        }
        fillComposerWithImage(resultImageAttachment(image), "");
    };
    // 结果下方的「重做」：行里能还原出原提示词时才给入口；点了按当前对话和技能还原，弹窗里展示的是点击时看到的那张图。
    const openResultRedo = (item: CreationMessage, image: CreationResultImageRef) => {
        const source = activeConversation ? creationImageRedoSource(activeConversation.messages, item, addedSkills) : undefined;
        if (source) setImageRedoTarget({ image, url: resolveResourceUrl(image.storageKey, image.url), source });
    };

    useCreationHomeNavigation(hydrated && composerPreferencesHydrated, startNewConversation);

    // 对话行收到的操作身份始终不变，行组件才能在输入框打字时跳过重新渲染；调用时转给最新一次提交的处理函数和对话。
    const threadHandlers = {
        activeConversation,
        regenerateMessage,
        refreshMessageResult,
        recoverMessageMedia,
        interjectCreationAgent,
        createVariant,
        retryFailedMessage,
        decideCreationApproval,
        modifyCreationPlan,
        updateCreationApprovalItems,
        continueOnCanvas,
        reuseResultImage,
        openResultRedo,
        submitCreationAgent,
        restoreMessageDraft,
    };
    const threadHandlersRef = useRef(threadHandlers);
    useLayoutEffect(() => {
        threadHandlersRef.current = threadHandlers;
    });
    const threadActions = useMemo<CreationThreadActions>(() => {
        const latest = () => threadHandlersRef.current;
        const messageIndex = (item: CreationMessage) => latest().activeConversation?.messages.findIndex((message) => message.id === item.id) ?? -1;
        return {
            regenerate: (item) => {
                const index = messageIndex(item);
                if (index >= 0) latest().regenerateMessage(item, index);
            },
            refreshResult: (item) => void latest().refreshMessageResult(item),
            recoverMedia: (item) => void latest().recoverMessageMedia(item),
            queryInterjection: async (message) => {
                const { activeConversation: conversation, interjectCreationAgent: interject } = latest();
                const current = conversation && conversationsRef.current.find((candidate) => candidate.id === conversation.id);
                if (current) await interject(current, message.content, message.id);
            },
            createVariant: (item) => {
                const index = messageIndex(item);
                if (index >= 0) latest().createVariant(item, index);
            },
            refreshAgentTasks: () => setAgentTaskRecoveryEpoch((value) => value + 1),
            retryAgentTasks: async (tasks) => {
                const index = messageIndex(tasks[0]);
                if (index >= 0) await latest().retryFailedMessage(tasks[0], index, tasks);
            },
            decideApproval: (decision, options) => latest().decideCreationApproval(decision, options),
            modifyPlan: (notes) => latest().modifyCreationPlan(notes),
            updateApprovalItems: (edits) => latest().updateCreationApprovalItems(edits),
            focusComposer: () => composerFocusRef.current?.focus(),
            continueCanvas: (ids) => void latest().continueOnCanvas(ids),
            reuseResultImage: (image, intent) => latest().reuseResultImage(image, intent),
            redo: (item, image) => latest().openResultRedo(item, image),
            answerQuestion: (answer) => latest().submitCreationAgent(answer, undefined, false, { inheritAttachments: true }),
            editUserMessage: (message) => {
                latest().restoreMessageDraft(message);
                window.requestAnimationFrame(() => composerFocusRef.current?.focus());
            },
        };
    }, []);

    if (conversationRoute.loading)
        return (
            <div className="grid h-full place-items-center" role="status">
                <Spin tip="正在打开会话…" />
            </div>
        );
    if (conversationRoute.error)
        return (
            <div className="grid h-full place-content-center gap-4 text-center">
                <h2>无法打开会话</h2>
                <p role="alert">{conversationRoute.error}</p>
                <p>请确认链接及登录账号。会话可能已删除或已超过保留期限。</p>
                <button type="button" onClick={startNewConversation}>
                    开始新创作
                </button>
            </div>
        );
    if (!hydrated || !activeConversation)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );

    const handleThreadScroll = () => {
        const container = threadScrollRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        followLatestMessageRef.current = distanceFromBottom <= 160;
        // 往上翻看超过一屏的三分之一才出现"回到最新"，贴近底部时自动收起。
        const jumpVisible = !isEmpty && distanceFromBottom > Math.max(320, container.clientHeight / 3);
        setShowJumpToLatest((current) => (current === jumpVisible ? current : jumpVisible));
        if (isEmpty) {
            // Keep the original editor in flow: changing its height here feeds
            // scroll anchoring back into this handler and causes flicker.
            const bottom = launchpadRef.current?.getBoundingClientRect().bottom;
            if (bottom === undefined) return;
            const remaining = bottom - container.getBoundingClientRect().top;
            if (remaining < -16) setLaunchpadCondensed(true);
            else if (remaining > 24 || container.scrollTop <= 24) setLaunchpadCondensed(false);
        }
    };

    const canStopAgent = creationAgentRunsToStop(activeConversation).length > 0;
    // 这一轮 Agent 还在进行或正在清理：旧消息的重试先禁用，提问卡也不再算作待回答。
    const agentRunActive = Boolean(activeAgentRun && (activeAgentRun.cleanupPending || ["queued", "running", "waiting_approval"].includes(activeAgentRun.status)));
    const generationActive = canStopAgent || activeConversation.messages.some((message) => message.role === "assistant" && message.status === "pending");
    const startPrompt = (nextMode: CreationMode, nextPrompt: string) => {
        selectMode(nextMode);
        setPrompt(nextPrompt);
        threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
        window.requestAnimationFrame(() => composerFocusRef.current?.focus({ preventScroll: true }));
    };
    startPromptRef.current = startPrompt;


    const composerProps = {
        mode,
        prompt,
        setPrompt,
        busy,
        generationActive,
        agentInterjectionStatus: creationAgentInterjectionRun(activeConversation)?.status as "queued" | "running" | "waiting_approval" | undefined,
        stopping: stoppingConversationId === activeConversation.id,
        onStop: canStopAgent
            ? () => {
                  void stopCreationGeneration();
              }
            : undefined,
        referenceReplacementBusy,
        referencePasteBusy,
        attachments,
        referenceImageSize,
        maxReferences,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        onClearComposer: clearComposer,
        onReorderAttachments: reorderAttachments,
        onReplaceAttachment: replaceReferenceFromTrack,
        onReplaceReferenceFiles: replaceReferenceFromFiles,
        onPasteFiles: (files: File[]) => {
            void addPastedReferenceFiles(files);
        },
        // 参考素材入口：上传的图片和粘贴一样先存进素材库再加入本轮；游客在弹出文件选择前先登录。
        onBeforeUpload: () => {
            if (smartCreationUserId) return true;
            openLoginModal({ description: "登录后即可上传参考图，你的输入会保留" });
            return false;
        },
        onUploadFiles: (files: File[]) => {
            void addPastedReferenceFiles(files);
        },
        referenceSignInRequired: !smartCreationUserId,
        // 生成结果拖进输入框：落在某张参考图上替换那一张，否则和「作为参考」一样加到最后。
        onDropResultImage: (image: CreationResultImageRef, targetAttachmentId?: string) => {
            if (busy || (!image.url && !image.storageKey)) return;
            const attachment = resultImageAttachment(image);
            if (targetAttachmentId) replaceReferenceFromTrack(targetAttachmentId, attachment);
            else fillComposerWithImage(attachment, "");
        },
        onOpenLibrary: () => {
            if (!smartCreationUserId) {
                openLoginModal({ description: "登录后即可从素材库选择参考图，你的输入会保留" });
                return;
            }
            setLibraryOpen(true);
        },
        onModeChange: selectMode,
        model: selectedModel,
        modelRequirements,
        imageProfile,
        videoProfile,
        config: generationConfig,
        onModelChange: (value: string) => {
            if (mode === "audio" && value !== selectedModel) setAudioSettings({});
            updateConfig(creationModelKey(mode), value);
        },
        audioConfig,
        onAudioSettingChange: (key: CanvasAudioSettingKey, value: string) => setAudioSettings((current) => ({ ...current, [key]: value })),
        ratio,
        setRatio: setComposerRatio,
        seconds,
        setSeconds: setComposerSeconds,
        quality,
        setQuality: setComposerQuality,
        imageResolution,
        setImageResolution: setComposerImageResolution,
        imageParameters,
        setImageParameters: (value: string) => {
            setImageParameters(value);
            rememberImageSettings({ model: selectedModel, imageParameters: value });
        },
        setTransparentBackground: (value: string) => rememberImageSettings({ transparentBackground: value }),
        videoQuality,
        setVideoQuality: setComposerVideoQuality,
        count,
        setCount: setComposerCount,
        textStreaming,
        setTextStreaming,
        textThinking,
        setTextThinking,
        agentWebSearch,
        onAgentWebSearchChange: setAgentWebSearch,
        agentWebSearchAvailable: webSearchAvailable,
        agentWebSearchPriceMicrocredits: webSearchPriceMicrocredits ?? undefined,
        promptOptimizerProvider,
        smartCreationAvailable: Boolean(smartCreationProvider),
        smartCreationActive,
        smartCreationPlanning,
        onToggleSmartCreation: () => setSmartCreationActive((active) => !active),
        composerFocusRef,
        onPromptFocus: loadAddedSkills,
        // Agent 工具栏的「技能」。
        skillPicker: creationAgentSurface
            ? {
                  skills: creationSkills,
                  library: addedSkills,
                  status: skillsStatus,
                  signInRequired: !smartCreationUserId,
                  onRefresh: refreshAddedSkills,
                  onSignIn: () => openLoginModal({ description: "登录后即可使用技能" }),
              }
            : undefined,
        // 不带参数调用 submit：发送键的点击事件不能被当成重试上下文。「画布」面没有输入框，发送只会走这里。
        onSubmit: () => void submit(),
        agentPermissionMode,
        onAgentPermissionChange: setAgentPermissionMode,
        agentOutputPreference,
        onAgentOutputPreferenceChange: rememberOutputPreference,
        agentReasoningMode,
        onAgentReasoningModeChange: setAgentReasoningMode,
        agentContextView,
        agentInputError,
        agentImageModel: config.imageModel,
        agentEstimateCredits,
        agentImageSelectionMode,
        agentVideoSelectionMode,
        onAgentImageSelectionModeChange: setAgentImageSelectionMode,
        onAgentVideoSelectionModeChange: setAgentVideoSelectionMode,
        agentVideoModel: config.videoModel,
        onAgentImageModelChange: (value: string) => updateConfig("imageModel", value),
        onAgentVideoModelChange: (value: string) => updateConfig("videoModel", value),
        agentImageParameterMode,
        agentVideoParameterMode,
        onAgentImageParameterModeChange: setAgentImageParameterMode,
        onAgentVideoParameterModeChange: setAgentVideoParameterMode,
        agentMaxCredits: agentBudget.maxCredits,
        agentMaxGenerationTasks: agentBudget.maxGenerationTasks,
        agentMaxVideoSeconds: agentBudget.maxVideoSeconds,
        onAgentBudgetChange: (key: "maxCredits" | "maxGenerationTasks" | "maxVideoSeconds", value: number) => setAgentBudget((current) => ({ ...current, [key]: value })),
        agentImageSize: agentImageSettings.size,
        agentImageQuality: agentImageSettings.quality,
        agentImageCount: agentImageSettings.count,
        agentVideoSize: agentVideoSettings.size,
        agentVideoQuality: agentVideoSettings.quality,
        agentVideoSeconds: agentVideoSettings.durationSeconds,
        onAgentImageSettingChange: (key: "size" | "quality" | "count", value: string | number) => setAgentImageSettings((current) => ({ ...current, [key]: value })),
        onAgentVideoSettingChange: (key: "size" | "quality" | "durationSeconds", value: string | number) => setAgentVideoSettings((current) => ({ ...current, [key]: value })),
    };

    return (
        <>
            <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
                {cloudHistoryError ? (
                    <div className="creation-agent-connection-error" role="status">
                        <span>{cloudHistoryError}</span>
                        <button
                            type="button"
                            onClick={() => {
                                cloudHistoryFingerprintsRef.current.clear();
                                forgetSyncedCreationHistory();
                                setConversations([...conversationsRef.current]);
                            }}
                        >
                            重试同步
                        </button>
                    </div>
                ) : null}
                {pendingApproval ? (
                    <div className="creation-agent-pending-notice" role="status">
                        <span>
                            有 {pendingApprovals.length} 个方案需要你确认 · {pendingApproval.title}
                        </span>
                        <button
                            type="button"
                            onClick={async () => {
                                if (pendingApproval.id !== activeConversation.id) await selectConversation(pendingApproval);
                                window.requestAnimationFrame(() => {
                                    revealThreadMessages();
                                    document.getElementById(`creation-shot-${pendingApproval.agentRunId}:assistant`)?.scrollIntoView({ block: "end", behavior: reducedMotion ? "auto" : "smooth" });
                                });
                            }}
                        >
                            查看方案
                        </button>
                    </div>
                ) : null}
                {isEmpty ? (
                    <>
                        <CreationGridBackdrop paused={launchpadCondensed} />
                        <AnimatePresence>
                            {/* 浮动的快捷提示词只服务「生成」面的输入框；「画布」面没有输入框，不出现。 */}
                            {launchpadCondensed && creationSurface === "generate" ? (
                                <motion.div
                                    className="creation-floating-prompt"
                                    key="floating-prompt"
                                    style={{ x: "-50%" }}
                                    initial={{ opacity: 0, y: -12, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                                    transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32, mass: 0.8 }}
                                >
                                    <CreationTypeIcon name="agent" />
                                    <input aria-label="快捷编辑提示词" placeholder="接着描述你的想法…" value={prompt} disabled={busy || referenceReplacementBusy} onChange={(event) => setPrompt(event.target.value)} />
                                    <Tooltip title="展开完整创作区">
                                        <button
                                            type="button"
                                            aria-label="展开完整创作区"
                                            onClick={() => {
                                                threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
                                                composerFocusRef.current?.focus({ preventScroll: true });
                                            }}
                                        >
                                            <Maximize2 />
                                        </button>
                                    </Tooltip>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-home-scroll creation-scrollbar">
                            <section ref={launchpadRef} className={cn("creation-launchpad", creationSurface === "canvas" && "is-canvas-surface")} aria-label="开始创作">
                                <header className="creation-start-heading">
                                    <div>
                                        <h1>{creationCopy.title}</h1>
                                        {creationCopy.description ? <p>{creationCopy.description}</p> : null}

                                    </div>
                                    <button type="button" className="creation-history-entry" aria-label="查看历史对话" aria-expanded={historyOpen} onClick={openHistory}>
                                        <History aria-hidden="true" />
                                        <span>历史对话</span>
                                    </button>
                                </header>
                                <CreationSurfaceSwitch value={creationSurface} onChange={selectCreationSurface} disabled={openingCanvas} />
                                {creationSurface === "generate" ? (
                                    <>
                                        <div className="creation-composer-stage is-home-mode">
                                            <div className="creation-empty-composer">
                                                <CreationComposer {...composerProps} variant="empty" />
                                            </div>
                                        </div>
                                        <CreationPlayStrip onStartPrompt={startPrompt} />
                                    </>
                                ) : null}
                            </section>
                            {creationSurface === "canvas" ? (
                                // 画布面（参考 kunrouai.com/?mode=canvas）：输入框、玩法条和灵感库换成「新建画布」+ 最近画布，下面是首页同一套「精选画布」。
                                <div className="creation-canvas-surface">
                                    <Suspense
                                        fallback={
                                            <div className="creation-canvas-start" role="status" aria-label="正在准备画布">
                                                <ul className="creation-canvas-start-grid" aria-hidden="true">
                                                    {Array.from({ length: 4 }, (_, index) => (
                                                        <li key={index} className="creation-canvas-tile is-placeholder" />
                                                    ))}
                                                </ul>
                                            </div>
                                        }
                                    >
                                        <CreationCanvasStart />
                                    </Suspense>
                                    <Suspense
                                        fallback={
                                            <div className="creation-hall-loading" role="status">
                                                正在准备精选画布…
                                            </div>
                                        }
                                    >
                                        <CreationFeaturedCanvases />
                                    </Suspense>
                                </div>
                            ) : (
                                <>
                                    {inspirationHallReady ? <Suspense fallback={inspirationHallPlaceholder}>{inspirationHall}</Suspense> : inspirationHallPlaceholder}
                                    {inspirationSourcesVisible ? (
                                        <div className="creation-source-notice">
                                            <details>
                                                <summary>素材来源</summary>
                                                {declaredInspirationSources().map((source) => (
                                                    <p key={source.name ?? source.label}>
                                                        {source.notice}
                                                        {source.repository ? (
                                                            <>
                                                                {" "}
                                                                <a href={source.repository} target="_blank" rel="noreferrer">
                                                                    {source.name} · {source.license}
                                                                </a>
                                                            </>
                                                        ) : null}
                                                    </p>
                                                ))}
                                            </details>
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </main>
                    </>
                ) : (
                    <div className="creation-thread-workbench">
                        <CreationAmbientBackdrop url={latestCreationResultImage(activeConversation.messages)} />
                        <CreationWorkspaceToolbar onNewConversation={startNewConversation} onOpenHistory={openHistory} shots={videoShots} onJumpToShot={jumpToShot} onContinueCanvas={() => void continueOnCanvas()} openingCanvas={openingCanvas} />
                        {agentPlanSource ? <CreationAgentPlanPanel key={activeConversation.id} items={agentPlanSource.items} phase={agentPlanSource.phase} defaultOpen={planPanelDefaultOpen} /> : null}
                        <main ref={attachThreadScroll} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                            <section className="creation-thread-stage">
                                <div className="creation-results">
                                    {threadRows.map(({ item, agentTasks, previousUser }) => {
                                        const currentAgentReply = item.mode === "agent" && item.agentRunId === activeConversation.agentRunId;
                                        // 方案、审批这些只有 Agent 回复用得到；其他行传固定值，审批状态变化时不必跟着重新渲染。
                                        const agentReply = item.mode === "agent" && !item.agentContinuation;
                                        return (
                                            <CreationThreadRow
                                                key={item.id}
                                                item={item}
                                                agentTasks={agentTasks}
                                                previousUser={previousUser}
                                                shotNumber={creationVideoShotOrdinal(videoShots, item)}
                                                submitting={submittingMessageIds.has(item.id)}
                                                refreshingResult={resultRefreshIds.has(item.id)}
                                                taskSyncFailed={agentTasks.some((task) => task.taskIds?.some((id) => agentTaskSyncFailures.has(id)))}
                                                outputPreference={agentOutputPreference}
                                                retryDisabled={busy || agentRunActive}
                                                currentReply={currentAgentReply}
                                                approval={currentAgentReply ? activeConversation.agentApproval : undefined}
                                                activeApprovalId={currentAgentReply && activeAgentRun?.status === "waiting_approval" ? activeConversation.agentApproval?.approvalId : undefined}
                                                approvalBusy={agentReply && agentApprovalSubmitting}
                                                approvalChanged={agentReply && agentApprovalSettingsChanged}
                                                approvalInProposals={agentReply && Boolean(activeConversation.agentApproval?.preview?.proposals?.length)}
                                                planItemsHidden={item.id === agentPlanSource?.reply.id}
                                                proposalOptions={agentReply && item.agentProposalSets?.length ? agentProposalOptions : undefined}
                                                openingCanvas={openingCanvas}
                                                referenceActionFirst={mode === "agent"}
                                                questionPending={Boolean(currentAgentReply && item.agentQuestion && !agentRunActive)}
                                                questionDisabled={busy}
                                                actions={threadActions}
                                            />
                                        );
                                    })}
                                    {agentConnectionError && activeConversation.agentRunId ? (
                                        <div role="status" className="creation-agent-connection-error">
                                            <span>Agent 连接中断，服务端运行仍保留：{agentConnectionError}</span>
                                            <button type="button" onClick={() => setAgentConnectionEpoch((value) => value + 1)}>
                                                重新连接
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </section>
                        </main>
                        <section className="creation-thread-composer">
                            {showJumpToLatest ? (
                                <button
                                    type="button"
                                    className="creation-jump-latest"
                                    onClick={() => {
                                        const container = threadScrollRef.current;
                                        followLatestMessageRef.current = true;
                                        setShowJumpToLatest(false);
                                        revealThreadMessages();
                                        container?.scrollTo({ top: container.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
                                    }}
                                >
                                    <ArrowDown aria-hidden="true" />
                                    回到最新
                                </button>
                            ) : null}
                            <CreationComposer {...composerProps} variant="thread" />
                        </section>
                    </div>
                )}
            </div>
            {historyDrawerMounted ? (
                <CreationHistoryDrawer
                    open={historyOpen}
                    deleteConfirmOpen={historyDeleteOpen}
                    conversations={historyConversations}
                    activeId={activeConversation.id}
                    loading={historyLoading}
                    syncError={historySyncError}
                    retentionDays={conversationRetentionDays}
                    onCopyLink={copyConversationLink}
                    onRefresh={refreshHistory}
                    onNew={startNewConversation}
                    onClose={() => {
                        cancelHistorySelection();
                        setHistoryOpen(false);
                    }}
                    onSelect={selectConversation}
                    onDelete={confirmDeleteConversation}
                    onRename={renameConversationTitle}
                />
            ) : null}
            {libraryOpen ? (
                <Suspense fallback={null}>
                    <AssetLibraryPickerModal
                        remoteLibrary
                        acceptRemoteItems
                        remoteItemDisabledReason={(asset) => creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits)}
                        open={libraryOpen}
                        items={libraryItems}
                        categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
                        folders={externalAssetSources.folders}
                        initialSelectedIds={attachments.flatMap((item) => (item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : []))}
                        upload={{
                            accept: creationUploadAccept(mode),
                            description: mode === "text" ? "支持图片、视频、音频和常用文档；媒体会保存到素材库" : `支持图片${mode === "video" ? "、视频和音频" : ""}，上传后保存到素材库`,
                            onUpload: uploadLibraryAssets,
                            external: { accept: "image/*", description: "写入当前 Eagle 文件夹；Eagle 当前支持图片文件", onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) },
                        }}
                        onClose={() => setLibraryOpen(false)}
                        onConfirm={handleLibrarySelect}
                    />
                </Suspense>
            ) : null}
            {imageToolTarget ? (
                <Suspense fallback={null}>
                    <CreationImageToolDialog
                        key={`${imageToolTarget.tool}:${imageToolTarget.image.storageKey || imageToolTarget.url}`}
                        target={imageToolTarget}
                        config={config}
                        savedSettings={savedImageSettings()}
                        onClose={() => setImageToolTarget(null)}
                        onGenerate={async (request) => {
                            await runImageTool(imageToolTarget.image, request);
                            setImageToolTarget(null);
                        }}
                        onUseImages={async (files, label) => {
                            await addToolImagesToComposer(files, label);
                            setImageToolTarget(null);
                        }}
                        onDescribe={(instruction, purpose, signal) => describeResultImage(imageToolTarget.image, instruction, purpose, signal)}
                        onFillPrompt={(text) => {
                            fillComposerPrompt(text);
                            setImageToolTarget(null);
                        }}
                    />
                </Suspense>
            ) : null}
            {imageRedoTarget ? (
                <Suspense fallback={null}>
                    <CreationImageRedoDialog
                        key={`redo:${imageRedoTarget.image.storageKey || imageRedoTarget.url}`}
                        target={imageRedoTarget}
                        config={config}
                        onClose={() => setImageRedoTarget(null)}
                        onGenerate={async (request) => {
                            await runImageRedo(request);
                            setImageRedoTarget(null);
                        }}
                    />
                </Suspense>
            ) : null}
        </>
    );
}
