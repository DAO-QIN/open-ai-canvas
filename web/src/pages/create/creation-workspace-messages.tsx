import { usableResultUrl, creationResultEntries } from "./creation-result-urls";
import { CreationResultImage } from "./creation-result-image";
import { conversationTimeFormatter, type CreationMessage } from "./creation-types";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, FileText, Film, Image as ImageIcon, Maximize2, Music2, Pencil, RefreshCw, UserRound, X, AlertCircle, AlertTriangle, CircleStop, CloudOff, ImageOff, RotateCcw, type LucideIcon, Blocks, Orbit } from "lucide-react";
import { CreationIcon, type CreationIconName } from "./creation-icons";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingDots } from "@/components/ai/working-indicator";
import { UserAvatar } from "@/components/layout/user-avatar";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { generationErrorMessage } from "@/lib/generation-error";
import { useEffect, useId, useState, type ReactNode, type CSSProperties } from "react";
import { AgentOutputPreference } from "@/services/api/agent";
import { useCopyText } from "@/hooks/use-copy-text";
import { type CreationReference, displayCreationPrompt } from "./creation-references";
import { useUserStore } from "@/stores/use-user-store";
import { type CreationAttachment, creationAttachmentKind, creationMediaAspectRatio, type CreationMode } from "./creation-assets";
import { getResourceAccess, resolveResourceAccessURL, resolveResourceUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useAssetStore, type Asset, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { creationResultAssetIds, creationResultStorageKeys } from "@/lib/canvas/canvas-asset-handoff";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { Button } from "antd";
import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppModal } from "@/components/ui/product/app-modal";
import { creationAgentLatestMediaTasks, projectCreationAgentMediaBatches } from "./creation-agent-conversation";
import { saveAs } from "file-saver";
import { createCreationImagesZip, creationImageDownloadBaseName, creationImagesZipName, downloadCreationImage } from "./creation-media-download";
import { creationMessageNeedsResultSync } from "./creation-conversations";
import { GenerationPhaseSteps } from "@/components/ai/generation-phase-steps";
import { generationPhaseHint, generationPhaseLabel, generationPhaseStep, generationTaskPhase, generationTaskSavingState, generationTaskShowsProgress, type GenerationPhase } from "@/lib/generation-task-display";
import { useTaskElapsed } from "@/hooks/use-task-elapsed";
import "./creation-results.css";
// 创作页消息流：用户消息、媒体结果、生成中占位、引用素材与预览。


const SkillGlyph = () => <CreationIcon name="skill" />;

export function CreationMessageView({
    item,
    shotNumber,
    onRefreshResult = () => {},
    onRecoverMedia = () => {},
    refreshingResult = false,
    onRetryFailure,
    onCreateVariant,
    onEditUserMessage,
    onContinueCanvas,
    openingCanvas,
    agentReview,
    agentTasks,
    outputPreference = "detailed",
    onRetryAgentTasks,
    taskSyncFailed = false,
    onRefreshAgentTasks,
    retryDisabled = false,
    onCreateAgentTaskVariant,
    onQueryInterjection,
    onUseResultImage,
    submitting = false,
    nested = false,
}: {
    item: CreationMessage;
    shotNumber: number;
    onRetryFailure: () => void | Promise<void>;
    onRefreshResult?: () => void;
    onRecoverMedia?: () => void;
    refreshingResult?: boolean;
    onCreateVariant: () => void;
    onEditUserMessage: (message: CreationMessage) => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
    agentReview?: ReactNode;
    agentTasks?: CreationMessage[];
    outputPreference?: AgentOutputPreference;
    onRetryAgentTasks?: (tasks: CreationMessage[]) => void | Promise<void>;
    taskSyncFailed?: boolean;
    onRefreshAgentTasks?: () => void;
    retryDisabled?: boolean;
    onCreateAgentTaskVariant?: (task: CreationMessage) => void;
    onQueryInterjection?: (message: CreationMessage) => Promise<void>;
    /** 结果图上的操作条：变体、转视频、作为参考。不传则不显示。 */
    onUseResultImage?: CreationResultImageHandler;
    submitting?: boolean;
    nested?: boolean;
}) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const assistantName = useAppearanceStore((state) => state.appearance.canvas?.agentName || state.appearance.brandName);
    const [replyExpanded, setReplyExpanded] = useState(false);
    const [retryPending, setRetryPending] = useState(false);
    const replyId = useId();
    useEffect(() => {
        setReplyExpanded(false);
    }, [item.id]);
    if (item.role === "user") return <CreationUserMessage item={item} shotNumber={shotNumber} onEditUserMessage={onEditUserMessage} onQueryInterjection={onQueryInterjection} />;
    const mode = item.mode || "text";
    const compactOutput = mode === "agent" && !item.agentContinuation && outputPreference === "concise";
    const mediaTasks = creationAgentLatestMediaTasks(item.agentContinuation ? [] : agentTasks || []);
    const pendingTaskStates = mediaTasks.filter((task) => task.agentRunId === item.agentRunId && task.taskStatePending);
    const agentRunning = item.status === "pending" || item.status === "streaming";
    const textStreaming = mode === "agent" ? item.agentTextStreaming === true : item.status === "streaming";
    const compactStructuredOutput = compactOutput && !item.agentQuestion && Boolean(item.commercePlan || agentTasks?.length);
    const collapsibleReply = compactStructuredOutput && !agentRunning && !textStreaming;
    const runningMediaCount = mediaTasks.filter((task) => task.agentRunId === item.agentRunId && !task.taskStatePending && (task.status === "pending" || task.status === "streaming")).length;
    const mediaSettled = mediaTasks.length > 0 && mediaTasks.length >= Math.max(item.batchTotal || 0, item.commercePlan?.items.length || 0) && mediaTasks.every((task) => !task.taskStatePending && (task.status === "done" || task.status === "error" || task.status === "cancelled"));
    const agentActivity =
        mode === "agent" && agentRunning && !textStreaming && !item.agentQuestion
            ? item.agentActivity === "等待你确认"
                ? item.agentActivity
                : pendingTaskStates.length
                  ? "正在同步任务状态…"
                  : runningMediaCount
                    ? `${runningMediaCount} 项媒体任务生成中…`
                    : item.agentActivity || (mediaSettled ? "" : "正在处理请求…")
            : "";
    const failedMediaTasks = mode === "agent" && !agentRunning ? mediaTasks.filter((task) => task.agentRunId === item.agentRunId && task.status === "error") : [];
    const retryFailedItems = async () => {
        if (retryPending || retryDisabled || !failedMediaTasks.length || !onRetryAgentTasks) return;
        setRetryPending(true);
        try {
            await onRetryAgentTasks(failedMediaTasks);
        } finally {
            setRetryPending(false);
        }
    };
    const retryFailure = async () => {
        if (retryPending || retryDisabled) return;
        setRetryPending(true);
        try {
            await onRetryFailure();
        } finally {
            setRetryPending(false);
        }
    };
    const taskSummary = (
        [
            ["done", "完成"],
            ["error", "失败"],
            ["pending", "生成中"],
            ["unconfirmed", "待确认"],
            ["cancelled", "已停止"],
        ] as const
    )
        .map(([status, label]) => {
            const count = mediaTasks.filter((task) => {
                if (task.taskStatePending) return status === "unconfirmed";
                return task.status === status || (status === "pending" && task.status === "streaming");
            }).length;
            return count ? `${count} 项${label}` : "";
        })
        .filter(Boolean)
        .join("，");
    const deliveryTotal = Math.max(mediaTasks.length, item.batchTotal || 0, item.commercePlan?.items.length || 0);
    const multipleDeliveries = deliveryTotal > 1 || mediaTasks.some((task) => (task.batchTotal || 0) > 1);
    const singleMedia = mediaTasks.length === 1 && deliveryTotal === 1 ? mediaTasks[0] : undefined;
    const compactSummary = singleMedia?.status === "done" && !singleMedia.taskStatePending
        ? `${singleMedia.mode === "video" ? "视频" : "图片"}已生成。`
        : mediaTasks.length
        ? `${deliveryTotal} 项交付${taskSummary ? `：${taskSummary}${deliveryTotal > mediaTasks.length ? `，${deliveryTotal - mediaTasks.length} 项待提交` : ""}` : "，状态待确认"}。`
        : `创作方案已准备，共 ${deliveryTotal} 项交付。`;
    const stateLabel = item.submissionPending
        ? submitting
            ? "提交中"
            : "提交待确认"
        : item.taskStatePending
          ? "状态待确认"
          : item.status === "pending"
            ? mode === "agent"
                ? "处理中"
                : "生成中"
            : item.status === "cancelled"
              ? "已停止"
              : item.status === "error"
                ? "生成失败"
                : "";
    const heading =
        mode !== "text" && mode !== "agent" ? (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <BrandLogoFrame className="creation-message-mark" logoClassName="size-full" fallback={<CreationIcon name="auto" />} />
                <strong>{mode === "image" ? "图像生成" : mode === "audio" ? "音频生成" : "视频生成"}</strong>
                {item.status === "pending" ? (
                    <span className="creation-message-progress-copy">
                        {item.submissionPending ? (
                            submitting ? (
                                "正在提交…"
                            ) : (
                                "正在确认提交状态…"
                            )
                        ) : item.taskStatePending ? (
                            "正在同步任务状态…"
                        ) : (
                            <>
                                {brandName}正在生成{creationMediaNoun(mode)}……
                            </>
                        )}
                    </span>
                ) : item.status === "done" ? (
                    <span className="creation-message-progress-copy">{mode === "image" ? "图片" : creationMediaNoun(mode)}已生成</span>
                ) : null}
                {item.status === "done" && !item.agentRunId ? (
                    <button type="button" className="creation-message-variant-action" onClick={onCreateVariant}>
                        <RefreshCw />
                        生成同款
                    </button>
                ) : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}
            </>
        ) : (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <BrandLogoFrame className="creation-message-mark" logoClassName="size-full" fallback={<CreationIcon name="auto" />} />
                <strong>
                    <BrandWordmark name={assistantName} />
                </strong>
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}
            </>
        );
    const toolStatus: GenerationToolStatus = item.status === "pending" ? "running" : item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "completed";
    const Container = nested ? "div" : "article";
    const agentMediaResults =
        mode === "agent" ? (
            <>
                {projectCreationAgentMediaBatches(item, mediaTasks).map((task) => {
                    const sources = task.batchId ? mediaTasks.filter((source) => source.agentRunId === item.agentRunId && source.mode === "image") : [task];
                    return (
                        <div
                            key={task.id}
                            className="creation-agent-media-batch"
                            role="group"
                            aria-label={
                                sources
                                    .map((source) => source.content)
                                    .filter(Boolean)
                                    .join("、") || "整套媒体生成"
                            }
                        >
                            <CreationMessageView
                                nested
                                item={task}
                                shotNumber={0}
                                onRetryFailure={retryFailedItems}
                                onCreateVariant={() => onCreateAgentTaskVariant?.(sources[0])}
                                onEditUserMessage={onEditUserMessage}
                                onContinueCanvas={onContinueCanvas}
                                openingCanvas={openingCanvas}
                                onUseResultImage={onUseResultImage}
                            />
                        </div>
                    );
                })}
                {failedMediaTasks.length > 0 ? (
                    <div className="creation-message-error">
                        <span>{multipleDeliveries ? "生成失败，请重试失败项。" : generationErrorMessage(failedMediaTasks[0].error || "生成失败")}</span>
                        <button type="button" disabled={retryPending || retryDisabled} aria-busy={retryPending} onClick={() => void retryFailedItems()}>
                            <RefreshCw size={16} />
                            {retryPending ? "正在核对原任务…" : "重试失败项"}
                        </button>
                    </div>
                ) : null}
            </>
        ) : null;
    return (
        <Container className={`creation-assistant-message is-${mode}`}>
            {mode === "text" || mode === "agent" ? (
                <>
                    <div className="creation-message-heading">{heading}</div>
                    {mode !== "agent" && item.reasoning ? (
                        <div className="creation-message-reasoning-wrap">
                            <MessageReasoning reasoning={item.reasoning} isStreaming={item.status === "streaming"} />
                        </div>
                    ) : null}
                    <div className="creation-message-content">
                        {compactStructuredOutput && !(singleMedia?.status === "done" && !singleMedia.taskStatePending) ? (
                            <p className="creation-agent-output-summary" role="status">
                                {compactSummary}
                            </p>
                        ) : null}
                        {item.content ? (
                            collapsibleReply ? (
                                <div className="creation-agent-full-reply">
                                    <button type="button" className="creation-agent-plan-toggle" aria-expanded={replyExpanded} aria-controls={replyId} onClick={() => setReplyExpanded((value) => !value)}>
                                        {replyExpanded ? "收起完整回复" : "查看完整回复"}
                                        {replyExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                                    </button>
                                    <div id={replyId} hidden={!replyExpanded}>
                                        {replyExpanded ? <AIMessageMarkdown>{item.content}</AIMessageMarkdown> : null}
                                    </div>
                                </div>
                            ) : (
                                <AIMessageMarkdown isStreaming={textStreaming} streamingAnimation={mode === "agent" ? "none" : "word"}>
                                    {item.content}
                                </AIMessageMarkdown>
                            )
                        ) : mode !== "agent" && !item.agentQuestion && agentRunning ? (
                            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <WorkingDots dotSize={5} gap={2} />
                                <span>正在生成…</span>
                            </span>
                        ) : null}
                        {agentActivity ? (
                            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                {agentActivity !== "等待你确认" ? <WorkingDots dotSize={5} gap={2} /> : null}
                                <span>{agentActivity}</span>
                            </span>
                        ) : null}
                    </div>
                    {mode === "agent" && item.agentQuestion ? (
                        <section className="creation-agent-question" aria-label="待确认的问题">
                            <h3>需要你确认</h3>
                            <p>{item.agentQuestion.question}</p>
                            {item.agentQuestion.fields?.length ? (
                                <ul>
                                    {item.agentQuestion.fields.map((field, index) => (
                                        <li key={`${field.title}-${index}`}>
                                            <strong>
                                                {field.title}
                                                {field.required ? "（必填）" : ""}
                                            </strong>
                                            {field.options?.length ? (
                                                <span>：{field.options.map((option) => `${option.label}${option.detail ? `（${option.detail}）` : ""}`).join("、")}</span>
                                            ) : field.placeholder ? (
                                                <span>：{field.placeholder}</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : item.agentQuestion.options.length ? (
                                <ol>
                                    {item.agentQuestion.options.map((option, index) => (
                                        <li key={`${option.label}-${index}`}>
                                            <strong>{option.label}</strong>
                                            {option.detail ? <span> — {option.detail}</span> : null}
                                        </li>
                                    ))}
                                </ol>
                            ) : null}
                            <small>{item.agentQuestion.allowFreeform ? "请在输入框回复选项或补充说明。" : "请在输入框回复一个选项。"}</small>
                        </section>
                    ) : null}
                    {compactOutput ? agentMediaResults : null}
                    {mode === "agent" && !item.agentContinuation ? agentReview : null}
                    {!compactOutput ? agentMediaResults : null}
                </>
            ) : (
                <GenerationToolCard status={toolStatus} heading={heading}>
                    {nested && (item.status === "error" || item.status === "cancelled") ? null : (
                        <MediaResult
                            item={item}
                            submitting={submitting}
                            onRetryFailure={nested ? undefined : onRetryFailure}
                            onRefreshResult={onRefreshResult}
                            onRecoverMedia={onRecoverMedia}
                            refreshingResult={refreshingResult}
                            onCreateVariant={onCreateVariant}
                            onContinueCanvas={onContinueCanvas}
                            openingCanvas={openingCanvas}
                            onUseResultImage={onUseResultImage}
                        />
                    )}
                </GenerationToolCard>
            )}
            {mode === "agent" && pendingTaskStates.length > 0 && taskSyncFailed ? (
                <div role="status" className="creation-agent-task-sync">
                    <span>任务状态暂时无法同步，正在自动重连。</span>
                    {onRefreshAgentTasks ? (
                        <button type="button" className="creation-agent-plan-toggle" onClick={onRefreshAgentTasks}>
                            <RefreshCw />
                            刷新状态
                        </button>
                    ) : null}
                </div>
            ) : null}
            {item.error && (mode === "text" || mode === "agent") && !failedMediaTasks.length && !pendingTaskStates.length ? (
                <div className="creation-message-error">
                    <span>{generationErrorMessage(item.error)}</span>
                    <button type="button" disabled={retryPending || retryDisabled} aria-busy={retryPending} onClick={() => void retryFailure()}>
                        <RefreshCw size={16} />
                        {retryPending ? "正在核对原任务…" : "重新生成"}
                    </button>
                </div>
            ) : null}
        </Container>
    );
}

export function CreationUserMessage({
    item,
    shotNumber,
    onEditUserMessage,
    onQueryInterjection,
}: {
    item: CreationMessage;
    shotNumber: number;
    onEditUserMessage: (message: CreationMessage) => void;
    onQueryInterjection?: (message: CreationMessage) => Promise<void>;
}) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [querying, setQuerying] = useState(false);
    const copyText = useCopyText();
    const visiblePrompt = displayCreationPrompt(item.content, item.references || []);
    const user = useUserStore((state) => state.user);
    return (
        <article className="creation-user-message">
            <div className="creation-user-message-meta">
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                <strong>{user?.displayName || "你"}</strong>
                {user ? (
                    <UserAvatar user={user} className="creation-user-avatar" />
                ) : (
                    <span className="creation-user-avatar">
                        <UserRound />
                    </span>
                )}
            </div>
            {visiblePrompt ? (
                <div className="creation-user-message-copy-wrap">
                    <p>{visiblePrompt}</p>
                </div>
            ) : null}
            {item.agentInterjection ? (
                <div className="creation-user-message-meta" role="status">
                    <span>
                        {item.agentInterjection === "pending"
                            ? "补充说明回执待确认"
                            : item.agentInterjection === "queued"
                              ? "已排队，等待本轮下一步"
                              : item.agentInterjection === "delivered"
                                ? "补充说明已送达"
                                : `补充说明未送达${item.error ? `：${item.error}` : ""}`}
                    </span>
                    {item.agentInterjection === "pending" && onQueryInterjection ? (
                        <button
                            type="button"
                            className="creation-agent-plan-toggle"
                            disabled={querying}
                            aria-busy={querying}
                            onClick={async () => {
                                if (querying) return;
                                setQuerying(true);
                                try {
                                    await onQueryInterjection(item);
                                } finally {
                                    setQuerying(false);
                                }
                            }}
                        >
                            <RefreshCw />
                            {querying ? "正在核对" : "核对并重试原消息"}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {item.references?.length ? <CreationMessageReferences references={item.references} /> : null}
            {item.attachments?.length ? (
                <div className="creation-user-message-attachments">
                    {item.attachments.map((attachment) => {
                        const kind = creationAttachmentKind(attachment);
                        const previewable = kind === "image" || kind === "video";
                        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
                        const imageUrl = kind === "image" ? resolveResourceUrl(attachment.storageKey, url) : "";
                        const previewUrl = kind === "image" ? imageUrl : url;
                        return (
                            <button
                                key={attachment.id}
                                type="button"
                                className={!previewable ? "is-file" : undefined}
                                onClick={() => {
                                    if (!previewable) return;
                                    setPreviewType(kind === "video" ? "video" : "image");
                                    setPreviewUrl(kind === "video" ? attachment.url || "" : previewUrl);
                                }}
                                aria-label={previewable ? `预览 ${attachment.name || "附件"}` : attachment.name || "附件"}
                                disabled={previewable && !previewUrl}
                            >
                                {kind === "video" ? (
                                    <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" />
                                ) : kind === "image" ? (
                                    <CachedResourceImage storageKey={attachment.storageKey} src={imageUrl} alt={attachment.name || "附件"} width={44} height={44} loading="lazy" decoding="async" />
                                ) : kind === "audio" ? (
                                    <Music2 />
                                ) : (
                                    <FileText />
                                )}
                                {previewable ? (
                                    <span aria-hidden="true">
                                        <Maximize2 />
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
            <div className="creation-user-message-actions">
                {visiblePrompt ? (
                    <Tooltip title="复制提示词">
                        <button type="button" className="creation-user-message-copy" aria-label="复制提示词" onClick={() => copyText(visiblePrompt, "提示词已复制")}>
                            <Copy />
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip title="编辑并重新发送">
                    <button type="button" className="creation-user-message-edit" aria-label="编辑并重新发送" onClick={() => onEditUserMessage(item)}>
                        <Pencil />
                    </button>
                </Tooltip>
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </article>
    );
}

/**
 * 历史 URL 只是短期 hint：签名已过期的地址不再直接交给 <img>/<video>，
 * 否则首帧就会出现 403（画面空白）。带 storageKey 的结果随后由续签流程补上新的地址。
 */
function usableResultUrls(urls: string[]) {
    const now = Date.now();
    return urls.map((url) => {
        if (!url) return "";
        const expires = /[?&]expires=(\d+)/.exec(url);
        return !expires || Number(expires[1]) * 1000 > now ? url : "";
    });
}

/** 生成中、结果卡里对媒体的叫法。 */
function creationMediaNoun(mode: CreationMode | undefined) {
    return mode === "video" ? "视频" : mode === "audio" ? "音频" : "图像";
}

export type CreationResultImageIntent = "variant" | "upscale" | "inpaint" | "expand" | "video" | "reference";
export type CreationResultImageRef = { url: string; storageKey?: string; index: number };
export type CreationResultImageHandler = (image: CreationResultImageRef, intent: CreationResultImageIntent) => void;

export const creationImageActionItems: Array<{ intent: CreationResultImageIntent; icon: CreationIconName; label: string; title: string }> = [
    { intent: "variant", icon: "variant", label: "用这张图做变体", title: "变体" },
    { intent: "upscale", icon: "hd", label: "把这张图重绘成高清版", title: "高清" },
    { intent: "inpaint", icon: "inpaint", label: "框选这张图的局部来修改", title: "局部修改" },
    { intent: "expand", icon: "expand", label: "把这张图向四周扩展", title: "扩图" },
    { intent: "video", icon: "toVideo", label: "用这张图做视频", title: "转视频" },
    { intent: "reference", icon: "reference", label: "把这张图作为参考", title: "作为参考" },
];

/**
 * 结果图上的操作条：只放和这一张图有关的操作，整组的操作（添加到画布、批量下载）留在图下面。
 * 桌面端悬停或键盘聚焦时浮出；触屏设备常驻显示。局部修改先打开框选弹窗，在弹窗里确认后才生成；
 * 其余操作只把图片、参数和提示词填进输入框，不会直接生成。
 */
function CreationImageActions({ image, onUse }: { image: CreationResultImageRef; onUse?: CreationResultImageHandler }) {
    if (!onUse) return null;
    const ready = Boolean(image.url || image.storageKey);
    // 用 div 和原生 title：旧的消息样式会把结果卡里的每个 span 压成 27px 并隐藏。
    return (
        <div className="creation-image-actions" role="group" aria-label={`第 ${image.index + 1} 张图的操作`}>
            {creationImageActionItems.map((action) => (
                <button key={action.intent} type="button" title={action.title} aria-label={action.label} disabled={!ready} onClick={() => onUse(image, action.intent)}>
                    <CreationIcon name={action.icon} size={18} />
                </button>
            ))}
        </div>
    );
}

export function MediaResult({
    item,
    submitting = false,
    onRefreshResult = () => {},
    onRecoverMedia = () => {},
    refreshingResult = false,
    onRetryFailure,
    onCreateVariant,
    onContinueCanvas,
    openingCanvas,
    onUseResultImage,
}: {
    item: CreationMessage;
    submitting?: boolean;
    onRetryFailure?: () => void | Promise<void>;
    onRefreshResult?: () => void;
    onRecoverMedia?: () => void;
    refreshingResult?: boolean;
    onCreateVariant: () => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
    onUseResultImage?: CreationResultImageHandler;
}) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
    const [batchPreviewIndex, setBatchPreviewIndex] = useState(0);
    const [batchExpanded, setBatchExpanded] = useState(false);
    const [downloadingBatch, setDownloadingBatch] = useState(false);
    const [downloadingImage, setDownloadingImage] = useState<number | null>(null);
    const [downloadError, setDownloadError] = useState("");
    const [recoveringSubmission, setRecoveringSubmission] = useState(false);
    const assets = useAssetStore((state) => state.assets);
    const storedResultUrls = item.resultUrls || [];
    const resultStorageKeys = item.resultStorageKeys?.length ? item.resultStorageKeys : creationResultStorageKeys(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: storedResultUrls });
    // 展示地址按 storageKey 保存；effect 重跑（素材库更新、续签）时不回退到历史 hint。
    const [resolvedByKey, setResolvedByKey] = useState<Record<string, string>>({});
    const [failedByKey, setFailedByKey] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let active = true;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const updateResultUrl = (storageKey: string, url: string) => {
            if (!active || !url) return;
            setResolvedByKey((current) => (current[storageKey] === url ? current : { ...current, [storageKey]: url }));
        };
        const refreshRemote = async (index: number, storageKey: string): Promise<void> => {
            try {
                const access = await getResourceAccess(storageKey, "display");
                if (!active) return;
                updateResultUrl(storageKey, resolveResourceAccessURL(access.url));
                const refreshAt = access.refreshAt ? new Date(access.refreshAt).getTime() : Number.NaN;
                const expiresAt = access.expiresAt ? new Date(access.expiresAt).getTime() : Number.NaN;
                const nextRefreshAt = Number.isFinite(refreshAt) ? refreshAt : expiresAt;
                const delay = Number.isFinite(nextRefreshAt) ? Math.max(10_000, nextRefreshAt - Date.now()) : 4 * 60_000;
                timers.push(setTimeout(() => void refreshRemote(index, storageKey), delay));
            } catch {
                if (!active) return;
                setFailedByKey((current) => (current[storageKey] ? current : { ...current, [storageKey]: true }));
                timers.push(setTimeout(() => void refreshRemote(index, storageKey), 60_000));
            }
        };
        if (!resultStorageKeys.length) {
            return () => {
                active = false;
            };
        }
        // 历史记录只把 URL 当作短期 hint；真正恢复依赖稳定 storageKey，展示 URL 由访问缓存按需续签。
        const resolver = item.mode === "video" || item.mode === "audio" ? resolveMediaUrl : resolveImageUrl;
        void Promise.all(
            resultStorageKeys.map(async (storageKey, index) => {
                if (resourceIdFromStorageKey(storageKey)) {
                    await refreshRemote(index, storageKey);
                    return;
                }
                const url = await resolver(storageKey, storedResultUrls[index] || "");
                updateResultUrl(storageKey, url);
            }),
        ).catch(() => {
            // 保留当前 URL hint 和已有结果槽位，不把访问地址尚未恢复当作生成无结果。
        });
        return () => {
            active = false;
            timers.forEach((timer) => clearTimeout(timer));
        };
    }, [item.id, item.mode, resultStorageKeys.join("|"), storedResultUrls.join("|")]);

    const mediaFileResult = item.mode === "video" || item.mode === "audio";
    const alignedResultUrls = resultStorageKeys.length ? resultStorageKeys.map((key, index) => resolvedByKey[key] || (!mediaFileResult || failedByKey[key] || !resourceIdFromStorageKey(key) ? usableResultUrl(storedResultUrls[index]) : "")) : storedResultUrls;
    const downloadImages = Array.from({ length: Math.max(alignedResultUrls.length, resultStorageKeys.length) }, (_, index) => ({
        url: alignedResultUrls[index] || "",
        storageKey: resultStorageKeys[index],
        name: item.resultDownloadNames?.[index] || creationImageDownloadBaseName(item.content, index + 1),
    })).filter((image) => image.url || image.storageKey);
    // 地址续签不改变结果身份、顺序和卡片布局；避免历史恢复时空态、单图、叠图反复切换。
    const displayResultUrls = downloadImages.map((image) => image.url);
    useEffect(() => {
        setBatchPreviewIndex((current) => (displayResultUrls.length ? Math.min(current, displayResultUrls.length - 1) : 0));
    }, [displayResultUrls.length]);
    const resultAssetIds = alignedResultUrls.length || resultStorageKeys.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: alignedResultUrls, resultStorageKeys }) : [];
    const expectedResultCount = downloadImages.length;
    const canContinueWithResults = expectedResultCount > 0 && resultAssetIds.length === expectedResultCount;
    const retryFailure = async () => {
        if (recoveringSubmission || !onRetryFailure) return;
        setRecoveringSubmission(true);
        try {
            await onRetryFailure();
        } finally {
            setRecoveringSubmission(false);
        }
    };
    const submissionNotice =
        item.submissionPending && !submitting ? (
            <div className="creation-media-empty" role="status">
                提交状态待确认，原任务可能仍在运行。
                {onRetryFailure ? (
                    <button type="button" disabled={recoveringSubmission} aria-busy={recoveringSubmission} onClick={() => void retryFailure()}>
                        <RefreshCw size={16} />
                        {recoveringSubmission ? "正在核对原任务…" : "查询原任务"}
                    </button>
                ) : null}
            </div>
        ) : null;
    if (submissionNotice && !expectedResultCount) return submissionNotice;
    if (item.status === "pending" && !displayResultUrls.length)
        return (
            <CreationMediaPending item={item} refreshing={refreshingResult} onRefresh={onRefreshResult} onRetry={() => void onRetryFailure?.()} />
        );
    if ((item.status === "error" || item.status === "cancelled") && !expectedResultCount)
        return (
            <CreationMediaFailure item={item} refreshing={refreshingResult} onRefresh={onRefreshResult} onRecoverMedia={onRecoverMedia} onRetry={() => void onRetryFailure?.()} />
        );
    if (!expectedResultCount)
        return (
            <div className="creation-media-empty">
                没有返回可预览结果{" "}
                {onRetryFailure ? (
                    <button type="button" disabled={recoveringSubmission} aria-busy={recoveringSubmission} onClick={() => void retryFailure()}>
                        {recoveringSubmission ? "正在核对原任务…" : "重试"}
                    </button>
                ) : null}
            </div>
        );
    const isVideo = item.mode === "video";
    const isAudio = item.mode === "audio";
    const activeBatchUrl = displayResultUrls[batchPreviewIndex] || "";
    const loadingResult = (
        <span className="creation-media-result-placeholder" role="status">
            {isVideo ? "视频加载中" : isAudio ? "音频加载中" : "图片加载中"}
        </span>
    );
    if (isAudio)
        return (
            <div className="creation-media-result">
                <div className="creation-audio-result">{displayResultUrls[0] ? <audio controls preload="metadata" src={displayResultUrls[0]} aria-label="生成的音频" /> : loadingResult}</div>
                <div className="creation-media-actions">
                    <span>音频结果</span>
                    <a href={displayResultUrls[0] || undefined} aria-disabled={!displayResultUrls[0]} download>
                        <Download />
                        下载
                    </a>
                </div>
                {submissionNotice}
            </div>
        );
    const stackedUrls = displayResultUrls.length > 1 ? Array.from({ length: Math.min(2, displayResultUrls.length - 1) }, (_, offset) => displayResultUrls[(batchPreviewIndex + offset + 1) % displayResultUrls.length]) : [];
    const moveBatchPreview = (direction: -1 | 1) => setBatchPreviewIndex((current) => (current + direction + displayResultUrls.length) % displayResultUrls.length);
    const downloadImage = async (index: number) => {
        if (downloadingBatch || downloadingImage !== null) return;
        setDownloadingImage(index);
        setDownloadError("");
        try {
            const image = downloadImages[index];
            await downloadCreationImage(image);
        } catch (error) {
            setDownloadError(error instanceof Error ? error.message : "图片下载失败，请重试");
        } finally {
            setDownloadingImage(null);
        }
    };
    const downloadBatch = async () => {
        if (downloadingBatch || downloadingImage !== null) return;
        setDownloadingBatch(true);
        setDownloadError("");
        try {
            saveAs(await createCreationImagesZip(downloadImages), creationImagesZipName(item));
        } catch (error) {
            setDownloadError(error instanceof Error ? error.message : "批量下载失败，请重试");
        } finally {
            setDownloadingBatch(false);
        }
    };
    const reloadImage = async (index: number) => {
        const image = downloadImages[index];
        if (!image.storageKey) return image.url;
        if (resourceIdFromStorageKey(image.storageKey)) {
            const access = await getResourceAccess(image.storageKey, "display", "original", "", { forceRefresh: true });
            const url = resolveResourceAccessURL(access.url);
            setResolvedByKey((current) => ({ ...current, [image.storageKey!]: url }));
            return url;
        }
        return resolveImageUrl(image.storageKey, image.url);
    };
    const imageResult = (url: string, index: number) => (
        <div key={downloadImages[index].storageKey || index} className="creation-image-result" style={displayResultUrls.length > 1 ? { aspectRatio: "1" } : !url ? { aspectRatio: creationMediaAspectRatio(item.settings?.ratio, "image") } : undefined}>
            <CreationResultImage
                url={url}
                alt={`生成结果 ${index + 1}`}
                square={displayResultUrls.length > 1}
                ratio={creationMediaAspectRatio(item.settings?.ratio, "image")}
                onReload={() => reloadImage(index)}
                onPreview={(loadedUrl) => {
                    setPreviewType("image");
                    setPreviewUrl(loadedUrl);
                }}
            />
            <CreationImageActions image={{ url, storageKey: downloadImages[index].storageKey, index }} onUse={onUseResultImage} />
            <button type="button" className="creation-image-result-download" onClick={() => void downloadImage(index)} disabled={downloadingBatch || downloadingImage !== null} aria-label={`下载生成图片 ${index + 1}`} title="下载图片">
                <Download aria-hidden="true" />
            </button>
        </div>
    );
    return (
        <div className="creation-media-result">
            {isVideo ? (
                <button
                    type="button"
                    className="creation-video-result"
                    disabled={!displayResultUrls[0]}
                    onClick={() => {
                        if (!displayResultUrls[0]) return;
                        setPreviewType("video");
                        setPreviewUrl(displayResultUrls[0]);
                    }}
                    aria-label="预览生成视频"
                >
                    {displayResultUrls[0] ? <video muted preload="metadata" src={displayResultUrls[0]} /> : loadingResult}
                    {displayResultUrls[0] ? (
                        <span>
                            <Maximize2 />
                            预览视频
                        </span>
                    ) : null}
                </button>
            ) : displayResultUrls.length > 1 ? (
                batchExpanded ? (
                    <div className="creation-image-result-grid creation-image-result-grid-expanded">{displayResultUrls.map(imageResult)}</div>
                ) : (
                    <div className="creation-image-result-stack" role="group" aria-label={`第 ${batchPreviewIndex + 1} 张，共 ${displayResultUrls.length} 张生成图片`}>
                        <span className="creation-image-result-stack-cards">
                            {stackedUrls.map((url, index) => (
                                <span key={index} className={`creation-image-result-stack-back is-back-${index + 1}`} aria-hidden="true">
                                    {url ? <CreationResultImage url={url} alt="" square /> : null}
                                </span>
                            ))}
                            <span className="creation-image-result-stack-front">
                                <CreationResultImage key={batchPreviewIndex} url={activeBatchUrl} alt={`生成结果 ${batchPreviewIndex + 1}`} square previewLabel={`展开预览第 ${batchPreviewIndex + 1} 张图片`} onPreview={() => setBatchPreviewOpen(true)} onReload={() => reloadImage(batchPreviewIndex)} />
                                <CreationImageActions image={{ url: activeBatchUrl, storageKey: downloadImages[batchPreviewIndex]?.storageKey, index: batchPreviewIndex }} onUse={onUseResultImage} />
                            </span>
                        </span>
                        <span className="creation-image-result-stack-controls" aria-label="切换批次图片">
                            <button type="button" onClick={() => moveBatchPreview(-1)} aria-label="上一张生成图片" title="上一张">
                                <ChevronLeft aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => moveBatchPreview(1)} aria-label="下一张生成图片" title="下一张">
                                <ChevronRight aria-hidden="true" />
                            </button>
                        </span>
                        <button
                            type="button"
                            className="creation-image-result-stack-download"
                            onClick={() => void downloadImage(batchPreviewIndex)}
                            disabled={downloadingBatch || downloadingImage !== null}
                            aria-label="下载当前生成图片"
                            title="下载当前图片"
                        >
                            <Download aria-hidden="true" />
                        </button>
                    </div>
                )
            ) : (
                <div className="creation-image-result-grid is-single">{imageResult(displayResultUrls[0], 0)}</div>
            )}
            <div className="creation-media-actions">
                {isVideo || displayResultUrls.length > 1 || (item.batchTotal || 0) > 1 ? <span>{isVideo ? "视频结果" : `已生成 ${displayResultUrls.length} 张${item.status === "pending" ? "，其余生成中" : item.batchFailedCount ? `，${item.batchFailedCount} 项未成功` : ""}`}</span> : null}
                <Button type="link" size="small" loading={openingCanvas} disabled={!canContinueWithResults} title={canContinueWithResults ? undefined : "素材保存完成后才能转入画布"} onClick={() => onContinueCanvas(resultAssetIds)}>
                    添加到画布
                </Button>
                {!isVideo && displayResultUrls.length > 1 ? (
                    <Button type="link" size="small" onClick={() => setBatchExpanded((expanded) => !expanded)}>
                        {batchExpanded ? "收起" : "展开"}
                    </Button>
                ) : null}
                {isVideo ? (
                    <a href={displayResultUrls[0] || undefined} aria-disabled={!displayResultUrls[0]} download>
                        <Download />
                        下载
                    </a>
                ) : (
                    <Button type="link" size="small" loading={downloadingBatch || downloadingImage !== null} disabled={downloadingBatch || downloadingImage !== null} onClick={() => void (displayResultUrls.length > 1 ? downloadBatch() : downloadImage(0))}>
                        <Download />
                        {displayResultUrls.length > 1 ? "批量下载" : "下载"}
                    </Button>
                )}
            </div>
            {submissionNotice}
            {downloadError ? (
                <div className="creation-message-error" role="alert">
                    {downloadError}
                </div>
            ) : null}
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
            <AppModal
                open={batchPreviewOpen}
                centered
                destroyOnHidden
                title={`生成图片（${displayResultUrls.length} 张）`}
                footer={null}
                width="min(1120px, calc(100vw - 32px))"
                onCancel={() => setBatchPreviewOpen(false)}
                className="creation-image-batch-preview-modal"
            >
                <div className="creation-image-batch-preview-viewer">
                    <div className="creation-image-batch-preview-stage">
                        <button type="button" className="creation-image-batch-preview-nav is-prev" onClick={() => moveBatchPreview(-1)} aria-label="上一张生成图片" title="上一张">
                            <ChevronLeft aria-hidden="true" />
                        </button>
                        <CreationResultImage key={batchPreviewIndex} url={activeBatchUrl} alt={`生成结果 ${batchPreviewIndex + 1}`} onReload={() => reloadImage(batchPreviewIndex)} />
                        <button type="button" className="creation-image-batch-preview-nav is-next" onClick={() => moveBatchPreview(1)} aria-label="下一张生成图片" title="下一张">
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </div>
                    <div className="creation-image-batch-preview-thumbs" aria-label="生成图片缩略图">
                        {displayResultUrls.map((url, index) => (
                            <button
                                key={downloadImages[index].storageKey || index}
                                type="button"
                                className={index === batchPreviewIndex ? "is-active" : undefined}
                                onClick={() => setBatchPreviewIndex(index)}
                                aria-label={`预览第 ${index + 1} 张图片`}
                                aria-current={index === batchPreviewIndex ? "true" : undefined}
                            >
                                {url ? <CreationResultImage url={url} alt={`生成结果缩略图 ${index + 1}`} square /> : null}
                                <span>{index + 1}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </AppModal>
        </div>
    );
}

export function CreationMediaPending({ item, refreshing, onRefresh, onRetry }: { item: CreationMessage; refreshing: boolean; onRefresh: () => void; onRetry: () => void }) {
    const mode: CreationMode = item.mode || "image";
    const kind = mode === "video" ? "video" : "image";
    const phase: GenerationPhase = item.taskIds?.length ? generationTaskPhase({ status: item.generationStatus || "running", stage: item.generationStage, mediaStage: item.generationMediaStage }) : "submitting";
    const uncertain = phase === "uncertain";
    const progress =
        item.taskIds?.length &&
        typeof item.generationProgress === "number" &&
        generationTaskShowsProgress({ status: item.generationStatus || "running", stage: item.generationStage, mediaStage: item.generationMediaStage, progress: item.generationProgress })
            ? item.generationProgress
            : null;
    const elapsed = useTaskElapsed(item.createdAt);
    const hint = generationPhaseHint(phase, kind, item.generationStage);
    const aspectRatio = creationMediaAspectRatio(item.settings?.ratio, mode);
    const specs = creationPendingSpecs(item);
    const Icon = mode === "video" ? Film : ImageIcon;
    return (
        <div
            className={`creation-media-pending is-${mode}`}
            data-phase={phase}
            data-saving={phase === "saving" ? generationTaskSavingState(item.generationStage) : undefined}
            data-sync={item.syncInterrupted ? "interrupted" : undefined}
            style={{ aspectRatio, "--creation-media-ratio": creationAspectRatioValue(aspectRatio) } as CSSProperties}
        >
            <span className="creation-media-pending-surface" aria-hidden="true" />
            {specs ? (
                <span className="creation-media-pending-spec">
                    <Icon aria-hidden="true" />
                    {specs}
                </span>
            ) : null}
            <span className="creation-media-pending-body">
                <span className="creation-media-pending-title" role="status">
                    {generationPhaseLabel(phase, kind, item.generationStage)}
                </span>
                <span className="creation-media-pending-meta">{[item.batchTotal ? `${item.batchCompletedCount || 0}/${item.batchTotal}` : "", progress !== null ? `${progress}%` : "", item.createdAt ? `已用时 ${elapsed}` : ""].filter(Boolean).join(" · ")}</span>
                {hint ? <span className="creation-media-pending-hint">{hint}</span> : null}
            </span>
            <span className="creation-media-pending-foot">
                {item.syncInterrupted ? <CreationSyncNotice refreshing={refreshing} onRefresh={onRefresh} onRetry={onRetry} /> : uncertain ? null : <GenerationPhaseSteps step={generationPhaseStep(phase)} progress={progress} />}
            </span>
        </div>
    );
}

function creationAspectRatioValue(aspectRatio: string) {
    const [width, height] = aspectRatio.split("/").map((value) => Number(value.trim()));
    return width > 0 && height > 0 ? width / height : 1;
}

export function creationResultAssetRatio(assets: Asset[], storageKey: string) {
    const asset = assets.find((candidate): candidate is ImageAsset | VideoAsset => (candidate.kind === "image" || candidate.kind === "video") && candidate.data.storageKey === storageKey);
    return asset && asset.data.width > 0 && asset.data.height > 0 ? asset.data.width / asset.data.height : undefined;
}

// 结果图块按真实比例预留宽高：已知素材尺寸优先，其次生成时选的画面比例；竖图按最大高度收窄宽度。
function creationResultTileStyle(ratio: number): CSSProperties {
    return { aspectRatio: String(ratio), "--creation-result-ratio": ratio } as CSSProperties;
}

function CreationResultMediaError({ label }: { label: string }) {
    return (
        <em className="creation-result-media-error">
            <ImageOff aria-hidden="true" />
            {label}
        </em>
    );
}

function creationPendingSpecs(item: CreationMessage) {
    const settings = item.settings;
    if (!settings) return "";
    const ratio = settings.ratio && settings.ratio.toLowerCase() !== "auto" ? settings.ratio : "";
    if (item.mode === "video") return [ratio, settings.seconds ? `${settings.seconds} 秒` : "", settings.videoQuality ? `${settings.videoQuality.replace(/p$/i, "")}P` : ""].filter(Boolean).join(" · ");
    const count = Number(settings.count) || 1;
    return [ratio, count > 1 ? `${count} 张` : ""].filter(Boolean).join(" · ");
}

/**
 * 失败卡片按“下一步该做什么”分三类：
 * 作品可能已生成（页面没拿到结果）→ 重新获取；作品已生成但保存失败 → 重新保存；后端确认失败 → 重新生成。
 */
function CreationMediaFailure({ item, refreshing, onRefresh, onRecoverMedia, onRetry }: { item: CreationMessage; refreshing: boolean; onRefresh: () => void; onRecoverMedia: () => void; onRetry: () => void }) {
    const reason = generationErrorMessage(item.error || "生成失败");
    if (item.status === "cancelled") {
        return (
            <CreationMediaNotice
                tone="neutral"
                icon={CircleStop}
                title="已停止生成"
                description={item.content && item.content !== "已停止" ? item.content : "可以调整后重新生成。"}
                actions={
                    <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                        重新生成
                    </CreationNoticeButton>
                }
            />
        );
    }
    if (creationMessageNeedsResultSync(item)) {
        return (
            <CreationMediaNotice
                tone="warning"
                icon={CloudOff}
                title="结果暂未同步"
                description="作品可能已在后台生成，只是页面没有及时拿到。重新获取不会重新生成，也不会重复扣费。"
                detail={reason ? `原因：${reason}` : undefined}
                actions={
                    <>
                        <CreationNoticeButton primary icon={RefreshCw} busy={refreshing} busyLabel="正在获取" onClick={onRefresh}>
                            重新获取结果
                        </CreationNoticeButton>
                        <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                            重新生成
                        </CreationNoticeButton>
                    </>
                }
            />
        );
    }
    if (item.mediaRecoverable) {
        return (
            <CreationMediaNotice
                tone="warning"
                icon={AlertTriangle}
                title="作品已生成，保存未完成"
                description="保存到素材库时出错。重新保存会接着上次的进度，不会重新生成，也不会重复扣费。"
                detail={reason ? `原因：${reason}` : undefined}
                actions={
                    <>
                        <CreationNoticeButton primary icon={RefreshCw} busy={refreshing} busyLabel="正在保存" onClick={onRecoverMedia}>
                            重新保存
                        </CreationNoticeButton>
                        <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                            重新生成
                        </CreationNoticeButton>
                    </>
                }
            />
        );
    }
    const started = Boolean(item.taskIds?.length);
    return (
        <CreationMediaNotice
            tone="error"
            icon={AlertCircle}
            title={started ? "生成失败" : "未能开始生成"}
            description={reason}
            actions={
                <CreationNoticeButton primary icon={RotateCcw} onClick={onRetry}>
                    {started ? "重新生成" : "重新编辑"}
                </CreationNoticeButton>
            }
        />
    );
}

function CreationMediaNotice({ tone, icon: Icon, title, description, detail, actions }: { tone: "warning" | "error" | "neutral"; icon: LucideIcon; title: string; description: string; detail?: string; actions: ReactNode }) {
    return (
        <div className={`creation-media-notice is-${tone}`}>
            <span className="creation-media-notice-icon" aria-hidden="true">
                <Icon />
            </span>
            <div className="creation-media-notice-copy">
                <strong>{title}</strong>
                <p>{description}</p>
                {detail ? <small>{detail}</small> : null}
            </div>
            <div className="creation-media-notice-actions">{actions}</div>
        </div>
    );
}

function CreationNoticeButton({ primary = false, icon: Icon, busy = false, busyLabel, onClick, children }: { primary?: boolean; icon: LucideIcon; busy?: boolean; busyLabel?: string; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className={primary ? "is-primary" : undefined} onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
            <Icon aria-hidden="true" className={busy ? "animate-spin" : undefined} />
            {busy && busyLabel ? busyLabel : children}
        </button>
    );
}

export function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return (
        <div className="creation-user-message-references" aria-label="本次引用">
            {references.map((reference) => {
                const Icon = reference.kind === "skill" ? SkillGlyph : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
                const imageUrl = reference.kind === "image" ? resolveResourceUrl(reference.storageKey, reference.previewUrl) : reference.previewUrl;
                return (
                    <span key={reference.id} className="creation-user-message-reference">
                        {imageUrl && reference.kind === "video" ? (
                            <video src={imageUrl} muted playsInline preload="metadata" aria-label={reference.label} />
                        ) : imageUrl && reference.kind === "image" ? (
                            <CachedResourceImage storageKey={reference.storageKey} src={imageUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                            <Icon />
                        )}
                        <span>{reference.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

export function CreationMediaPreviewModal({ url, type, onClose }: { url: string; type: "image" | "video"; onClose: () => void }) {
    if (type === "image") return <CanvasImagePreview src={url} alt="媒体预览" onClose={onClose} />;

    return (
        <AppModal flush open={Boolean(url)} title={null} footer={null} centered destroyOnHidden width="min(1160px, calc(100vw - 32px))" onCancel={onClose} className="creation-media-preview-modal">
            {url ? <video controls autoPlay className="creation-media-preview-video" src={url} /> : null}
        </AppModal>
    );
}

export function CreationAttachmentThumbnail({ item, onPreview, onRemove }: { item: CreationAttachment; onPreview: (type: "image" | "video", url: string) => void; onRemove: (id: string) => void }) {
    const kind = creationAttachmentKind(item);
    const previewable = kind === "image" || kind === "video";
    const url = (kind === "video" ? item.url : item.previewUrl) || "";
    const imageUrl = kind === "image" ? resolveResourceUrl(item.storageKey, item.previewUrl) : "";
    const previewUrl = kind === "image" ? imageUrl : url;
    const content =
        kind === "video" ? (
            <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} />
        ) : kind === "image" ? (
            <CachedResourceImage
                storageKey={item.storageKey}
                src={imageUrl}
                alt={item.name}
                loading="lazy"
                decoding="async"
                fallback={
                    <span className="creation-chat-file-icon">
                        <ImageIcon />
                    </span>
                }
            />
        ) : (
            <span className="creation-chat-file-icon">
                {kind === "audio" ? <Music2 /> : <FileText />}
                <em>{item.name}</em>
            </span>
        );
    return (
        <div className="creation-reference-card-content">
            {previewable ? (
                <button type="button" className="creation-reference-card-preview" onClick={() => onPreview(kind === "video" ? "video" : "image", previewUrl)} aria-label={`放大预览 ${item.name}`} disabled={!previewUrl}>
                    {content}
                    <span aria-hidden="true">
                        <Maximize2 />
                    </span>
                </button>
            ) : (
                <div className="creation-reference-card-preview is-file" aria-label={item.name}>
                    {content}
                </div>
            )}
            <button
                type="button"
                className="creation-reference-card-remove"
                onPointerDownCapture={(event) => event.stopPropagation()}
                onMouseDownCapture={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                }}
                aria-label={`移除 ${item.name}`}
            >
                <X />
            </button>
        </div>
    );
}

export type CreationThinking = { title: string; hint: string; steps: string[]; activity: string };

export function thinkingFor(mode: CreationMode, brandName: string): CreationThinking {
    if (mode === "image") return { title: "正在为你画这一镜", hint: `${brandName}正在理解你的构图意图，并把画面交给模型出图。`, steps: ["理解构图", "定调画风", "生成画面"], activity: "正在理解构图并把画面交给模型出图" };
    if (mode === "text") return { title: "正在为你写这段", hint: `${brandName}正在梳理你的创作脉络，组织语言与结构。`, steps: ["梳理脉络", "组织语言", "输出段落"], activity: "正在梳理脉络并组织语言" };
    return { title: "正在为你拍这一镜", hint: `${brandName}正在拆解你的镜头脚本，设计运镜与光线，并交给模型渲染成片。`, steps: ["拆解镜头", "设计运镜", "定调布光", "渲染成片"], activity: "正在按导演思路拆解镜头并渲染" };
}

export function formatMessageTime(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? conversationTimeFormatter.format(timestamp) : "";
}

type CreationMessageStateTone = "pending" | "syncing" | "sync" | "error" | "cancelled";

// 消息头部的状态标签：区分“生成中 / 重新连接中 / 结果待同步 / 生成失败 / 已停止”，不把页面没跟上说成生成失败。
function creationMessageState(item: CreationMessage): { tone: CreationMessageStateTone; label: string } | null {
    if (item.status === "pending" || item.status === "streaming") return item.syncInterrupted ? { tone: "syncing", label: "重新连接中" } : item.status === "pending" ? { tone: "pending", label: "生成中" } : null;
    if (item.status === "cancelled") return { tone: "cancelled", label: "已停止" };
    if (item.status === "error") {
        if (creationMessageNeedsResultSync(item)) return { tone: "sync", label: "结果待同步" };
        return item.mediaRecoverable ? { tone: "sync", label: "保存未完成" } : { tone: "error", label: "生成失败" };
    }
    return null;
}

function CreationSyncNotice({ refreshing, onRefresh, onRetry }: { refreshing: boolean; onRefresh: () => void; onRetry: () => void }) {
    return (
        <div className="creation-sync-notice" role="status">
            <span>
                <CloudOff aria-hidden="true" />
                连接中断，正在自动重连
            </span>
            <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing || undefined}>
                <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
                {refreshing ? "正在刷新" : "立即刷新"}
            </button>
            {/* 原任务一直拿不到（例如已在任务中心删除）时的出口；点击后会先确认再次扣费。 */}
            <button type="button" className="is-quiet" onClick={onRetry}>
                重新生成
            </button>
        </div>
    );
}
