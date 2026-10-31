// 创作对话里的一行消息。输入框打字、计时和提交状态都会让整页重新渲染，消息多时每次都要重算全部消息卡片；
// 这里用 memo 跳过没有变化的行：行只接收消息本身、少量标量状态和一份身份不变的页面操作。
import { memo } from "react";
import type { AgentApproval, AgentApprovalItemEdit, AgentOutputPreference } from "@/services/api/agent";
import type { CreationAgentProposalHandlers, CreationAgentProposalOptions } from "./creation-agent-proposals";
import { CreationAgentReview } from "./creation-agent-review";
import { creationImageRedoSource } from "./creation-image-redo";
import type { CreationMessage } from "./creation-types";
import { CreationMessageView, type CreationResultImageHandler, type CreationResultImageRef } from "./creation-workspace-messages";

/** 行里会触发的页面操作。页面只创建一次，调用时转给页面最新一次渲染的处理函数，消息位置也在调用时按最新对话查找。 */
export type CreationThreadActions = {
    regenerate: (item: CreationMessage) => void;
    refreshResult: (item: CreationMessage) => void;
    recoverMedia: (item: CreationMessage) => void;
    queryInterjection: (message: CreationMessage) => Promise<void>;
    createVariant: (item: CreationMessage) => void;
    refreshAgentTasks: () => void;
    retryAgentTasks: (tasks: CreationMessage[]) => Promise<void>;
    decideApproval: (decision: "approve" | "reject" | "refresh", options?: { skipItemIds?: string[] }) => Promise<unknown>;
    modifyPlan: (notes: string) => Promise<boolean>;
    updateApprovalItems: (edits: AgentApprovalItemEdit[]) => Promise<boolean>;
    focusComposer: () => void;
    continueCanvas: (ids?: string[]) => void;
    reuseResultImage: CreationResultImageHandler;
    redo: (item: CreationMessage, image: CreationResultImageRef) => void;
    answerQuestion: (answer: string) => Promise<boolean>;
    editUserMessage: (message: CreationMessage) => void;
};

export type CreationThreadRowData = {
    item: CreationMessage;
    /** Agent 回复：本轮的任务消息（有回复的任务不再单独成行）。 */
    agentTasks: CreationMessage[];
    /** 直接生成的图片结果：它前面最近的一条用户消息，「重做」据此判断能否还原原提示词。 */
    previousUser?: CreationMessage;
};

const NO_TASKS: CreationMessage[] = [];

/** 一次遍历得出对话要渲染的行，不必每一行各扫一遍全部消息。 */
export function creationThreadRows(messages: CreationMessage[]): CreationThreadRowData[] {
    const ids = new Set(messages.map((message) => message.id));
    const tasksByRun = new Map<string, CreationMessage[]>();
    for (const message of messages) {
        if (!message.id.startsWith("task-") || !message.agentRunId) continue;
        const tasks = tasksByRun.get(message.agentRunId);
        if (tasks) tasks.push(message);
        else tasksByRun.set(message.agentRunId, [message]);
    }
    const rows: CreationThreadRowData[] = [];
    let previousUser: CreationMessage | undefined;
    for (const item of messages) {
        const shownInReply = item.id.startsWith("task-") && item.agentRunId && ids.has(`${item.agentRunId}:assistant`);
        if (!shownInReply) {
            const agentTasks = item.mode === "agent" && !item.agentContinuation && item.agentRunId ? tasksByRun.get(item.agentRunId) || NO_TASKS : NO_TASKS;
            const directImage = item.role === "assistant" && item.mode === "image" && !item.agentRunId;
            rows.push({ item, agentTasks, previousUser: directImage ? previousUser : undefined });
        }
        if (item.role === "user") previousUser = item;
    }
    return rows;
}

type CreationThreadRowProps = CreationThreadRowData & {
    shotNumber: number;
    submitting: boolean;
    refreshingResult: boolean;
    taskSyncFailed: boolean;
    outputPreference: AgentOutputPreference;
    retryDisabled: boolean;
    /** 会话当前这一轮 Agent 的回复：只有它能修改方案、刷新报价。 */
    currentReply: boolean;
    /** 当前这一轮的待确认审批；其他行不传。 */
    approval?: AgentApproval;
    activeApprovalId?: string;
    approvalBusy: boolean;
    approvalChanged: boolean;
    approvalInProposals: boolean;
    /** 执行计划已在计划面板里展示，回复里不再重复列出。 */
    planItemsHidden: boolean;
    proposalOptions?: CreationAgentProposalOptions;
    openingCanvas: boolean;
    referenceActionFirst: boolean;
    questionPending: boolean;
    questionDisabled: boolean;
    actions: CreationThreadActions;
};

const sameMessages = (left: CreationMessage[], right: CreationMessage[]) => left === right || (left.length === right.length && left.every((message, index) => message === right[index]));

// 任务列表每次消息变化都会重新分组，按元素比较；其余属性按引用比较。
function sameRowProps(previous: CreationThreadRowProps, next: CreationThreadRowProps) {
    const keys = Object.keys(next) as (keyof CreationThreadRowProps)[];
    if (keys.length !== Object.keys(previous).length) return false;
    return keys.every((key) => (key === "agentTasks" ? sameMessages(previous.agentTasks, next.agentTasks) : Object.is(previous[key], next[key])));
}

function CreationThreadRowView({
    item,
    agentTasks,
    previousUser,
    shotNumber,
    submitting,
    refreshingResult,
    taskSyncFailed,
    outputPreference,
    retryDisabled,
    currentReply,
    approval,
    activeApprovalId,
    approvalBusy,
    approvalChanged,
    approvalInProposals,
    planItemsHidden,
    proposalOptions,
    openingCanvas,
    referenceActionFirst,
    questionPending,
    questionDisabled,
    actions,
}: CreationThreadRowProps) {
    const agentReply = item.mode === "agent" && !item.agentContinuation;
    // 「重做」入口只看这一行用得到的消息：Agent 回复是本轮任务，直接生成是前面那条用户消息。点击后页面再按完整对话和技能还原。
    const redoContext = item.agentRunId ? [item, ...agentTasks] : previousUser ? [previousUser, item] : [item];
    const redoHandler = (target: CreationMessage) => (creationImageRedoSource(redoContext, target) ? (image: CreationResultImageRef) => actions.redo(target, image) : undefined);
    const proposalHandlers: CreationAgentProposalHandlers | undefined = approval
        ? {
              onApprove: (skipItemIds) => actions.decideApproval("approve", { skipItemIds }),
              onReject: () => actions.decideApproval("reject"),
              onDefer: actions.focusComposer,
              onRefreshQuote: approval.preview?.kind === "media_generation" ? undefined : () => actions.decideApproval("refresh"),
              onUpdate: actions.updateApprovalItems,
          }
        : undefined;
    return (
        <div id={`creation-shot-${item.id}`} className="creation-thread-message">
            <CreationMessageView
                item={item}
                submitting={submitting}
                shotNumber={shotNumber}
                onRetryFailure={() => actions.regenerate(item)}
                onRefreshResult={() => actions.refreshResult(item)}
                onRecoverMedia={() => actions.recoverMedia(item)}
                refreshingResult={refreshingResult}
                onQueryInterjection={actions.queryInterjection}
                onCreateVariant={() => actions.createVariant(item)}
                agentTasks={agentTasks}
                taskSyncFailed={taskSyncFailed}
                onRefreshAgentTasks={actions.refreshAgentTasks}
                outputPreference={outputPreference}
                onRetryAgentTasks={actions.retryAgentTasks}
                retryDisabled={retryDisabled}
                onCreateAgentTaskVariant={actions.createVariant}
                agentReview={
                    agentReply ? (
                        <CreationAgentReview
                            outputPreference={outputPreference}
                            plan={item.commercePlan}
                            items={planItemsHidden ? undefined : item.agentPlanItems}
                            approval={approval}
                            changed={approvalChanged}
                            submitting={approvalBusy}
                            onApprove={() => void actions.decideApproval("approve")}
                            onReject={() => void actions.decideApproval("reject")}
                            onModify={currentReply ? actions.modifyPlan : undefined}
                            onDefer={actions.focusComposer}
                            onRefreshQuote={currentReply && item.commercePlan ? () => void actions.decideApproval("refresh") : undefined}
                            approvalInProposals={approvalInProposals}
                        />
                    ) : undefined
                }
                activeApprovalId={activeApprovalId}
                approvalBusy={approvalBusy}
                approvalChanged={approvalChanged}
                proposalOptions={proposalOptions}
                proposalHandlers={proposalHandlers}
                onContinueCanvas={actions.continueCanvas}
                openingCanvas={openingCanvas}
                onUseResultImage={actions.reuseResultImage}
                redoHandler={redoHandler}
                referenceActionFirst={referenceActionFirst}
                onAnswerQuestion={agentReply && item.agentQuestion ? actions.answerQuestion : undefined}
                questionPending={questionPending}
                questionDisabled={questionDisabled}
                onEditUserMessage={actions.editUserMessage}
            />
        </div>
    );
}

export const CreationThreadRow = memo(CreationThreadRowView, sameRowProps);
