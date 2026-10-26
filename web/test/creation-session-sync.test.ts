import { expect, test } from "bun:test";
import type { CreationEntry } from "../src/services/api/creation-sessions";
import { creationEntryAttachmentConfig, creationEntryMessages, creationImportPayload, isLocalConversationId, mergeCreationMessages, mergeCreationSessions } from "../src/pages/create/creation-session-sync";
import type { CreationAttachment } from "../src/pages/create/creation-assets";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";
import { newConversation } from "../src/pages/create/creation-conversations";

function entry(overrides: Partial<CreationEntry> = {}): CreationEntry {
    return {
        id: "entry-1",
        sessionId: "session-1",
        origin: "manual",
        clientOperationId: "op-1",
        type: "image",
        prompt: "咖啡海报",
        config: { model: "gpt-image", settings: { ratio: "3:4", seconds: "6", quality: "auto", videoQuality: "720", count: "2" }, attachments: [{ id: "ref", name: "参考.png", type: "image/png", storageKey: "resource:ref-1", width: 640, height: 480 }] },
        references: [{ kind: "resource", resourceId: "ref-1", storageKey: "resource:ref-1" }],
        creditsMicrocredits: "6000000",
        status: "partial",
        results: [
            { slot: 0, taskId: "task-a", status: "succeeded", resources: [{ resourceId: "out-1", storageKey: "resource:out-1" }] },
            { slot: 1, taskId: "task-b", status: "failed", failure: "上游超时" },
        ],
        hiddenFailed: false,
        revision: 3,
        createdAt: "2026-10-25T10:00:00Z",
        updatedAt: "2026-10-25T10:01:00Z",
        ...overrides,
    };
}

function message(id: string, role: CreationMessage["role"], createdAt: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id, role, content: id, createdAt, ...extra };
}

test("a server entry restores the prompt, attachments, settings and results", () => {
    const [user, assistant] = creationEntryMessages(entry());
    expect(user.role).toBe("user");
    expect(user.content).toBe("咖啡海报");
    expect(user.settings?.ratio).toBe("3:4");
    expect(user.attachments?.[0]).toMatchObject({ name: "参考.png", type: "image/png", storageKey: "resource:ref-1", width: 640 });
    expect(assistant).toMatchObject({ status: "done", entryId: "entry-1", clientOperationId: "op-1", taskIds: ["task-a", "task-b"], resultStorageKeys: ["resource:out-1"], content: "1 个图片已生成，1 个失败" });
});

test("text entries show the generated text and failed entries keep the reason", () => {
    const [, text] = creationEntryMessages(entry({ type: "text", status: "succeeded", results: [{ slot: 0, taskId: "t", status: "succeeded", text: "春天来了" }] }));
    expect(text.content).toBe("春天来了");
    expect(text.mode).toBe("text");
    const [, failed] = creationEntryMessages(entry({ status: "failed", results: [{ slot: 0, status: "failed", failure: "积分不足" }] }));
    expect(failed).toMatchObject({ status: "error", error: "积分不足", content: "生成失败" });
});

test("a failed entry hidden after retry disappears", () => {
    expect(creationEntryMessages(entry({ status: "failed", hiddenFailed: true, results: [{ slot: 0, taskId: "t", status: "failed" }] }))).toEqual([]);
    const [, partial] = creationEntryMessages(entry({ hiddenFailed: true }));
    expect(partial.resultStorageKeys).toEqual(["resource:out-1"]);
});

test("local messages win for the same generation and remote entries fill the gaps in time order", () => {
    const local = [
        message("u-local", "user", "2026-10-25T10:00:00Z"),
        message("a-local", "assistant", "2026-10-25T10:00:00Z", { clientOperationId: "op-1", resultUrls: ["blob:local"] }),
        message("u-pending", "user", "2026-10-25T12:00:00Z"),
        message("a-pending", "assistant", "2026-10-25T12:00:00Z", { status: "pending", clientOperationId: "op-new" }),
    ];
    const remote = entry({ id: "entry-2", clientOperationId: "op-2", createdAt: "2026-10-25T11:00:00Z" });
    const merged = mergeCreationMessages(local, [entry(), remote]);
    expect(merged.map((item) => item.id)).toEqual(["u-local", "a-local", "entry-user:entry-2", "entry:entry-2", "u-pending", "a-pending"]);
    expect(merged[1]).toMatchObject({ entryId: "entry-1", resultUrls: ["blob:local"] });
    expect(mergeCreationMessages(merged, [entry(), remote]).map((item) => item.id)).toEqual(merged.map((item) => item.id));
});

test("server sessions provide titles and order while keeping cached messages", () => {
    const cached: CreationConversation = { id: "server-1", title: "旧标题", updatedAt: "2026-10-01T00:00:00Z", messages: [message("m", "user", "2026-10-01T00:00:00Z")], serverBacked: true };
    const legacy: CreationConversation = { id: "legacyNanoId01", title: "本地", updatedAt: "2026-09-01T00:00:00Z", messages: [message("x", "user", "2026-09-01T00:00:00Z")] };
    const stale: CreationConversation = { id: "server-gone", title: "已删", updatedAt: "2026-08-01T00:00:00Z", messages: [], serverBacked: true };
    const merged = mergeCreationSessions(
        [cached, legacy, stale],
        [{ id: "server-1", title: "新标题", lastMode: "image", agentStatus: "idle", agentModel: "", reasoningEffort: "", skillIds: [], lastSeq: 0, entryCount: 3, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z" }],
    );
    expect(merged.map((item) => item.id)).toEqual(["legacyNanoId01", "server-1"]);
    expect(merged[1]).toMatchObject({ title: "新标题", entryCount: 3, serverBacked: true });
    expect(merged[1].messages).toHaveLength(1);
});

test("only legacy local conversations with messages are imported", () => {
    const fresh = newConversation();
    expect(isLocalConversationId(fresh.id)).toBe(true);
    const legacy: CreationConversation = {
        id: "legacyNanoId01",
        title: "旧对话",
        updatedAt: "2026-09-01T00:00:00Z",
        messages: [message("u", "user", "2026-09-01T00:00:00Z", { mode: "image", attachments: [{ id: "a", name: "图", type: "image/png", storageKey: "resource:r", dataUrl: "", previewUrl: "" } as CreationAttachment] })],
    };
    const empty: CreationConversation = { id: "emptyLegacy", title: "", updatedAt: "", messages: [] };
    const already: CreationConversation = { ...legacy, id: "alreadyThere" };
    const payload = creationImportPayload([fresh, legacy, empty, already, { ...legacy, id: "server-1", serverBacked: true }], new Set(["alreadyThere"]));
    expect(payload.map((item) => item.id)).toEqual(["legacyNanoId01"]);
    expect(payload[0].messages[0]).toMatchObject({ id: "u", role: "user", mode: "image", attachments: [{ name: "图", storageKey: "resource:r" }] });
});

test("only uploaded attachments become server references", () => {
    const attachments = [
        { id: "a", name: "已上传.png", type: "image/png", storageKey: "resource:r1", dataUrl: "", previewUrl: "", width: 10, height: 20 },
        { id: "b", name: "本地.png", type: "image/png", dataUrl: "data:image/png;base64,AA", previewUrl: "" },
    ] as CreationAttachment[];
    const config = creationEntryAttachmentConfig(attachments);
    expect(config.references).toEqual([{ kind: "resource", storageKey: "resource:r1", label: "已上传.png" }]);
    expect(config.attachments).toEqual([{ id: "a", name: "已上传.png", type: "image/png", storageKey: "resource:r1", width: 10, height: 20, bytes: undefined, role: undefined, slotKey: undefined }]);
});

test("messages imported from the local cache are not shown twice", () => {
    const local = [message("lu1", "user", "2026-10-20T08:00:00Z"), message("la1", "assistant", "2026-10-20T08:00:05Z", { status: "done" })];
    const imported = entry({ id: "entry-import", clientOperationId: "import:legacyBrowser01:la1", type: "text", status: "succeeded", results: [{ slot: 0, status: "succeeded", text: "一杯好咖啡" }] });
    const merged = mergeCreationMessages(local, [imported]);
    expect(merged.map((item) => item.id)).toEqual(["lu1", "la1"]);
    expect(merged[1].entryId).toBe("entry-import");
});

test("a restored copy of an already matched entry is dropped from the cache", () => {
    const imported = entry({ id: "entry-import", clientOperationId: "import:legacyBrowser01:la1", type: "text", status: "succeeded", results: [{ slot: 0, status: "succeeded", text: "一杯好咖啡" }] });
    const cached = [message("lu1", "user", "2026-10-20T08:00:00Z"), message("la1", "assistant", "2026-10-20T08:00:05Z", { status: "done" }), ...creationEntryMessages(imported)];
    expect(mergeCreationMessages(cached, [imported]).map((item) => item.id)).toEqual(["lu1", "la1"]);
});
