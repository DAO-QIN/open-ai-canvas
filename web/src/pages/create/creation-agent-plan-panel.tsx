import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, ListChecks, LoaderCircle } from "lucide-react";
import type { AgentRun } from "@/services/api/agent";
import { creationAgentReadableText } from "./creation-agent-steps";
import type { CreationAgentPlanItem, CreationMessage } from "./creation-types";

/**
 * 创作计划浮层：对话右上角常驻显示最近一份 Agent 计划，随执行打勾。
 * 只读展示；计划本身由 plan_update 事件投影，浮层不发请求。
 */

export type CreationAgentPlanPhase = "running" | "approval" | "question" | "media" | "idle" | "failed" | "stopped";

/** 头部计数后的整体状态。 */
const PHASE_LABEL: Record<CreationAgentPlanPhase, string> = {
    running: "执行中",
    approval: "待确认",
    question: "待回答",
    media: "生成中",
    idle: "待反馈",
    failed: "待重试",
    stopped: "已暂停",
};

/** 当前步骤后的小标签。 */
const STEP_PHASE_LABEL: Record<CreationAgentPlanPhase, string> = {
    running: "进行中",
    approval: "待确认生成",
    question: "等待回答",
    media: "等待生成",
    idle: "待你反馈",
    failed: "待重试",
    stopped: "已暂停",
};

export type CreationAgentPlanSource = { reply: CreationMessage; items: CreationAgentPlanItem[]; phase: CreationAgentPlanPhase };

/**
 * 会话里最近一份计划及其所处阶段。新一轮没有更新计划时沿用上一轮的计划，状态按那一轮的实际结果显示。
 */
export function creationAgentPlanSource(messages: CreationMessage[], runs: AgentRun[] | undefined, activeRunId: string | undefined): CreationAgentPlanSource | undefined {
    const reply = [...messages].reverse().find((message) => message.role === "assistant" && message.mode === "agent" && !message.agentContinuation && message.agentPlanItems?.length);
    if (!reply?.agentPlanItems?.length) return undefined;
    const run = runs?.find((candidate) => candidate.id === reply.agentRunId);
    const mediaPending = messages.some((message) => message.agentRunId === reply.agentRunId && message.id.startsWith("task-") && (message.status === "pending" || message.status === "streaming"));
    const latest = reply.agentRunId === activeRunId;
    let phase: CreationAgentPlanPhase = "idle";
    if (run?.status === "waiting_approval") phase = "approval";
    else if (latest && reply.agentQuestion && run?.status !== "failed" && run?.status !== "cancelled") phase = "question";
    else if (mediaPending) phase = "media";
    else if (run?.status === "running" || run?.status === "queued") phase = "running";
    else if (run?.status === "failed") phase = "failed";
    else if (run?.status === "cancelled" || run?.status === "rejected") phase = "stopped";
    return { reply, items: reply.agentPlanItems, phase };
}

export function CreationAgentPlanPanel({ items, phase, defaultOpen = true }: { items: CreationAgentPlanItem[]; phase: CreationAgentPlanPhase; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    const listId = useId();
    const done = items.filter((item) => item.status === "done").length;
    const doing = items.findIndex((item) => item.status === "doing");
    const complete = done === items.length;
    const status = complete ? "已完成" : PHASE_LABEL[phase];
    const position = doing >= 0 ? doing + 1 : done;
    return (
        <aside className="creation-agent-plan-panel" data-open={open ? "true" : undefined} aria-label="创作计划">
            <button type="button" className="creation-agent-plan-panel-toggle" aria-expanded={open} aria-controls={listId} aria-label={`创作计划，${status}，已完成 ${done}/${items.length}`} onClick={() => setOpen((value) => !value)}>
                <ListChecks className={complete ? "is-complete" : undefined} aria-hidden="true" />
                <span className="creation-agent-plan-panel-title">创作计划</span>
                <span className="creation-agent-plan-panel-progress" aria-live="polite">
                    {position}/{items.length} · {status}
                </span>
                <ChevronDown className="creation-agent-plan-panel-chevron" aria-hidden="true" />
            </button>
            {open ? (
                <div id={listId} className="creation-agent-plan-panel-body">
                    <p className="creation-agent-plan-panel-summary">
                        已完成 {done}/{items.length}
                    </p>
                    <ol className="creation-agent-plan-panel-steps creation-scrollbar" aria-label="任务步骤" tabIndex={0}>
                        {items.map((item, index) => {
                            const current = index === doing;
                            const Icon = item.status === "done" ? CheckCircle2 : item.status === "doing" ? LoaderCircle : Circle;
                            return (
                                <li key={item.id} className="creation-agent-plan-panel-step" data-status={item.status} aria-current={current ? "step" : undefined}>
                                    <Icon className={item.status === "doing" && phase === "running" ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
                                    <span className="creation-agent-plan-panel-number" aria-hidden="true">
                                        {index + 1}.
                                    </span>
                                    <span className="creation-agent-plan-panel-text">
                                        {creationAgentReadableText(item.title)}
                                        {current ? <span className="creation-agent-plan-panel-tag">{STEP_PHASE_LABEL[phase]}</span> : <span className="sr-only">，{item.status === "done" ? "已完成" : "待开始"}</span>}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            ) : null}
        </aside>
    );
}
