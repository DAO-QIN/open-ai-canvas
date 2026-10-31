import { agentWebSources, agentWebToolDetail, agentWebToolRunningLabel } from "@/lib/agent-web-tools";
import { friendlyAgentToolSummary } from "@/lib/canvas/agent-tool-presentation";
import type { AgentEvent } from "@/services/api/agent";
import type { CreationAgentStep, CreationAgentWebSource } from "./creation-types";

/**
 * 创作页 Agent 回复的执行时间线：把一轮运行的事件按发生顺序折成"思考 → 工具 → 正文 → 方案/提问/媒体"。
 *
 * 只做纯投影，随 projectCreationAgentConversation 一起运行，所以实时追加与历史恢复得到同一份时间线。
 * 插话之后的步骤归到续答气泡；计划、提问和媒体只记录落点，仍由主回复里原有的卡片渲染。
 */

const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

type ToolCopy = { done?: string; failed: string };

/**
 * 创作页工具的用户可读文案。done 缺省表示成功时不单独成行：提交生成、整套方案、计划和提问
 * 都有自己的卡片，再报一行"已完成"只是噪音；失败仍然要说出来。
 */
const CREATION_TOOL_COPY: Record<string, ToolCopy> = {
    load_creation_workflow: { done: "已加载商品套图工作流", failed: "商品套图工作流未加载" },
    creation_media_read: { done: "已查看创作素材", failed: "查看创作素材未完成" },
    model_list: { done: "已查询可用模型", failed: "查询可用模型未完成" },
    skill_search: { done: "已查找可用技能", failed: "查找技能未完成" },
    skill_market_search: { done: "已在技能市场查找", failed: "技能市场查找未完成" },
    skill_recommend: { done: "已推荐可安装的技能", failed: "技能推荐未完成" },
    task_get: { done: "已查询任务状态", failed: "查询任务状态未完成" },
    agent_profile_read: { done: "已读取创作偏好", failed: "读取创作偏好未完成" },
    commerce_plan_submit: { failed: "整套方案未保存" },
    commerce_plan_wait: { failed: "核对整套结果未完成" },
    generate_image_batch: { failed: "图片任务未提交" },
    generate_media: { failed: "生成任务未提交" },
    plan_update: { failed: "创作计划未更新" },
    ask_user: { failed: "提问未发出" },
    finish_run: { failed: "本轮收尾未完成" },
    web_search: { done: "已联网搜索", failed: "联网搜索未完成" },
    web_fetch: { done: "已阅读网页", failed: "阅读网页未完成" },
    compose_video: { failed: "视频合成未提交" },
};

/**
 * 工具执行期间的一行（流光文字）。返回 undefined 的工具不显示进行中：计划、提问和收尾有自己的卡片或很快结束。
 * 媒体类工具只在提交前显示，生成进度交给媒体卡和末尾状态。
 */
const CREATION_TOOL_RUNNING_COPY: Record<string, string> = {
    load_creation_workflow: "正在加载商品套图工作流",
    creation_media_read: "正在查看创作素材",
    model_list: "正在查询可用模型",
    skill_search: "正在查找可用技能",
    skill_read_file: "正在读取技能",
    skill_market_search: "正在技能市场查找",
    skill_recommend: "正在整理推荐技能",
    task_get: "正在查询任务状态",
    agent_profile_read: "正在读取创作偏好",
    commerce_plan_submit: "正在整理整套方案",
    commerce_plan_wait: "正在核对整套结果",
    generate_image_batch: "正在准备生成方案",
    generate_media: "正在准备生成任务",
    memory_update: "正在更新记忆",
    // web_search / web_fetch 的进行中文案（带关键词或站点）与画布助手共用，见 lib/agent-web-tools。
    compose_video: "正在提交视频合成",
};

const SILENT_RUNNING_TOOLS = new Set(["plan_update", "ask_user", "finish_run"]);
/** 这些工具一旦出现方案卡或媒体卡就不再算"进行中"：后续等待由卡片表达。 */
const MEDIA_TOOLS = new Set(["commerce_plan_submit", "commerce_plan_wait", "generate_image_batch", "generate_media", "compose_video"]);

export function creationAgentRunningToolLabel(toolName: string, payload: Record<string, unknown> = {}): string | undefined {
    if (!toolName || SILENT_RUNNING_TOOLS.has(toolName)) return undefined;
    return agentWebToolRunningLabel(toolName, payload) ?? (CREATION_TOOL_RUNNING_COPY[toolName] || "正在处理");
}

/** 联网工具成功时附带一行说明（关键词、来源数或网页标题；扣了积分的搜索再写消耗），失败与其他工具不附带。 */
function creationAgentToolDetail(toolName: string, payload: Record<string, unknown>, failed: boolean) {
    return failed ? undefined : agentWebToolDetail(toolName, payload);
}

/** 联网工具成功时的来源：搜索给出结果列表（最多 10 条），读取网页给出这一页；只接受 http(s) 链接。 */
export function creationAgentWebSources(toolName: string, payload: Record<string, unknown>, failed: boolean): CreationAgentWebSource[] | undefined {
    return failed ? undefined : agentWebSources(toolName, payload);
}

/** 思考正文里出现的工具调用名换成可读名称，避免把内部标识原样展示给用户。 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    load_creation_workflow: "加载创作工作流",
    creation_media_read: "查看创作素材",
    model_list: "查询可用模型",
    skill_read_file: "读取技能",
    skill_search: "查找技能",
    task_get: "查询任务状态",
    agent_profile_read: "读取创作偏好",
    commerce_plan_submit: "提交整套方案",
    commerce_plan_wait: "等待整套结果",
    generate_image_batch: "批量生成图片",
    generate_media: "生成媒体",
    plan_update: "更新计划",
    ask_user: "询问你",
    finish_run: "收尾",
    memory_update: "更新记忆",
    web_search: "联网搜索",
    web_fetch: "读取网页",
    compose_video: "合成视频",
};
const TOOL_NAME_PATTERN = new RegExp(`\\b(${Object.keys(TOOL_DISPLAY_NAMES).join("|")})\\b`, "g");

export function creationAgentReadableText(value: string) {
    return value.replace(TOOL_NAME_PATTERN, (name) => `「${TOOL_DISPLAY_NAMES[name]}」`);
}

/** 工具事件的一行文案；返回 undefined 表示这一步不单独展示。 */
export function creationAgentToolLabel(toolName: string, payload: Record<string, unknown>, failed: boolean): string | undefined {
    if (toolName === "skills_load") {
        if (failed) return "技能加载未完成";
        const pinned = Array.isArray(payload.skillIds) ? payload.skillIds.length : 0;
        return pinned ? `已加载 ${pinned} 个指定技能` : undefined;
    }
    if (toolName === "skill_read_file") {
        const name = text(payload.skillName) || text(payload.skillId) || "创作技能";
        if (failed) return `读取技能「${name}」未完成`;
        return payload.path === "" ? `已查看技能「${name}」的参考资料` : `已读取技能「${name}」`;
    }
    if (toolName === "memory_update") return friendlyAgentToolSummary(toolName, text(payload.text), { ...payload, eventType: failed ? "tool_failed" : "tool_completed" });
    const copy = CREATION_TOOL_COPY[toolName];
    if (copy) return failed ? copy.failed : copy.done;
    return failed ? "一步处理未完成" : "已完成一步处理";
}

type Slot =
    | { kind: "text"; id: string; partId: string; at: string }
    | { kind: "reasoning"; id: string; reasoningId: string; at: string }
    | { kind: "tool"; id: string; toolName: string; status: "running" | "completed" | "failed"; label: string; count: number; at: string; callId?: string; detail?: string; sources?: CreationAgentWebSource[] }
    | { kind: "notice"; id: string; text: string; at: string }
    | { kind: "media"; id: string; taskId: string; at: string }
    | { kind: "review"; id: string; at: string }
    | { kind: "question"; id: string; at: string };

type ReasoningPart = { text: string; complete: boolean; streamed: boolean; firstAt: string; lastDeltaIndex: number; endAt?: string };

export type CreationAgentStepResolver = {
    partText: (partId: string) => string;
    partStreaming: (partId: string) => boolean;
    /** 运行仍在推进（未结束、未在等待用户回答）时，思考才可能还在输出。 */
    runActive: boolean;
};

export type CreationAgentStepOwners = {
    main: CreationAgentStep[];
    /** 续答气泡（按正文 messageId）各自的步骤，不含落点。 */
    continuations: Map<string, CreationAgentStep[]>;
    /** 最后一次插话后还没有新正文的步骤，需要单独的续答容器承载。 */
    trailing?: { key: string; createdAt: string; steps: CreationAgentStep[] };
};

const isAnchor = (slot: Slot) => slot.kind === "media" || slot.kind === "review" || slot.kind === "question";

export function createCreationAgentStepCollector(runId: string) {
    const main: Slot[] = [];
    const continuations = new Map<string, Slot[]>();
    let current: Slot[] | null = main;
    let pending: Slot[] = [];
    let pendingKey = "";
    const seenInterjections = new Set<string>();
    const reasoning = new Map<string, ReasoningPart>();
    const openReasoning = new Set<string>();
    const anchored = new Set<string>();
    let planSignature = "";
    let index = 0;

    const target = () => current ?? pending;
    const mergeable = (left: Slot | undefined, right: Slot) =>
        left?.kind === "tool" && right.kind === "tool" && left.status !== "running" && right.status !== "running" && !left.detail && !right.detail && !left.sources && !right.sources && left.label === right.label && left.status === right.status;
    const push = (slot: Slot) => {
        const list = target();
        const last = list.at(-1);
        if (last?.kind === "tool" && mergeable(last, slot)) {
            last.count += 1;
            return;
        }
        list.push(slot);
    };
    const lists = () => [main, ...continuations.values(), pending];
    /** 进行中的工具行按 callId 定位；结束事件原地换成结果行，没有结果文案的工具直接移除。 */
    const running = new Map<string, Extract<Slot, { kind: "tool" }>>();
    const removeSlot = (slot: Slot) => {
        for (const list of lists()) {
            const index = list.indexOf(slot);
            if (index < 0) continue;
            list.splice(index, 1);
            return;
        }
    };
    const settleRunning = (filter: (slot: Extract<Slot, { kind: "tool" }>) => boolean) => {
        for (const [callId, slot] of running) {
            if (!filter(slot)) continue;
            running.delete(callId);
            removeSlot(slot);
        }
    };
    const anchor = (kind: "review" | "question", at: string) => {
        settleRunning((slot) => MEDIA_TOOLS.has(slot.toolName) || slot.toolName === "ask_user");
        if (anchored.has(kind)) return;
        anchored.add(kind);
        push({ kind, id: kind, at });
    };

    return {
        /** 每个事件先调用：任何不是该思考增量的后续事件都意味着那段思考已结束。 */
        observe(event: AgentEvent) {
            index += 1;
            const reasoningId = event.type === "reasoning_delta" ? text(event.payload?.messageId) || `${runId}:reasoning` : "";
            for (const id of openReasoning) {
                if (id === reasoningId) continue;
                const part = reasoning.get(id);
                if (part && !part.endAt) part.endAt = event.createdAt;
                openReasoning.delete(id);
            }
        },
        text(partId: string, isNew: boolean, continuation: boolean, at: string) {
            if (!isNew) return;
            if (continuation) {
                const slots = [...pending];
                pending = [];
                continuations.set(partId, slots);
                current = slots;
            }
            push({ kind: "text", id: `text-${partId}`, partId, at });
        },
        reasoning(event: AgentEvent) {
            const payload = event.payload || {};
            const id = text(payload.messageId) || `${runId}:reasoning`;
            const delta = event.type === "reasoning_delta";
            const value = text(payload.text);
            const part = reasoning.get(id) || { text: "", complete: false, streamed: false, firstAt: event.createdAt, lastDeltaIndex: 0 };
            if (delta) {
                part.text += value;
                part.streamed = true;
                part.lastDeltaIndex = index;
                if (!part.endAt) openReasoning.add(id);
            } else {
                // 最终整段有长度上限，流式累计可能更完整；保留更长的一份，避免结束时文字缩短。
                if (value.length >= part.text.length) part.text = value;
                part.complete = true;
            }
            const isNew = !reasoning.has(id);
            reasoning.set(id, part);
            if (!isNew) return;
            const slot: Slot = { kind: "reasoning", id: `reasoning-${id}`, reasoningId: id, at: event.createdAt };
            // 非流式上游只在步骤末尾给出整段思考；它属于同一步正文之前。
            const textPartId = id.endsWith(":reasoning") ? id.slice(0, -":reasoning".length) : "";
            for (const list of lists()) {
                const position = textPartId ? list.findIndex((item) => item.kind === "text" && item.partId === textPartId) : -1;
                if (position >= 0) {
                    list.splice(position, 0, slot);
                    return;
                }
            }
            push(slot);
        },
        interjection(messageId: string) {
            if (!messageId || seenInterjections.has(messageId)) return;
            seenInterjections.add(messageId);
            current = null;
            pendingKey = messageId;
        },
        toolStarted(event: AgentEvent) {
            const payload = event.payload || {};
            const callId = text(payload.callId);
            const toolName = text(payload.toolName);
            const label = creationAgentRunningToolLabel(toolName, payload);
            if (!callId || !label || running.has(callId)) return;
            const slot: Extract<Slot, { kind: "tool" }> = { kind: "tool", id: `tool-start-${callId}`, callId, toolName, status: "running", label, count: 1, at: event.createdAt };
            running.set(callId, slot);
            target().push(slot);
        },
        tool(event: AgentEvent) {
            const payload = event.payload || {};
            const toolName = text(payload.toolName);
            const failed = event.type === "tool_failed";
            const label = creationAgentToolLabel(toolName, payload, failed);
            const detail = label ? creationAgentToolDetail(toolName, payload, failed) : undefined;
            const sources = label ? creationAgentWebSources(toolName, payload, failed) : undefined;
            const callId = text(payload.callId);
            const started = callId ? running.get(callId) : undefined;
            if (started) {
                running.delete(callId);
                // 结束行留在开始的位置，保证与正文、卡片的相对顺序不因工具耗时改变。
                if (!label) return removeSlot(started);
                Object.assign(started, { id: `tool-${event.seq}`, status: failed ? "failed" : "completed", label, detail, sources });
                for (const list of lists()) {
                    const index = list.indexOf(started);
                    if (index > 0 && mergeable(list[index - 1], started)) {
                        (list[index - 1] as Extract<Slot, { kind: "tool" }>).count += 1;
                        list.splice(index, 1);
                    }
                }
                return;
            }
            if (!label) return;
            push({ kind: "tool", id: `tool-${event.seq}`, toolName, status: failed ? "failed" : "completed", label, count: 1, at: event.createdAt, ...(detail ? { detail } : {}), ...(sources ? { sources } : {}) });
        },
        media(taskId: string, at: string) {
            settleRunning((slot) => MEDIA_TOOLS.has(slot.toolName));
            if (!taskId || anchored.has(`media:${taskId}`)) return;
            anchored.add(`media:${taskId}`);
            push({ kind: "media", id: `media-${taskId}`, taskId, at });
        },
        anchor,
        plan(event: AgentEvent) {
            const payload = event.payload || {};
            if (payload.inherited === true) return;
            if (payload.plan && typeof payload.plan === "object" && !Array.isArray(payload.plan)) {
                anchor("review", event.createdAt);
                return;
            }
            const items = Array.isArray(payload.items) ? payload.items : [];
            if (!items.length) return;
            // 批次进度只改状态；标题集合变了才算计划更新。
            const signature = items.map((item) => text(record(item).title)).join("\u0000");
            if (signature === planSignature) return;
            const first = !planSignature;
            planSignature = signature;
            push({ kind: "tool", id: `plan-${event.seq}`, toolName: "plan_update", status: "completed", label: first ? `已制定创作计划 · ${items.length} 步` : "已更新创作计划", count: 1, at: event.createdAt });
        },
        notice(id: string, value: string, at: string) {
            if (value) push({ kind: "notice", id, text: value, at });
        },
        finish(resolver: CreationAgentStepResolver): CreationAgentStepOwners {
            const resolve = (slots: Slot[], keepAnchors: boolean): CreationAgentStep[] =>
                slots.flatMap((slot): CreationAgentStep[] => {
                    if (slot.kind === "text") {
                        const value = resolver.partText(slot.partId);
                        return value.trim() ? [{ kind: "text", id: slot.id, text: value, streaming: resolver.partStreaming(slot.partId) }] : [];
                    }
                    if (slot.kind === "reasoning") {
                        const part = reasoning.get(slot.reasoningId);
                        if (!part) return [];
                        const streaming = resolver.runActive && part.streamed && !part.complete && !part.endAt;
                        if (!part.text.trim() && !streaming) return [];
                        const started = Date.parse(part.firstAt);
                        const ended = part.endAt ? Date.parse(part.endAt) : Number.NaN;
                        const durationSeconds = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? Math.max(1, Math.round((ended - started) / 1000)) : undefined;
                        return [{ kind: "reasoning", id: slot.id, text: part.text, streaming, ...(part.streamed && durationSeconds ? { durationSeconds } : {}) }];
                    }
                    if (slot.kind === "tool") {
                        // 运行已停下（结束、等确认或等回答）却没有结束事件：这一步没有可展示的进行中状态。
                        if (slot.status === "running" && !resolver.runActive) return [];
                        return [
                            { kind: "tool", id: slot.id, toolName: slot.toolName, status: slot.status, label: slot.label, count: slot.count, ...(slot.detail ? { detail: slot.detail } : {}), ...(slot.sources?.length ? { sources: slot.sources } : {}) },
                        ];
                    }
                    if (slot.kind === "notice") return [{ kind: "notice", id: slot.id, text: slot.text }];
                    if (!keepAnchors) return [];
                    if (slot.kind === "media") return [{ kind: "media", id: slot.id, taskId: slot.taskId }];
                    return [{ kind: slot.kind, id: slot.id }];
                });
            const trailingSteps = resolve(pending, false);
            return {
                main: resolve(main, true),
                continuations: new Map([...continuations].map(([id, slots]) => [id, resolve(slots, false)])),
                ...(trailingSteps.length && pendingKey ? { trailing: { key: pendingKey, createdAt: pending.find((slot) => !isAnchor(slot))?.at || pending[0].at, steps: trailingSteps } } : {}),
            };
        },
    };
}
