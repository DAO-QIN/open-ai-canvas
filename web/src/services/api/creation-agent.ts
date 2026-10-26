import { apiBaseURL, http } from "./request";
import { consumeTaskTextStream, createTaskTextStreamParser } from "./task-text-stream";
import type { CreationEntry } from "./creation-sessions";
import type { AgentMediaSettings, AgentReasoningMode } from "./agent";

// 首页创作会话的 Agent（docs/design/home-agent.md §6.3、§7）。

export type CreationAgentStatus = "idle" | "ready" | "running" | "input" | "approval" | "waiting" | "composing" | "stopped" | "error";

export type CreationAgentItem = {
    id: string;
    seq: number;
    position: number;
    type: "state" | "message" | "output" | "plan" | "question" | "approval" | "result" | "usage" | "context" | "activity" | string;
    turnId?: string;
    data: Record<string, unknown>;
    createdAt: string;
};

export type CreationAgentSnapshot = {
    sessionId: string;
    status: CreationAgentStatus;
    lastSeq: number;
    items: CreationAgentItem[];
    historyBefore?: number;
    activeRunId?: string;
    agentModel?: Record<string, string>;
    reasoningEffort?: string;
};

export type CreationAgentLive = { runId: string; messageId: string; text: string };

export type CreationAgentReference = { resourceId?: string; entryId?: string; slot?: number };

export type CreationAgentMessageInput = {
    requestId: string;
    text: string;
    references?: CreationAgentReference[];
    logicalModelId?: string;
    channelId?: string;
    channelModelKey?: string;
    reasoningMode?: AgentReasoningMode;
    skillIds?: string[];
    autoContinue?: boolean;
    maxCredits?: number;
};

export type CreationAgentMessageResult = { accepted: boolean; seq: number; runId?: string; duplicate?: boolean; delivered: "run" | "interjection" };

export type CreationAgentProposal = {
    id: string;
    runId: string;
    status: "pending" | "submitting" | "rejected" | "submitted" | "completed" | "failed";
    title?: string;
    summary?: string;
    description?: string;
    details?: string[];
    modelName?: string;
    creditsMicrocredits?: string;
    quoteExpiresAt?: string;
    quoteVersion?: number;
    entryId?: string;
    error?: string;
    reason?: string;
    form?: { type?: string; prompt?: string; title?: string; count?: number; references?: unknown[]; config?: Record<string, unknown> };
};

const sessionPath = (sessionId: string) => `/creation/sessions/${encodeURIComponent(sessionId)}/agent`;

export function getCreationAgentSnapshot(sessionId: string, signal?: AbortSignal) {
    return http.get<CreationAgentSnapshot>(sessionPath(sessionId), { signal });
}

export function getCreationAgentHistory(sessionId: string, before: number, signal?: AbortSignal) {
    return http.get<{ items: CreationAgentItem[]; historyBefore?: number }>(`${sessionPath(sessionId)}/history`, { signal, params: { before } });
}

export function sendCreationAgentMessage(sessionId: string, input: CreationAgentMessageInput) {
    return http.post<CreationAgentMessageResult>(`${sessionPath(sessionId)}/messages`, input, { timeout: 30_000 });
}

export function answerCreationAgentQuestion(sessionId: string, questionId: string, input: { requestId: string; answer?: string; selectedOptions?: string[] }) {
    return http.post<CreationAgentMessageResult>(`${sessionPath(sessionId)}/questions/${encodeURIComponent(questionId)}/answer`, input, { timeout: 30_000 });
}

export function decideCreationAgentProposal(sessionId: string, proposalId: string, input: { decisionId: string; approve: boolean; reason?: string; expectedCreditsMicrocredits?: string; settings?: AgentMediaSettings }) {
    return http.post<{ proposal: CreationAgentItem; entry?: CreationEntry }>(`${sessionPath(sessionId)}/proposals/${encodeURIComponent(proposalId)}/decision`, input, { timeout: 60_000 });
}

export function stopCreationAgent(sessionId: string) {
    return http.post<{ accepted: boolean }>(`${sessionPath(sessionId)}/stop`, undefined, { timeout: 15_000 });
}

/**
 * 订阅会话公开事件。断线自动重连并从最大 seq 续读；返回取消函数。
 * 发现序号缺口时调用 onGap，由调用方重读快照后重新订阅。
 */
export function subscribeCreationAgent(
    sessionId: string,
    after: number,
    handlers: { onItem: (item: CreationAgentItem) => void; onLive: (live: CreationAgentLive | null) => void; onGap: () => void; onConnection?: (status: "connected" | "reconnecting" | "disconnected") => void },
) {
    const controller = new AbortController();
    let cursor = after;
    void (async () => {
        let failures = 0;
        while (!controller.signal.aborted) {
            try {
                const response = await fetch(`${String(apiBaseURL).replace(/\/+$/, "")}${sessionPath(sessionId)}/events?after=${cursor}`, {
                    credentials: "include",
                    signal: controller.signal,
                    headers: { Accept: "text/event-stream", "Last-Event-ID": String(cursor) },
                });
                if (!response.ok || !response.body) {
                    if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
                        handlers.onConnection?.("disconnected");
                        return;
                    }
                    throw new Error(`stream ${response.status}`);
                }
                handlers.onConnection?.("connected");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const parser = createTaskTextStreamParser();
                let gap = false;
                try {
                    while (!controller.signal.aborted && !gap) {
                        const { value, done } = await reader.read();
                        consumeTaskTextStream(
                            parser,
                            decoder.decode(value, { stream: !done }),
                            (frame) => {
                                if (frame.event === "agent") {
                                    const item = frame.data as CreationAgentItem;
                                    if (!Number.isSafeInteger(item.seq) || item.seq <= cursor) return;
                                    if (item.seq !== cursor + 1) {
                                        gap = true;
                                        return;
                                    }
                                    cursor = item.seq;
                                    failures = 0;
                                    handlers.onItem(item);
                                } else if (frame.event === "live") {
                                    handlers.onLive((frame.data as CreationAgentLive | null) || null);
                                }
                            },
                            done,
                        );
                        if (done) break;
                    }
                } finally {
                    await reader.cancel().catch(() => undefined);
                }
                if (gap) {
                    handlers.onGap();
                    return;
                }
            } catch {
                if (controller.signal.aborted) return;
                if (++failures >= 8) {
                    handlers.onConnection?.("disconnected");
                    return;
                }
                handlers.onConnection?.("reconnecting");
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** failures)));
        }
    })();
    return () => controller.abort();
}

/** 按 id 保留最大 seq 的版本，按 position 排序。 */
export function mergeCreationAgentItems(current: CreationAgentItem[], incoming: CreationAgentItem[]) {
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of incoming) {
        const previous = byId.get(item.id);
        if (!previous || previous.seq < item.seq) byId.set(item.id, previous ? { ...item, position: previous.position } : item);
    }
    return [...byId.values()].sort((left, right) => left.position - right.position);
}
