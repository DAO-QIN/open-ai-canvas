import { createClientId } from "@/lib/client-id";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { isGenerationTaskSubmissionUncertain } from "@/lib/generation-task-display";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";
import { ApiError } from "@/services/api/request";
import { creationAttachmentKind, creationSingleResultMode, type CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage, CreationMode, CreationShotRailEntry } from "./creation-types";
import { projectSmartCreationBatch } from "./smart-creation-runtime";

type CreationRuntime = typeof import("./creation-runtime");
export type PersistedCreationTask = GenerationTask & { creationResultUrls?: string[]; creationResultStorageKeys?: string[]; creationError?: string };

export function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

export function creationConversationMode(conversation: CreationConversation): CreationMode {
    const selected = conversation.composerMode || (conversation.agentSessionId ? "agent" : conversation.messages.findLast((message) => message.role === "user")?.mode || conversation.messages.at(-1)?.mode);
    return selected === "image" || selected === "video" || selected === "audio" ? selected : "agent";
}

/** 单结果模式（视频、音频）完成后的结果卡文案。 */
export function creationSingleResultDoneLabel(mode: CreationMode | undefined) {
    return mode === "audio" ? "音频已生成" : "视频已生成";
}

export function selectCreationConversationMode(conversation: CreationConversation, mode: CreationMode): CreationConversation {
    return { ...conversation, composerMode: mode === "text" ? "agent" : mode };
}

export function newMessage(role: CreationMessage["role"], content: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id: createClientId(), role, content, createdAt: new Date().toISOString(), ...extra };
}

export function creationShotRail(messages: CreationMessage[]): CreationShotRailEntry[] {
    const rail: CreationShotRailEntry[] = [];
    let ordinal = 0;
    let lastIndex = -1;
    for (const message of messages) {
        const isVideo = (message.mode || "text") === "video";
        if (message.role === "user") {
            if (!isVideo) continue;
            ordinal += 1;
            rail.push({ key: message.id, ordinal, user: message });
            lastIndex = rail.length - 1;
        } else if (isVideo && lastIndex >= 0 && !rail[lastIndex].result) {
            rail[lastIndex].result = message;
        }
    }
    return rail;
}

export function creationVideoShotOrdinal(shots: CreationShotRailEntry[], item: CreationMessage): number {
    const own = shots.find((entry) => item.role === "user" ? entry.user.id === item.id : entry.result?.id === item.id);
    return own?.ordinal || 0;
}

export function completedCreationGenerationTask(runtime: CreationRuntime, input: { taskId: string; task?: GenerationTask; mode: "image" | "video" | "audio"; prompt: string; result: BackendGenerationResult; conversationId: string; messageId: string; batchIndex?: number; batchCount?: number }): GenerationTask {
    const now = new Date().toISOString();
    const task = input.task ?? { id: input.taskId, type: input.mode, status: "succeeded" as const, prompt: input.prompt, attempts: 1, createdAt: now, updatedAt: now };
    return runtime.projectGenerationTaskResult({ ...task, status: "succeeded", prompt: input.prompt, clientContext: { conversationId: input.conversationId, messageId: input.messageId, ...(typeof input.batchIndex === "number" ? { batchIndex: input.batchIndex } : {}), ...(typeof input.batchCount === "number" ? { batchCount: input.batchCount } : {}) } }, input.result);
}

export function isVideoAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { url: string } {
    return creationAttachmentKind(attachment) === "video";
}

export function isImageAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { dataUrl: string; width?: number; height?: number } {
    return creationAttachmentKind(attachment) === "image";
}

function isCreationAgentMediaTask(message: CreationMessage) {
    return Boolean(message.agentRunId && message.id.startsWith("task-") && (message.mode === "image" || message.mode === "video"));
}

export function attachCreationTaskContexts(tasks: GenerationTask[], conversations: CreationConversation[]) {
    const contexts = new Map<string, { prompt: string; clientContext: NonNullable<GenerationTask["clientContext"]> }>();
    for (const conversation of conversations) {
        for (const [messageIndex, message] of conversation.messages.entries()) {
            if (message.role !== "assistant" || !message.taskIds?.length) continue;
            const prompt = conversation.messages.slice(0, messageIndex).reverse().find((candidate) => candidate.role === "user")?.content || "";
            for (const [batchIndex, taskId] of message.taskIds.entries()) {
                const task = tasks.find((candidate) => candidate.id === taskId);
                contexts.set(taskId, {
                    prompt,
                    clientContext: {
                        conversationId: conversation.id,
                        messageId: message.id,
                        batchIndex,
                        batchCount: isCreationAgentMediaTask(message) ? 1 : message.batchTotal || task?.clientContext?.batchCount || message.taskIds.length,
                    },
                });
            }
        }
    }
    return tasks.map((task) => {
        const context = contexts.get(task.id) || (task.retryOf ? contexts.get(task.retryOf) : undefined) || (task.attemptGroupId ? contexts.get(task.attemptGroupId) : undefined);
        return context ? { ...task, prompt: context.prompt, clientContext: context.clientContext } : task;
    });
}

export async function materializeCreationTaskResults(runtime: CreationRuntime, tasks: GenerationTask[], signal?: AbortSignal): Promise<PersistedCreationTask[]> {
    return Promise.all(tasks.map(async (task): Promise<PersistedCreationTask> => {
        // 文本正文保存在 resultJson，不进入媒体资源化链路。
        if (task.status !== "succeeded" || !task.clientContext || task.type === "canvas_text") return task;
        try {
            const materialized = await runtime.runGenerationConsumer(signal, (managedSignal: AbortSignal) => runtime.materializeGenerationTaskAssets(task, managedSignal));
            const creationResultUrls = runtime.generationTaskMaterializedUrls(materialized);
            const creationResultStorageKeys = runtime.generationTaskMaterializedStorageKeys(materialized);
            return creationResultUrls.length || creationResultStorageKeys.length ? { ...materialized, ...(creationResultUrls.length ? { creationResultUrls } : {}), ...(creationResultStorageKeys.length ? { creationResultStorageKeys } : {}) } : materialized;
        } catch (error) {
            return { ...task, creationError: error instanceof Error ? error.message : "生成结果资源化失败" };
        }
    }));
}

export function mergeCreationTaskObservations(observed: Map<string, PersistedCreationTask>, tasks: PersistedCreationTask[], pendingTaskIds: readonly string[]) {
    const pending = new Set(pendingTaskIds);
    for (const id of observed.keys()) if (!pending.has(id)) observed.delete(id);
    for (const task of tasks) if (pending.has(task.id)) observed.set(task.id, task);
    return Array.from(observed.values());
}

export function applyRecoveredCreationResult(message: CreationMessage, resultUrls: string[], resultStorageKeys: string[], batchCount: number) {
    if (message.status === "cancelled") return message;
    const nextResultUrls = Array.from(new Set([...(message.resultUrls || []), ...resultUrls]));
    const nextStorageKeys = Array.from(new Set([...(message.resultStorageKeys || []), ...resultStorageKeys]));
    if (isCreationAgentMediaTask(message)) return { ...message, status: "done" as const, taskStatePending: undefined, error: undefined, generationErrorCode: undefined, resultUrls: nextResultUrls, resultStorageKeys: nextStorageKeys };
    if (creationSingleResultMode(message.mode)) return { ...message, status: "done" as const, content: creationSingleResultDoneLabel(message.mode), error: undefined, generationErrorCode: undefined, resultUrls: nextResultUrls, resultStorageKeys: nextStorageKeys };
    const projection = projectSmartCreationBatch({ total: message.batchTotal || batchCount, resultUrls: nextResultUrls, resultStorageKeys: nextStorageKeys, failedCount: message.batchFailedCount || 0 });
    return { ...message, ...projection, ...(message.submissionPending ? { status: "pending" as const } : {}), error: undefined, generationErrorCode: undefined };
}

export async function consumeCreationImageResults(runtime: CreationRuntime, task: GenerationTask, messageId: string, batchCount: number, updateMessage: (update: (message: CreationMessage) => CreationMessage) => Promise<unknown>, signal?: AbortSignal) {
    const materialized = await runtime.consumeGenerationTaskMessage(task, messageId, async ({ resultUrls, resultStorageKeys, effectKey }) => {
        await updateMessage((message) => runtime.applyGenerationConsumerEffect(message, effectKey, (current) => applyRecoveredCreationResult(current, resultUrls, resultStorageKeys, batchCount)).value);
    }, { signal });
    const urls = runtime.generationTaskMaterializedUrls(materialized);
    const storageKeys = runtime.generationTaskMaterializedStorageKeys(materialized);
    const results = Array.from({ length: Math.max(urls.length, storageKeys.length) }, (_, index) => ({ url: urls[index] || "", storageKey: storageKeys[index] || "" }));
    if (!results.length) throw new Error("图片结果资源不可用");
    return results;
}

export function projectCreationImageFailure(message: CreationMessage, batchTotal?: number) {
    if (batchTotal) return { ...message, ...projectSmartCreationBatch({ total: message.batchTotal || batchTotal, resultUrls: message.resultUrls || [], resultStorageKeys: message.resultStorageKeys || [], failedCount: (message.batchFailedCount || 0) + 1 }) };
    if (message.resultUrls?.length || message.resultStorageKeys?.length) return { ...message, status: "done" as const, content: "图片已生成" };
    return { ...message, status: "error" as const, content: "生成失败" };
}

export function projectCreationTaskWaitFailure(message: CreationMessage, error: unknown, context: { cancelled: boolean; unmounted: boolean; boundTaskCount: number; batchSubmission?: boolean; batchTotal?: number; operation?: string }): CreationMessage {
    if (context.unmounted && context.boundTaskCount > 0) return message;
    if (context.cancelled && !context.batchSubmission) return { ...message, status: "cancelled", content: "已停止" };
    const next = message.mode === "image" ? projectCreationImageFailure(message, context.batchSubmission ? context.batchTotal : undefined) : { ...message, status: "error" as const, content: "生成失败" };
    if (!context.batchSubmission && next.status === "done") return next;
    return { ...next, error: generationErrorMessage(error), generationErrorCode: message.generationErrorCode || generationErrorCode(error), generationOperation: message.generationOperation || context.operation };
}

export function bindCreationSubmissionTask(message: CreationMessage, task: GenerationTask) {
    const taskIds = Array.from(new Set([...(message.taskIds || []), task.id]));
    const expected = message.mode === "image" ? message.batchTotal || Number(message.settings?.count) || 1 : 1;
    return { ...message, generationStage: task.stage, generationOperation: task.operation, generationErrorCode: task.errorCode, taskIds, clientOperationId: message.clientOperationId || task.clientOperationId, retryOf: task.retryOf, attemptGroupId: task.attemptGroupId, submissionPending: message.submissionPending && taskIds.length < expected ? true : undefined };
}

export async function recoverCreationGenerationSubmission(runtime: CreationRuntime, conversationId: string, message: CreationMessage, updateMessage: (update: (message: CreationMessage) => CreationMessage) => Promise<unknown>, signal?: AbortSignal) {
    if (!message.clientOperationId) throw new Error("缺少原提交记录，请先核对任务中心中的生成记录");
    const tasks = new Map<string, GenerationTask>();
    let updates = Promise.resolve<unknown>(undefined);
    let recoveryError: unknown;
    let recoveredFromStore = false;
    const expected = creationSingleResultMode(message.mode) ? 1 : message.batchTotal || Number(message.settings?.count) || 0;
    const onTaskUpdate = (task: GenerationTask) => {
        tasks.set(task.id, task);
        updates = updates.then(() => updateMessage((current) => bindCreationSubmissionTask(current, task)));
    };
    await updateMessage((current) => ({ ...current, status: "pending", submissionPending: true, error: undefined, generationErrorCode: undefined }));
    try {
        const known = Array.from(new Set(message.taskIds || []));
        if (known.length) {
            const lookups = await Promise.allSettled(known.map(async (id) => {
                const task = await runtime.queryGenerationTask(id, { signal });
                if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
                onTaskUpdate(task);
            }));
            const failure = lookups.find((result) => result.status === "rejected");
            if (failure?.status === "rejected") throw failure.reason;
        }
        if (!expected || latestCreationTaskAttempts([...tasks.values()]).length < expected) {
            recoveredFromStore = true;
            const keys = creationSingleResultMode(message.mode) ? [message.clientOperationId]
                : Number.isInteger(expected) && expected > 0 && expected <= 15 ? Array.from({ length: expected }, (_, index) => `${message.clientOperationId}:batch:${index}`) : undefined;
            await runtime.recoverGenerationSubmission(message.clientOperationId, { signal, keys, onTaskUpdate });
        }
    } catch (error) {
        recoveryError = error;
        throw error;
    } finally {
        await updates;
        if (signal?.aborted || (recoveryError instanceof DOMException && recoveryError.name === "AbortError")) throw recoveryError || new DOMException("Aborted", "AbortError");
        const pending = (recoveredFromStore && await runtime.hasPendingGenerationSubmission(message.clientOperationId)) || Boolean(recoveryError && !(recoveryError instanceof ApiError && recoveryError.reason === "generation_submission_rejected"));
        const contextual = [...tasks.values()].map((task) => ({ ...task, clientContext: { ...task.clientContext, conversationId, messageId: message.id, batchCount: task.clientContext?.batchCount || message.batchTotal || Number(message.settings?.count) || 1 } }));
        const persisted = await materializeCreationTaskResults(runtime, contextual, signal);
        await updateMessage((current) => {
            const conversation = { id: conversationId, title: "", updatedAt: current.createdAt, messages: [{ ...current, submissionPending: undefined }] };
            const recovered = reconcileCreationTaskMessages(runtime, [conversation], persisted)[0].messages[0];
            if (recoveryError && !pending) return projectCreationTaskWaitFailure(recovered, recoveryError, { cancelled: false, unmounted: false, boundTaskCount: recovered.taskIds?.length || 0 });
            return { ...recovered, submissionPending: pending || undefined, ...(pending ? { status: "pending" as const, error: undefined, generationErrorCode: undefined } : {}) };
        });
    }
}

// 重试只复核原消息的任务；查询或物化暂不可用时不能放行另一次生成。
export async function refreshCreationMessageTasks(runtime: CreationRuntime, conversation: CreationConversation, message: CreationMessage, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const taskIds = Array.from(new Set(message.taskIds || []));
    if (!taskIds.length) return { conversation, canRetry: true, retryableTaskIds: [] as string[] };
    const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal })));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const persisted = await materializeCreationTaskResults(runtime, attachCreationTaskContexts(tasks, [conversation]), signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const latest = latestCreationTaskAttempts(tasks);
    const safeToRetry = (task: GenerationTask) => !task.canRecoverMedia
        && !isGenerationTaskSubmissionUncertain(task) && task.errorCode !== "provider_submission_unknown"
        && task.diagnostic?.submissionOutcome !== "unknown" && task.diagnostic?.retryClass !== "reconcile_submission"
        && task.providerCancelStatus !== "requested" && task.providerCancelStatus !== "uncertain"
        && (!task.billing || task.billing.status === "settled" || task.billing.status === "refunded");
    const retryableTaskIds = latest.filter((task) => task.status === "failed" && safeToRetry(task)).map((task) => task.id);
    return {
        conversation: reconcileCreationTaskMessages(runtime, [conversation], persisted, { reviveMessageIds: new Set([message.id]) })[0],
        canRetry: retryableTaskIds.length > 0 || latest.length > 0 && latest.every((task) => task.status === "cancelled" && safeToRetry(task)),
        retryableTaskIds,
    };
}

/** 失败但后端没有确认任务失败（含旧版本未分类的失败）：作品可能已生成，应提供“重新获取结果”。 */
export function creationMessageNeedsResultSync(message: Pick<CreationMessage, "status" | "errorKind" | "taskIds">) {
    return message.status === "error" && message.errorKind !== "task" && Boolean(message.taskIds?.length);
}

// 仍需用任务终态来收敛的媒体消息：生成中，或失败但后端没有确认失败。
function creationMediaMessageAwaitsTask(message: CreationMessage, revive: boolean) {
    if (message.role !== "assistant") return false;
    return revive || message.status === "pending" || creationMessageNeedsResultSync(message);
}

const clearedCreationSyncState = { syncInterrupted: undefined, errorKind: undefined, mediaRecoverable: undefined, generationErrorCode: undefined, taskStatePending: undefined } satisfies Partial<CreationMessage>;

/** 任务仍在进行：消息回到生成中，并刷新阶段与真实进度；没有变化时返回原对象，避免无谓重渲染与持久化。 */
function creationMessageWithObservedTask(message: CreationMessage, task: GenerationTask): CreationMessage {
    const progress = typeof task.progress === "number" && Number.isFinite(task.progress) ? Math.round(task.progress) : undefined;
    const unchanged =
        message.status === "pending" &&
        !message.syncInterrupted &&
        !message.error &&
        !message.errorKind &&
        message.generationStatus === task.status &&
        message.generationStage === task.stage &&
        message.generationMediaStage === task.mediaStage &&
        message.generationProgress === progress;
    if (unchanged) return message;
    return {
        ...message,
        ...clearedCreationSyncState,
        status: "pending",
        content: message.status === "pending" || isCreationAgentMediaTask(message) ? message.content : "",
        error: undefined,
        generationStatus: task.status,
        generationStage: task.stage,
        generationMediaStage: task.mediaStage,
        generationProgress: progress,
    };
}

export function reconcileCreationTaskMessages(runtime: CreationRuntime, conversations: CreationConversation[], tasks: PersistedCreationTask[], options: { reviveMessageIds?: ReadonlySet<string> } = {}) {
    let changed = false;
    const next = conversations.map((conversation) => {
        let conversationChanged = false;
        let completedAt = conversation.updatedAt;
        const messages = conversation.messages.map((message) => {
            const taskIds = new Set(message.taskIds || []);
            const matched = tasks.filter((task) => taskIds.has(task.id) || Boolean(task.retryOf && taskIds.has(task.retryOf)) || Boolean(task.attemptGroupId && taskIds.has(task.attemptGroupId)) || (task.clientContext?.conversationId === conversation.id && task.clientContext.messageId === message.id));
            const matches = latestCreationTaskAttempts(matched)
                .sort((left, right) => (left.clientContext?.batchIndex || 0) - (right.clientContext?.batchIndex || 0));
            const active = matches.filter((task) => task.status === "queued" || task.status === "running");
            if (message.role === "assistant" && message.mode === "text") {
                const recovery = runtime.recoverCreationTextTask(message, matches);
                if (!recovery) {
                    // 恢复监听已重新拿到任务状态，连接中断提示可以收起；正文仍等任务终态一次性回填。
                    if (!message.syncInterrupted || !active.length) return message;
                    conversationChanged = true;
                    changed = true;
                    return { ...message, syncInterrupted: undefined };
                }
                completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
                conversationChanged = true;
                changed = true;
                return { ...message, ...recovery, syncInterrupted: undefined };
            }
            if (!creationMediaMessageAwaitsTask(message, Boolean(options.reviveMessageIds?.has(message.id)))) return message;
            const expectedTaskCount = isCreationAgentMediaTask(message) ? 1 : Math.max(0, ...matches.map((task) => task.clientContext?.batchCount || 0)) || (creationSingleResultMode(message.mode) ? 1 : Number(message.settings?.count) || 0);
            if (!matches.length) return message;
            if (active.length && !matches.some((task) => task.status === "succeeded" && (creationTaskResultUrls(task).length || creationTaskResultStorageKeys(task).length))) {
                const observed = creationMessageWithObservedTask(message, active[0]);
                if (observed === message) return message;
                conversationChanged = true;
                changed = true;
                return observed;
            }

            const succeeded = matches.filter((task) => task.status === "succeeded");
            const resultUrls = Array.from(new Set([...(message.resultUrls || []), ...succeeded.flatMap(creationTaskResultUrls)]));
            const resultStorageKeys = Array.from(new Set([...(message.resultStorageKeys || []), ...succeeded.flatMap(creationTaskResultStorageKeys)]));
            const observedFailedCount = matches.filter((task) => task.status !== "succeeded" && task.status !== "queued" && task.status !== "running").length;
            const total = message.batchTotal || expectedTaskCount || matches.length;
            const failedCount = matches.length >= total ? observedFailedCount : Math.max(message.batchFailedCount || 0, observedFailedCount);
            const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
            const taskStatuses = { ...message.taskStatuses, ...Object.fromEntries(matches.map((task) => [task.id, task.status])) };
            const submissionPending = message.submissionPending && !(expectedTaskCount > 0 && matches.length >= (message.batchTotal || expectedTaskCount));
            const nextMessage = { ...message, ...clearedCreationSyncState, taskIds: nextTaskIds, taskStatuses, submissionPending: submissionPending || undefined };
            completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
            conversationChanged = true;
            changed = true;

            // Agent 的每条 task 消息是一项交付；batchTotal 仅供父卡汇总，不能用它等待整套结果或覆盖场景标题。
            if (isCreationAgentMediaTask(message)) {
                nextMessage.taskStatePending = undefined;
                if (succeeded.length && (resultUrls.length || resultStorageKeys.length)) return { ...nextMessage, status: "done" as const, resultUrls, resultStorageKeys, error: undefined, generationErrorCode: undefined };
                if (matches.some((task) => task.status === "queued" || task.status === "running")) return { ...nextMessage, status: "pending" as const, error: undefined, generationErrorCode: undefined };
                if (matches.every((task) => task.status === "cancelled")) return { ...nextMessage, status: "cancelled" as const, error: undefined, generationErrorCode: undefined };
                const failed = matches.find((task) => task.status === "failed" || task.creationError);
                const error = failed?.creationError || failed?.error || "任务已结束，但生成结果暂时无法读取";
                return { ...nextMessage, status: "error" as const, error: generationErrorMessage(error), generationErrorCode: generationErrorCode(error) };
            }
            if (!resultUrls.length && !resultStorageKeys.length && !submissionPending && total <= 1) {
                const unavailable = succeeded.find((task) => task.creationError) || succeeded[0];
                if (unavailable) return { ...nextMessage, status: "error" as const, content: "结果待同步", errorKind: "sync" as const, error: generationErrorMessage(unavailable.creationError || "任务已完成，但生成结果暂时无法读取"), generationStatus: "succeeded" as const };
                const failed = matches.find((task) => task.status === "failed");
                if (failed) return { ...nextMessage, status: "error" as const, content: "生成失败", errorKind: "task" as const, mediaRecoverable: matches.some((task) => task.canRecoverMedia) || undefined, error: generationErrorMessage(failed.error || "任务已结束，但没有返回结果"), generationStatus: "failed" as const, generationMediaStage: failed.mediaStage };
            }
            if (submissionPending) return { ...nextMessage, status: "pending" as const, resultUrls, resultStorageKeys, batchFailedCount: observedFailedCount, error: undefined, generationErrorCode: undefined };
            if (creationSingleResultMode(message.mode)) {
                if (resultUrls.length || resultStorageKeys.length) return { ...nextMessage, status: "done" as const, content: creationSingleResultDoneLabel(message.mode), resultUrls, resultStorageKeys, error: undefined, generationErrorCode: undefined };
                if (matches.some((task) => task.status === "queued" || task.status === "running")) return { ...nextMessage, status: "pending" as const, error: undefined, generationErrorCode: undefined };
            }
            if (matches.length >= total && matches.every((task) => task.status === "cancelled")) {
                return { ...nextMessage, status: "cancelled" as const, content: "已停止", error: undefined };
            }
            const projection = projectSmartCreationBatch({
                total,
                resultUrls,
                resultStorageKeys,
                failedCount,
            });
            if (projection.status !== "error") {
                return { ...nextMessage, ...projection, error: undefined, generationErrorCode: undefined };
            }
            const failed = matches.find((task) => task.status === "failed" || task.creationError);
            return { ...nextMessage, status: "error" as const, content: "生成失败", batchFailedCount: failedCount, error: generationErrorMessage(failed?.creationError || failed?.error || "任务已结束，但生成结果暂时无法读取") };
        });
        return conversationChanged ? { ...conversation, messages, updatedAt: completedAt } : conversation;
    });
    return changed ? next : conversations;
}

// 重试只替换同一原任务的一次尝试，不能当作新的批次交付槽位。
function latestCreationTaskAttempts<T extends GenerationTask>(tasks: T[]): T[] {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const superseded = new Set(tasks.flatMap((task) => task.retryOf ? [task.retryOf] : []));
    const latest = new Map<string, T>();
    for (const task of tasks) {
        if (superseded.has(task.id)) continue;
        let root = task.id;
        let current: T | undefined = task;
        const visited = new Set<string>();
        while (current?.retryOf && !visited.has(current.id)) {
            visited.add(current.id);
            root = current.retryOf;
            current = byId.get(root);
        }
        const previous = latest.get(root);
        if (!previous || conversationTimestamp(task.createdAt) >= conversationTimestamp(previous.createdAt)) latest.set(root, task);
    }
    return [...latest.values()];
}

function creationTaskResultUrls(task: PersistedCreationTask) {
    if (task.creationResultUrls?.length) return task.creationResultUrls;
    return [];
}

function creationTaskResultStorageKeys(task: PersistedCreationTask) {
    if (task.creationResultStorageKeys?.length) return task.creationResultStorageKeys;
    return [];
}

export function conversationTimestamp(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}
