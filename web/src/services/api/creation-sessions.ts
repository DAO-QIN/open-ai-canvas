import { compactApiParams, http } from "./request";
import type { CreateTaskInput } from "./task-center";

// 首页创作会话与生成记录（docs/design/home-agent.md §6.1、§6.2）。
// 与 creation-runs（画布创意互动）无关。

export type CreationSessionMode = "agent" | "image" | "video" | "text" | "audio";
export type CreationEntryType = "image" | "video" | "text" | "audio";
export type CreationEntryStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type CreationSlotStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type CreationSession = {
    id: string;
    title: string;
    lastMode: string;
    agentStatus: string;
    agentModel: string;
    reasoningEffort: string;
    skillIds: string[];
    activeRunId?: string;
    lastSeq: number;
    entryCount: number;
    latestEntryId?: string;
    canvasId?: string;
    createdAt: string;
    updatedAt: string;
};

export type CreationSessionPage = { sessions: CreationSession[]; nextCursor?: string };

export type CreationReference = {
    kind: "resource" | "entry_result";
    resourceId?: string;
    storageKey?: string;
    entryId?: string;
    slot?: number;
    label?: string;
};

export type CreationResultResource = {
    resourceId: string;
    storageKey: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
};

export type CreationResultSlot = {
    slot: number;
    taskId?: string;
    status: CreationSlotStatus;
    resources?: CreationResultResource[];
    text?: string;
    failure?: string;
};

export type CreationEntry = {
    id: string;
    sessionId: string;
    origin: "manual" | "agent";
    proposalId?: string;
    clientOperationId: string;
    retryOf?: string;
    type: CreationEntryType;
    prompt: string;
    config: Record<string, unknown>;
    references: CreationReference[];
    creditsMicrocredits: string;
    status: CreationEntryStatus;
    results: CreationResultSlot[];
    hiddenFailed: boolean;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type CreationEntryPage = { entries: CreationEntry[]; nextBefore?: string };

export type SubmitCreationEntryInput = {
    clientOperationId: string;
    type: CreationEntryType;
    prompt: string;
    config?: Record<string, unknown>;
    references?: CreationReference[];
    tasks: CreateTaskInput[];
};

export type ImportedCreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: string;
    content: string;
    status?: string;
    createdAt?: string;
    taskIds?: string[];
    resultStorageKeys?: string[];
    settings?: Record<string, unknown>;
    attachments?: Array<{ name: string; storageKey?: string }>;
};

export type ImportedCreationSession = { id: string; title: string; updatedAt: string; messages: ImportedCreationMessage[] };

export type ImportCreationSessionsResult = {
    imported: string[];
    skipped: Array<{ id: string; reason: string }>;
    entries: Record<string, number>;
    sessions: CreationSession[];
};

export function listCreationSessions(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}) {
    return http.get<CreationSessionPage>("/creation/sessions", { params: compactApiParams({ cursor: options.cursor, limit: options.limit }), signal: options.signal });
}

export function createCreationSession(input: { title?: string; mode?: CreationSessionMode }) {
    return http.post<CreationSession>("/creation/sessions", input);
}

export function getCreationSession(id: string, signal?: AbortSignal) {
    return http.get<CreationSession>(`/creation/sessions/${encodeURIComponent(id)}`, { signal });
}

export function updateCreationSession(id: string, input: { title?: string; lastMode?: CreationSessionMode; agentModel?: string; reasoningEffort?: string; skillIds?: string[] }) {
    return http.patch<CreationSession>(`/creation/sessions/${encodeURIComponent(id)}`, input);
}

export function deleteCreationSession(id: string) {
    return http.delete<{ deleted: boolean }>(`/creation/sessions/${encodeURIComponent(id)}`);
}

export function importCreationSessions(sessions: ImportedCreationSession[]) {
    return http.post<ImportCreationSessionsResult>("/creation/sessions/import", { sessions });
}

export function listCreationEntries(sessionId: string, options: { before?: string; limit?: number; signal?: AbortSignal } = {}) {
    return http.get<CreationEntryPage>(`/creation/sessions/${encodeURIComponent(sessionId)}/entries`, { params: compactApiParams({ before: options.before, limit: options.limit }), signal: options.signal });
}

export function submitCreationEntry(sessionId: string, input: SubmitCreationEntryInput) {
    return http.post<CreationEntry>(`/creation/sessions/${encodeURIComponent(sessionId)}/entries`, input);
}

export function getCreationEntry(id: string, signal?: AbortSignal) {
    return http.get<CreationEntry>(`/creation/entries/${encodeURIComponent(id)}`, { signal });
}

export function retryCreationEntry(id: string) {
    return http.post<CreationEntry>(`/creation/entries/${encodeURIComponent(id)}/retry`);
}

export function clearCreationEntryFailed(id: string) {
    return http.post<CreationEntry>(`/creation/entries/${encodeURIComponent(id)}/clear-failed`);
}

/** 读取会话内全部生成记录（按创建时间正序），最多 maxPages 页，防止超长会话一次拉取过多。 */
export async function listAllCreationEntries(sessionId: string, options: { maxPages?: number; signal?: AbortSignal } = {}) {
    const entries: CreationEntry[] = [];
    let before: string | undefined;
    const maxPages = options.maxPages ?? 10;
    for (let page = 0; page < maxPages; page += 1) {
        const result = await listCreationEntries(sessionId, { before, limit: 100, signal: options.signal });
        entries.push(...result.entries);
        if (!result.nextBefore) return { entries: entries.reverse(), complete: true };
        before = result.nextBefore;
    }
    return { entries: entries.reverse(), complete: false };
}
