import { scopedLocalStorage } from "@/lib/user-scope";
import type { CreationHistoryInput } from "@/services/api/creation-history";

// 记住每个会话最后一次成功写入云端的创作历史摘要（按账号隔离）。页面重新打开或切回创作页时，
// 内容没变的会话不再整份重传；内容有变化、或用户点"重试同步"时照常写入。
const CREATION_HISTORY_SYNCED_KEY = "creation-history-synced-v1";
const MAX_REMEMBERED = 500;

function readMap(): Record<string, string> {
    try {
        const parsed: unknown = JSON.parse(scopedLocalStorage.getItem(CREATION_HISTORY_SYNCED_KEY) || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
        return {};
    }
}

/** 53 位字符串摘要（cyrb53）：只用来判断"和上次写入的是否相同"，不用于安全校验。 */
export function creationHistoryFingerprint(input: CreationHistoryInput) {
    const text = JSON.stringify(input);
    let h1 = 0xdeadbeef ^ text.length;
    let h2 = 0x41c6ce57 ^ text.length;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${text.length.toString(36)}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

export function syncedCreationHistoryFingerprint(conversationId: string) {
    return readMap()[conversationId];
}

export function rememberSyncedCreationHistory(conversationId: string, fingerprint: string) {
    const map = readMap();
    delete map[conversationId];
    map[conversationId] = fingerprint;
    const entries = Object.entries(map);
    try {
        scopedLocalStorage.setItem(CREATION_HISTORY_SYNCED_KEY, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_REMEMBERED)))));
    } catch {
        // 本地存储写满时不影响同步本身，下次打开会再写一次。
    }
}

export function forgetSyncedCreationHistory() {
    try {
        scopedLocalStorage.removeItem(CREATION_HISTORY_SYNCED_KEY);
    } catch {
        // 同上：清不掉只会多同步一次。
    }
}
