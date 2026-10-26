import type { CreationEntry, CreationReference, CreationSession, ImportedCreationSession } from "@/services/api/creation-sessions";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage, CreationSettings } from "./creation-types";

// 首页会话以服务端为准（docs/design/home-agent.md §6）。浏览器里的消息只做缓存：
// 本页正在生成或已物化的消息比服务端记录更完整，按 clientOperationId / entryId 对上后保留本地版本，
// 其余记录（其他设备或刷新前的）由服务端记录还原。

/** 服务端会话 ID 由后端生成；本地新建、尚未提交过的会话用这个前缀区分。 */
export const LOCAL_CONVERSATION_PREFIX = "local:";

export function isLocalConversationId(id: string) {
    return id.startsWith(LOCAL_CONVERSATION_PREFIX);
}

type StoredAttachment = { id: string; name: string; type: string; storageKey: string; width?: number; height?: number; bytes?: number; role?: string; slotKey?: string };

/** 生成记录 config 中保存的展示信息；服务端不解读，只原样返回。 */
export type CreationEntryClientConfig = {
    model?: string;
    settings?: CreationSettings;
    attachments?: StoredAttachment[];
};

function resourceFileHint(storageKey: string) {
    const id = resourceIdFromStorageKey(storageKey);
    return id ? resourceFileUrl(id) : "";
}

/** 只保存已上传的附件；仍是本地数据的附件在提交任务时才上传，不进入服务端记录。 */
export function creationEntryAttachmentConfig(attachments: CreationAttachment[]): { attachments: StoredAttachment[]; references: CreationReference[] } {
    const stored: StoredAttachment[] = [];
    const references: CreationReference[] = [];
    for (const attachment of attachments) {
        const storageKey = attachment.storageKey || "";
        if (!storageKey.startsWith("resource:")) continue;
        const media = attachment as Partial<StoredAttachment>;
        stored.push({ id: attachment.id, name: attachment.name, type: attachment.type, storageKey, width: media.width, height: media.height, bytes: media.bytes, role: media.role, slotKey: media.slotKey });
        references.push({ kind: "resource", storageKey, label: attachment.name.slice(0, 80) });
    }
    return { attachments: stored.slice(0, 14), references: references.slice(0, 14) };
}

function restoredAttachment(item: StoredAttachment): CreationAttachment {
    const url = resourceFileHint(item.storageKey);
    const base = { id: item.id, name: item.name, type: item.type, storageKey: item.storageKey, previewUrl: url, bytes: item.bytes };
    const kind = creationAttachmentKind({ type: item.type });
    if (kind === "image") return { ...base, dataUrl: "", url, width: item.width, height: item.height, role: item.role, slotKey: item.slotKey } as CreationAttachment;
    if (kind === "file") return { ...base, url, bytes: item.bytes || 0 } as CreationAttachment;
    return { ...base, url, role: item.role, slotKey: item.slotKey } as CreationAttachment;
}

function entryStatus(entry: CreationEntry): CreationMessage["status"] {
    switch (entry.status) {
        case "succeeded":
        case "partial":
            return "done";
        case "failed":
            return "error";
        case "cancelled":
            return "cancelled";
        default:
            return "pending";
    }
}

function entryAssistantContent(entry: CreationEntry) {
    const texts = entry.results.map((result) => result.text || "").filter(Boolean);
    if (entry.type === "text") return texts.join("\n\n") || (entry.status === "failed" ? "生成失败" : "");
    const succeeded = entry.results.filter((result) => result.status === "succeeded").length;
    const failed = entry.results.filter((result) => result.status === "failed").length;
    const label = entry.type === "image" ? "图片" : entry.type === "video" ? "视频" : "音频";
    if (entry.status === "failed") return "生成失败";
    if (entry.status === "cancelled") return "已停止";
    if (entry.status === "partial") return `${succeeded} 个${label}已生成，${failed} 个失败`;
    if (entry.status === "succeeded") return `${label}已生成`;
    return "";
}

/** 一条生成记录还原为一问一答两条消息。重试后已隐藏的整条失败记录不再显示。 */
export function creationEntryMessages(entry: CreationEntry): CreationMessage[] {
    const visibleResults = entry.results.filter((result) => !(entry.hiddenFailed && (result.status === "failed" || result.status === "cancelled")));
    if (entry.hiddenFailed && !visibleResults.length && (entry.status === "failed" || entry.status === "cancelled")) return [];
    const config = (entry.config || {}) as CreationEntryClientConfig;
    const mode = entry.type === "audio" ? "text" : entry.type;
    const attachments = (config.attachments || []).filter((item) => item?.storageKey?.startsWith("resource:")).map(restoredAttachment);
    const failure = entry.results.find((result) => result.failure)?.failure;
    const user: CreationMessage = {
        id: `entry-user:${entry.id}`,
        role: "user",
        mode,
        content: entry.prompt,
        createdAt: entry.createdAt,
        model: config.model,
        settings: config.settings,
        ...(attachments.length ? { attachments } : {}),
    };
    const assistant: CreationMessage = {
        id: `entry:${entry.id}`,
        role: "assistant",
        mode,
        content: entryAssistantContent(entry),
        createdAt: entry.createdAt,
        status: entryStatus(entry),
        model: config.model,
        settings: config.settings,
        taskIds: entry.results.flatMap((result) => (result.taskId ? [result.taskId] : [])),
        resultStorageKeys: visibleResults.flatMap((result) => (result.resources || []).map((resource) => resource.storageKey)),
        clientOperationId: entry.clientOperationId,
        entryId: entry.id,
        ...(entry.status === "failed" && failure ? { error: failure } : {}),
    };
    return [user, assistant];
}

type MessageGroup = { createdAt: string; messages: CreationMessage[] };

function groupMessages(messages: CreationMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    for (const message of messages) {
        const last = groups.at(-1);
        if (message.role === "assistant" && last && last.messages.length === 1 && last.messages[0].role === "user") {
            last.messages.push(message);
            continue;
        }
        groups.push({ createdAt: message.createdAt, messages: [message] });
    }
    return groups;
}

/**
 * 合并本地缓存与服务端记录：本地已有的生成（按 entryId 或 clientOperationId 对上）保留本地消息并补上 entryId；
 * 服务端多出来的记录还原后按时间插入。本地尚未写入服务端的消息（提交中）原样保留。
 */
export function mergeCreationMessages(local: CreationMessage[], entries: CreationEntry[]): CreationMessage[] {
    const byOperation = new Map(entries.map((entry) => [entry.clientOperationId, entry]));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    // 本地历史导入生成的记录，幂等键为 import:<会话>:<助手消息 ID>，据此对上本机缓存里的原消息。
    const byImportedMessage = new Map(entries.flatMap((entry) => (entry.clientOperationId.startsWith("import:") ? [[entry.clientOperationId.slice(entry.clientOperationId.lastIndexOf(":") + 1), entry] as const] : [])));
    const matched = new Set<string>();
    const localGroups = groupMessages(local).flatMap((group) => {
        let duplicate = false;
        const messages = group.messages.map((message) => {
            if (message.role !== "assistant") return message;
            const entry = (message.entryId && byId.get(message.entryId)) || (message.clientOperationId && byOperation.get(message.clientOperationId)) || byImportedMessage.get(message.id) || undefined;
            if (!entry) return message;
            // 同一记录已经对上过本地消息时，之前由服务端还原的那组是重复的。
            duplicate = matched.has(entry.id) && message.id.startsWith("entry:");
            matched.add(entry.id);
            return message.entryId === entry.id ? message : { ...message, entryId: entry.id };
        });
        return duplicate ? [] : [{ createdAt: group.createdAt, messages }];
    });
    const remoteGroups = entries
        .filter((entry) => !matched.has(entry.id))
        .map((entry) => ({ createdAt: entry.createdAt, messages: creationEntryMessages(entry) }))
        .filter((group) => group.messages.length);
    return [...localGroups, ...remoteGroups]
        .map((group, index) => ({ ...group, index }))
        .sort((left, right) => (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0) || left.index - right.index)
        .flatMap((group) => group.messages);
}

/** 服务端会话列表并入本地缓存：服务端提供标题与排序，本地缓存提供已加载的消息。 */
export function mergeCreationSessions(local: CreationConversation[], sessions: CreationSession[]): CreationConversation[] {
    const localById = new Map(local.map((conversation) => [conversation.id, conversation]));
    const fromServer = sessions.map((session) => {
        const cached = localById.get(session.id);
        return { ...(cached || { messages: [] }), id: session.id, title: session.title, updatedAt: session.updatedAt, canvasId: cached?.canvasId || session.canvasId, serverBacked: true, entryCount: session.entryCount } satisfies CreationConversation;
    });
    const serverIds = new Set(sessions.map((session) => session.id));
    // 本地新建的空会话与尚未导入的旧会话保留；已在服务端的以服务端为准。
    const localOnly = local.filter((conversation) => !serverIds.has(conversation.id) && (!conversation.serverBacked || isLocalConversationId(conversation.id)));
    return [...localOnly, ...fromServer];
}

const IMPORT_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

/** 需要导入服务端的浏览器旧会话：有消息、ID 合法、不是本地新会话、尚未在服务端。 */
export function creationImportPayload(conversations: CreationConversation[], serverIds: Set<string>): ImportedCreationSession[] {
    return conversations
        .filter((conversation) => !conversation.serverBacked && !isLocalConversationId(conversation.id) && IMPORT_ID_PATTERN.test(conversation.id) && !serverIds.has(conversation.id) && conversation.messages.length > 0)
        .map((conversation) => ({
            id: conversation.id,
            title: conversation.title,
            updatedAt: conversation.updatedAt,
            messages: conversation.messages.slice(0, 400).map((message) => ({
                id: message.id,
                role: message.role,
                mode: message.mode,
                content: message.content,
                status: message.status,
                createdAt: message.createdAt,
                taskIds: message.taskIds,
                resultStorageKeys: message.resultStorageKeys,
                settings: message.settings as Record<string, unknown> | undefined,
                attachments: message.attachments?.map((attachment) => ({ name: attachment.name, storageKey: attachment.storageKey })),
            })),
        }));
}
