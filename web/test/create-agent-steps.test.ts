import { expect, test } from "bun:test";
import { appendCreationAgentEvent, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import { creationAgentReadableText, creationAgentToolLabel } from "../src/pages/create/creation-agent-steps";
import type { AgentEvent, AgentRun, AgentSession } from "../src/services/api/agent";

const session: AgentSession = { id: "session", surface: "creation", status: "active", revision: 1, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" };
const run: AgentRun = { id: "run", sessionId: session.id, surface: "creation", canvasId: "", status: "running", permissionMode: "auto", userPrompt: "做一张海报", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" };
const at = (seconds: number) => new Date(Date.parse("2026-10-20T10:00:00.000Z") + seconds * 1000).toISOString();
const event = (seq: number, type: string, payload: Record<string, unknown>, seconds = seq): AgentEvent => ({ eventId: `e${seq}`, runId: run.id, seq, type, payload, createdAt: at(seconds) });
const reply = (events: AgentEvent[], overrides: Partial<AgentRun> = {}) => projectCreationAgentConversation(session, [{ ...run, events, ...overrides }]).messages.find((message) => message.id === "run:assistant")!;

test("思考、工具、正文与媒体按事件顺序展开，思考时长取自事件时间", () => {
    const message = reply(
        [
            event(1, "reasoning_delta", { messageId: "step-1:reasoning", text: "先确认海报尺寸" }, 1),
            event(2, "reasoning_delta", { messageId: "step-1:reasoning", text: "，再选模型。" }, 3),
            event(3, "assistant_delta", { messageId: "step-1", text: "我先查一下可用模型。" }, 7),
            event(4, "reasoning_message", { messageId: "step-1:reasoning", text: "先确认海报尺寸，再选模型。" }, 8),
            event(5, "assistant_message", { messageId: "step-1", text: "我先查一下可用模型。" }, 8),
            event(6, "tool_completed", { toolName: "model_list", text: "私有工具回执" }, 9),
            event(7, "generation_task_created", { taskId: "poster", mode: "image", title: "海报" }, 10),
            event(8, "assistant_message", { messageId: "step-2", text: "海报已提交生成。" }, 11),
        ],
        { status: "completed" },
    );
    expect(message.agentSteps?.map((step) => step.kind)).toEqual(["reasoning", "text", "tool", "media", "text"]);
    expect(message.agentSteps?.[0]).toMatchObject({ kind: "reasoning", text: "先确认海报尺寸，再选模型。", streaming: false, durationSeconds: 6 });
    expect(message.agentSteps?.[2]).toMatchObject({ kind: "tool", label: "已查询可用模型", status: "completed" });
    expect(JSON.stringify(message.agentSteps)).not.toContain("私有工具回执");
    // 正文仍是原来的拼接结果，复制、摘要和历史不受时间线影响。
    expect(message.content).toBe("我先查一下可用模型。\n\n海报已提交生成。");
    expect(message.reasoning).toBeUndefined();
});

test("仍在输出的思考标记为进行中，后续事件到达即结束", () => {
    const thinking = reply([event(1, "reasoning_delta", { messageId: "step-1:reasoning", text: "分析参考图" })]);
    expect(thinking.agentSteps).toEqual([{ kind: "reasoning", id: "reasoning-step-1:reasoning", text: "分析参考图", streaming: true }]);
    const answered = reply([event(1, "reasoning_delta", { messageId: "step-1:reasoning", text: "分析参考图" }, 1), event(2, "assistant_delta", { messageId: "step-1", text: "好的" }, 4)]);
    expect(answered.agentSteps?.[0]).toMatchObject({ kind: "reasoning", streaming: false, durationSeconds: 3 });
    expect(answered.agentSteps?.[1]).toMatchObject({ kind: "text", text: "好的", streaming: true });
    const stopped = reply([event(1, "reasoning_delta", { messageId: "step-1:reasoning", text: "分析参考图" })], { status: "cancelled" });
    expect(stopped.agentSteps?.[0]).toMatchObject({ kind: "reasoning", streaming: false });
});

test("非流式上游的整段思考放回同一步正文之前，且不显示估算的时长", () => {
    const message = reply([event(1, "assistant_message", { messageId: "step-1", text: "方案如下。" }), event(2, "reasoning_message", { messageId: "step-1:reasoning", text: "整段思考" })], { status: "completed" });
    expect(message.agentSteps?.map((step) => step.kind)).toEqual(["reasoning", "text"]);
    expect(message.agentSteps?.[0]).not.toHaveProperty("durationSeconds");
});

test("连续相同工具合并计数，提交类工具成功时不单独成行，失败照常提示", () => {
    const message = reply(
        [
            event(1, "tool_completed", { toolName: "creation_media_read" }),
            event(2, "tool_completed", { toolName: "creation_media_read" }),
            event(3, "tool_completed", { toolName: "generate_image_batch" }),
            event(4, "tool_failed", { toolName: "generate_media", text: "上游拒绝" }),
            event(5, "tool_completed", { toolName: "skills_load", skillIds: [] }),
            event(6, "tool_completed", { toolName: "skill_read_file", skillName: "商品视觉设计", path: "SKILL.md" }),
        ],
        { status: "completed" },
    );
    expect(message.agentSteps).toEqual([
        { kind: "tool", id: "tool-1", toolName: "creation_media_read", status: "completed", label: "已查看创作素材", count: 2 },
        { kind: "tool", id: "tool-4", toolName: "generate_media", status: "failed", label: "生成任务未提交", count: 1 },
        { kind: "tool", id: "tool-6", toolName: "skill_read_file", status: "completed", label: "已读取技能「商品视觉设计」", count: 1 },
    ]);
    expect(creationAgentToolLabel("unknown_tool", {}, false)).toBe("已完成一步处理");
    expect(creationAgentToolLabel("skills_load", { skillIds: ["a", "b"] }, false)).toBe("已加载 2 个指定技能");
});

test("计划只在标题变化时记一行，批次进度更新不重复；整套方案与审批落在同一处", () => {
    const stages = [
        { id: "plan", title: "规划视觉方案", status: "doing" },
        { id: "generate", title: "生成最终图片", status: "pending" },
    ];
    const message = reply(
        [
            event(1, "plan_updated", { items: stages }),
            event(2, "plan_updated", { items: stages.map((item) => ({ ...item, status: "done" })) }),
            event(3, "plan_updated", { items: [...stages, { id: "check", title: "检查文字", status: "pending" }] }),
            event(4, "plan_updated", { items: stages, plan: { planId: "set", intent: "套图", items: [] } }),
            event(5, "approval_requested", { approvalId: "approval", toolName: "commerce_plan_submit" }),
        ],
        { status: "waiting_approval" },
    );
    expect(message.agentSteps?.map((step) => (step.kind === "tool" ? step.label : step.kind))).toEqual(["已制定创作计划 · 2 步", "已更新创作计划", "review"]);
});

test("补充说明之后的思考和工具归到续答，主回复只保留补充前的过程", () => {
    const events = [
        event(1, "assistant_message", { messageId: "first", text: "先做白底图。" }),
        event(2, "user_interjection", { messageId: "follow-up", text: "改成蓝色" }),
        event(3, "user_interjection_delivered", { messageId: "follow-up", text: "改成蓝色" }),
        event(4, "tool_completed", { toolName: "creation_media_read" }),
        event(5, "reasoning_delta", { messageId: "second:reasoning", text: "换成蓝色背景" }),
        event(6, "assistant_delta", { messageId: "second", text: "收到，改为蓝色。" }),
    ];
    const conversation = projectCreationAgentConversation(session, [{ ...run, events }]);
    const main = conversation.messages.find((message) => message.id === "run:assistant")!;
    const continuation = conversation.messages.find((message) => message.agentContinuation)!;
    expect(main.agentSteps?.map((step) => step.kind)).toEqual(["text"]);
    expect(continuation.agentSteps?.map((step) => step.kind)).toEqual(["tool", "reasoning", "text"]);
    expect(conversation.messages.findIndex((message) => message.id === "follow-up")).toBeLessThan(conversation.messages.indexOf(continuation));
    // 实时逐条追加与一次性恢复得到同一份时间线。
    let live = projectCreationAgentConversation(session, [run]);
    for (const item of events) live = appendCreationAgentEvent(live, item);
    expect(live.messages).toEqual(conversation.messages);
});

test("补充说明后只有工具、还没有新正文时，用单独的续答容器承载这些步骤", () => {
    const conversation = projectCreationAgentConversation(session, [
        {
            ...run,
            events: [
                event(1, "assistant_message", { messageId: "first", text: "先做白底图。" }),
                event(2, "user_interjection", { messageId: "follow-up", text: "改成蓝色" }),
                event(3, "tool_completed", { toolName: "creation_media_read" }),
                event(4, "generation_task_created", { taskId: "image", mode: "image" }),
            ],
        },
    ]);
    const trailing = conversation.messages.find((message) => message.id === "run:assistant:after-follow-up");
    expect(trailing).toMatchObject({ agentContinuation: true, agentSteps: [{ kind: "tool", label: "已查看创作素材" }] });
    // 媒体仍由主回复渲染：续答里不带媒体落点。
    expect(trailing?.agentSteps?.some((step) => step.kind === "media")).toBe(false);
    expect(conversation.messages.find((message) => message.id === "run:assistant")?.agentSteps?.some((step) => step.kind === "media")).toBe(false);
});

test("提问保留字段类型、默认值和推荐项，并在时间线上记录落点", () => {
    const message = reply(
        [
            event(1, "assistant_message", { messageId: "ask", text: "先确认两点：" }),
            event(2, "user_question", {
                phase: "question",
                kind: "form",
                question: "确认画幅与风格",
                fields: [
                    {
                        id: "ratio",
                        title: "画幅",
                        type: "single_select",
                        required: true,
                        defaultValue: "9:16",
                        options: [
                            { id: "9:16", label: "竖屏", recommended: true },
                            { id: "16:9", label: "横屏" },
                        ],
                    },
                    { id: "style", title: "风格", type: "multi_select", allowCustom: true, options: [{ label: "写实" }, { label: "插画" }] },
                ],
            }),
        ],
        { status: "completed" },
    );
    expect(message.agentSteps?.map((step) => step.kind)).toEqual(["text", "question"]);
    expect(message.agentQuestion?.fields).toMatchObject([
        {
            id: "ratio",
            type: "single_select",
            required: true,
            defaultValue: "9:16",
            options: [
                { id: "9:16", label: "竖屏", recommended: true },
                { id: "16:9", label: "横屏" },
            ],
        },
        { id: "style", type: "multi_select", allowCustom: true },
    ]);
});

test("已结算的本轮消耗随状态快照更新到回复上", () => {
    let conversation = projectCreationAgentConversation(session, [{ ...run, events: [event(1, "assistant_message", { messageId: "done", text: "完成" })] }]);
    conversation = appendCreationAgentEvent(conversation, { eventId: "status", runId: run.id, seq: 0, type: "run_status", payload: { status: "completed", spentCredits: 12.5 }, createdAt: at(5) });
    expect(conversation.messages.find((message) => message.id === "run:assistant")?.agentSpentCredits).toBe(12.5);
});

test("思考正文里的工具调用名换成可读名称", () => {
    expect(creationAgentReadableText("先调用 creation_media_read 看素材，再用 model_list 选模型")).toBe("先调用 「查看创作素材」 看素材，再用 「查询可用模型」 选模型");
});
