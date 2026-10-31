import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, Clock3, Film, Image as ImageIcon, LoaderCircle, Maximize2, RotateCcw, TriangleAlert } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { UNCATEGORIZED_MODEL_GROUP } from "@/lib/model-picker-groups";
import { useUserStore } from "@/stores/use-user-store";
import type { AgentApprovalItemEdit, AgentApprovalProposal } from "@/services/api/agent";
import { creationMediaAspectRatio, type CreationMode } from "./creation-assets";
import type { CreationAgentProposalSet, CreationMessage } from "./creation-types";

/**
 * 创作页逐项方案卡：Agent 提交生成前，每个生成项一张卡（提示词、参数、单项积分），
 * 可以改提示词与参数（服务端重新报价）、移出单项，再一键确认。
 * 确认后有了任务，这一项不再套卡片外框，像普通生成结果一样直接摆在对话里：标题和「查看方案」在上，进度、结果和操作在下。
 * 只负责展示与收集用户意图，审批与报价都在服务端完成。
 */

export type CreationAgentProposalOptions = {
    image: { sizes: string[]; qualities: string[] };
    video: { sizes: string[]; durations: number[] };
};

export type CreationAgentProposalHandlers = {
    onApprove: (skipItemIds: string[]) => unknown;
    onReject: () => unknown;
    onDefer?: () => void;
    onRefreshQuote?: () => unknown;
    onUpdate: (edits: AgentApprovalItemEdit[]) => Promise<boolean>;
};

const PROMPT_LIMIT = 8000;
const COMMON_RATIOS = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9"];

export function formatCreationCredits(value: number) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

/** 方案项对应的任务：图片批次与套图按预分配的任务 ID，单项媒体按确认后的审批 ID。重试保留最新一次尝试。 */
export function creationAgentProposalTask(set: CreationAgentProposalSet, proposal: AgentApprovalProposal, tasks: CreationMessage[]) {
    let match: CreationMessage | undefined;
    for (const task of tasks) {
        const byTask = Boolean(proposal.taskId && task.taskIds?.includes(proposal.taskId));
        const byCommerce = set.kind === "commerce_batch" && task.commerceItemId === proposal.itemId;
        const byApproval = task.approvalId === set.approvalId && (task.batchItemId ? task.batchItemId === proposal.itemId : set.proposals.length === 1);
        if (byTask || byCommerce || byApproval) match = task;
    }
    return match;
}

/** 回复里属于方案卡的任务：它们的结果在卡片里显示，不再进入回复底部的媒体组。 */
export function creationAgentProposalTaskIds(sets: CreationAgentProposalSet[] | undefined, tasks: CreationMessage[]) {
    const ids = new Set<string>();
    for (const set of sets || []) {
        if (set.status !== "approved") continue;
        for (const proposal of set.proposals) {
            const task = creationAgentProposalTask(set, proposal, tasks);
            if (task) ids.add(task.id);
        }
    }
    return ids;
}

function taskStatusLabel(task: CreationMessage | undefined, proposal: AgentApprovalProposal, set: CreationAgentProposalSet) {
    if (proposal.skipped) return { label: "已移出", tone: "muted" as const };
    if (set.status === "rejected") return { label: "未生成", tone: "muted" as const };
    if (set.status === "expired") return { label: "未确认", tone: "muted" as const };
    if (set.status === "pending") return { label: "待确认", tone: "muted" as const };
    if (!task) return { label: "等待提交", tone: "busy" as const };
    if (task.taskStatePending) return { label: "状态待确认", tone: "busy" as const };
    if (task.status === "done") return { label: "已完成", tone: "success" as const };
    if (task.status === "error") return { label: "失败", tone: "error" as const };
    if (task.status === "cancelled") return { label: "已停止", tone: "muted" as const };
    return { label: task.generationStatus === "queued" ? "排队中" : "生成中", tone: "busy" as const };
}

function modeLabel(mode: string) {
    return mode === "video" ? "视频" : mode === "audio" ? "音频" : "图片";
}

function optionList(current: string | undefined, values: string[]) {
    const list = values.filter(Boolean);
    return current && !list.includes(current) ? [current, ...list] : list;
}

/** 「未分类」是模型目录的分组名，不是模型名（同 model-picker），不作为模型展示。 */
function proposalModelName(proposal: AgentApprovalProposal) {
    const name = proposal.model?.trim() || "";
    return name === UNCATEGORIZED_MODEL_GROUP ? "" : name;
}

/** 结果的预留画幅，取值顺序与 MediaResult 相同：任务参数里的画幅优先，其次方案上的尺寸。 */
function proposalMediaRatio(proposal: AgentApprovalProposal, task: CreationMessage) {
    const mode: CreationMode = proposal.mode === "video" ? "video" : proposal.mode === "audio" ? "audio" : "image";
    const [width, height] = creationMediaAspectRatio(task.settings?.ratio || proposal.size, mode)
        .split("/")
        .map(Number);
    return width > 0 && height > 0 ? width / height : 1;
}

function ProposalPromptEditor({
    open,
    proposal,
    details,
    editable,
    saving,
    onClose,
    onSave,
}: {
    open: boolean;
    proposal: AgentApprovalProposal;
    details: string[];
    editable: boolean;
    saving: boolean;
    onClose: () => void;
    onSave: (prompt: string) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState(proposal.prompt);
    useEffect(() => {
        if (open) setDraft(proposal.prompt);
    }, [open, proposal.prompt]);
    const trimmed = draft.trim();
    const valid = trimmed.length > 0 && draft.length <= PROMPT_LIMIT;
    const changed = trimmed !== proposal.prompt.trim();
    return (
        <AppModal
            open={open}
            centered
            destroyOnHidden
            width="min(820px, calc(100vw - 32px))"
            title={`${editable ? "编辑" : "查看"}${modeLabel(proposal.mode)}方案 · ${proposal.title}`}
            onCancel={onClose}
            className="creation-agent-proposal-editor"
            footer={
                <div className="creation-agent-proposal-editor-footer">
                    <span role="status">{editable && !valid ? (trimmed ? `方案最多 ${PROMPT_LIMIT} 字` : "请填写生成方案") : `${draft.length} / ${PROMPT_LIMIT}`}</span>
                    <button type="button" className="creation-agent-proposal-button" onClick={onClose}>
                        {editable ? "取消" : "关闭"}
                    </button>
                    {editable ? (
                        <button
                            type="button"
                            className="creation-agent-proposal-button is-primary"
                            disabled={!valid || !changed || saving}
                            aria-busy={saving}
                            onClick={async () => {
                                if (await onSave(trimmed)) onClose();
                            }}
                        >
                            {saving ? "正在重新报价…" : "保存并重新报价"}
                        </button>
                    ) : null}
                </div>
            }
        >
            {details.length ? <p className="creation-agent-proposal-editor-meta">{details.join(" · ")}</p> : null}
            {editable ? (
                <textarea className="creation-agent-proposal-editor-input" aria-label="生成方案" value={draft} maxLength={PROMPT_LIMIT} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
            ) : (
                <p className="creation-agent-proposal-editor-text">{proposal.prompt}</p>
            )}
        </AppModal>
    );
}

function ProposalCard({
    set,
    proposal,
    task,
    pending,
    editable,
    skippable,
    skipped,
    disabled,
    updating,
    options,
    creditsEnabled,
    onToggleSkip,
    onUpdate,
    renderResult,
}: {
    set: CreationAgentProposalSet;
    proposal: AgentApprovalProposal;
    task?: CreationMessage;
    pending: boolean;
    editable: boolean;
    skippable: boolean;
    skipped: boolean;
    disabled: boolean;
    updating: boolean;
    options?: CreationAgentProposalOptions;
    creditsEnabled: boolean;
    onToggleSkip: () => void;
    onUpdate: (edit: Omit<AgentApprovalItemEdit, "itemId">) => Promise<boolean>;
    renderResult: (task: CreationMessage, proposal: AgentApprovalProposal) => ReactNode;
}) {
    const [editorOpen, setEditorOpen] = useState(false);
    const titleId = useId();
    const status = taskStatusLabel(task, proposal, set);
    const isVideo = proposal.mode === "video";
    const Icon = isVideo ? Film : ImageIcon;
    const paramsEditable = pending && editable && !set.parametersLocked && !skipped;
    const sizes = paramsEditable ? optionList(proposal.size, (isVideo ? options?.video.sizes : options?.image.sizes)?.length ? (isVideo ? options!.video.sizes : options!.image.sizes) : COMMON_RATIOS) : [];
    const qualities = paramsEditable && !isVideo ? optionList(proposal.quality, options?.image.qualities || []) : [];
    const durations = paramsEditable && isVideo ? optionList(proposal.durationSeconds ? String(proposal.durationSeconds) : undefined, (options?.video.durations || []).map(String)) : [];
    const StatusIcon = status.tone === "success" ? CheckCircle2 : status.tone === "error" ? TriangleAlert : status.tone === "busy" ? LoaderCircle : Clock3;
    const editing = pending && editable && !skipped;
    // 有了任务，这一项就是生成结果：不套卡片，结果自己表达进度与完成，参数收进「查看方案」。
    const resultTask = pending ? undefined : task;
    const modelName = proposalModelName(proposal);
    const duration = proposal.durationSeconds ? `${proposal.durationSeconds} 秒` : "";
    const references = proposal.referenceCount ? `参考 ${proposal.referenceCount} 个` : "";
    // 卡片上能改的参数已经是下拉框，不再重复成标签；「查看方案」弹窗里列出全部参数。
    const specs = [modelName, paramsEditable ? "" : proposal.size || "", paramsEditable ? "" : proposal.quality || "", paramsEditable ? "" : duration, references].filter(Boolean);
    const details = [modelName, proposal.size || "", proposal.quality || "", duration, references].filter(Boolean);
    // 结果已经说明完成，不再标「已完成」；生成中、失败等状态继续标在标题行。
    const statusVisible = !pending && !(resultTask && status.tone === "success");
    const openLink = (
        <button type="button" className="creation-agent-proposal-link" onClick={() => setEditorOpen(true)}>
            <Maximize2 aria-hidden="true" />
            {editing ? "编辑方案" : "查看方案"}
        </button>
    );
    return (
        <article
            className="creation-agent-proposal"
            aria-labelledby={titleId}
            data-skipped={skipped || proposal.skipped ? "true" : undefined}
            data-has-result={resultTask ? "true" : undefined}
            aria-busy={updating}
            style={resultTask ? ({ "--creation-proposal-ratio": proposalMediaRatio(proposal, resultTask) } as CSSProperties) : undefined}
        >
            <header className="creation-agent-proposal-head">
                {resultTask ? null : (
                    <span className="creation-agent-proposal-mode">
                        <Icon aria-hidden="true" />
                        {modeLabel(proposal.mode)}
                    </span>
                )}
                <strong id={titleId} title={proposal.title}>
                    {proposal.title}
                </strong>
                {statusVisible ? (
                    <span className="creation-agent-proposal-status" data-tone={status.tone}>
                        <StatusIcon className={status.tone === "busy" ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
                        {status.label}
                    </span>
                ) : null}
                {resultTask ? openLink : null}
            </header>
            {resultTask ? (
                <div className="creation-agent-proposal-result">{renderResult(resultTask, proposal)}</div>
            ) : (
                <>
                    <button type="button" className="creation-agent-proposal-prompt" onClick={() => setEditorOpen(true)} aria-label={`${editing ? "编辑" : "查看"}方案：${proposal.title}`}>
                        <span>{proposal.prompt || "（未提供提示词）"}</span>
                    </button>
                    {!pending ? <p className="creation-agent-proposal-placeholder">{proposal.skipped ? "已移出本次生成" : set.status === "approved" ? "等待提交生成任务…" : set.status === "rejected" ? "本次未生成" : "方案未确认，本轮已结束"}</p> : null}
                    {specs.length || sizes.length || qualities.length || durations.length ? (
                        <div className="creation-agent-proposal-specs">
                            {specs.map((spec) => (
                                <span key={spec}>{spec}</span>
                            ))}
                            {sizes.length ? (
                                <label>
                                    <span className="sr-only">画幅</span>
                                    <select value={proposal.size || ""} disabled={disabled} aria-label={`${proposal.title}的画幅`} onChange={(event) => void onUpdate({ size: event.target.value })}>
                                        {proposal.size ? null : <option value="">自动画幅</option>}
                                        {sizes.map((value) => (
                                            <option key={value} value={value}>
                                                {value}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            {qualities.length ? (
                                <label>
                                    <span className="sr-only">质量</span>
                                    <select value={proposal.quality || ""} disabled={disabled} aria-label={`${proposal.title}的质量`} onChange={(event) => void onUpdate({ quality: event.target.value })}>
                                        {proposal.quality ? null : <option value="">自动质量</option>}
                                        {qualities.map((value) => (
                                            <option key={value} value={value}>
                                                {value}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            {durations.length ? (
                                <label>
                                    <span className="sr-only">时长</span>
                                    <select
                                        value={proposal.durationSeconds ? String(proposal.durationSeconds) : ""}
                                        disabled={disabled}
                                        aria-label={`${proposal.title}的时长`}
                                        onChange={(event) => void onUpdate({ durationSeconds: Number(event.target.value) })}
                                    >
                                        {proposal.durationSeconds ? null : <option value="">默认时长</option>}
                                        {durations.map((value) => (
                                            <option key={value} value={value}>
                                                {value} 秒
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                        </div>
                    ) : null}
                    <footer className="creation-agent-proposal-foot">
                        {pending ? (
                            <span className="creation-agent-proposal-credits">{updating ? "正在重新报价…" : skipped ? "不生成" : creditsEnabled ? `预计 ${formatCreationCredits(proposal.credits)} 积分` : ""}</span>
                        ) : (
                            <span className="creation-agent-proposal-credits" />
                        )}
                        {openLink}
                        {pending && skippable ? (
                            <button type="button" className="creation-agent-proposal-link" disabled={disabled} aria-pressed={skipped} onClick={onToggleSkip}>
                                {skipped ? <RotateCcw aria-hidden="true" /> : null}
                                {skipped ? "恢复" : "暂不生成"}
                            </button>
                        ) : null}
                    </footer>
                </>
            )}
            <ProposalPromptEditor open={editorOpen} proposal={proposal} details={details} editable={editing} saving={updating} onClose={() => setEditorOpen(false)} onSave={(prompt) => onUpdate({ prompt })} />
        </article>
    );
}

/**
 * 一组方案卡。pending 时显示合计积分与一键确认；确认后每项显示对应任务的进度与结果。
 * active=false 的待确认方案（例如运行已换到新的审批）只读展示，避免批准过期的报价。
 */
export function CreationAgentProposalGroup({
    set,
    tasks,
    active,
    busy,
    changed = false,
    options,
    handlers,
    renderResult,
}: {
    set: CreationAgentProposalSet;
    tasks: CreationMessage[];
    active: boolean;
    busy: boolean;
    changed?: boolean;
    options?: CreationAgentProposalOptions;
    handlers?: CreationAgentProposalHandlers;
    renderResult: (task: CreationMessage, proposal: AgentApprovalProposal) => ReactNode;
}) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
    const [updatingItem, setUpdatingItem] = useState<string | null>(null);
    const pending = set.status === "pending" && active && Boolean(handlers);
    const live = set.proposals.filter((proposal) => !proposal.skipped);
    useEffect(() => {
        // 方案项变化（改写、续期）后丢掉已不存在的移出标记。
        setSkipped((current) => {
            const ids = new Set(set.proposals.filter((proposal) => !proposal.skipped).map((proposal) => proposal.itemId));
            const next = new Set([...current].filter((id) => ids.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [set.approvalId, set.proposals]);
    const included = live.filter((proposal) => !skipped.has(proposal.itemId));
    const total = included.reduce((sum, proposal) => sum + proposal.credits, 0);
    const disabled = !pending || busy || updatingItem !== null;
    const single = live.length <= 1;
    const update = async (itemId: string, edit: Omit<AgentApprovalItemEdit, "itemId">) => {
        if (!handlers || disabled) return false;
        setUpdatingItem(itemId);
        try {
            return await handlers.onUpdate([{ itemId, ...edit }]);
        } finally {
            setUpdatingItem(null);
        }
    };
    const heading = pending ? (single ? `${modeLabel(live[0]?.mode || "image")}生成方案` : `${live.length} 个生成方案`) : set.status === "approved" ? `已确认 ${live.length} 个生成方案` : set.status === "rejected" ? "生成方案未执行" : "生成方案未确认";
    return (
        <section className="creation-agent-proposals" aria-label={pending ? "生成确认" : "生成方案"} data-status={set.status}>
            <header className="creation-agent-proposals-head">
                <strong>{heading}</strong>
                {pending && creditsEnabled ? <span className="creation-agent-proposals-total">预计 {formatCreationCredits(total)} 积分</span> : null}
                {pending ? (
                    <div className="creation-agent-proposals-actions">
                        {handlers?.onRefreshQuote ? (
                            <button type="button" className="creation-agent-proposal-button" disabled={disabled} onClick={() => void handlers.onRefreshQuote?.()}>
                                更新报价
                            </button>
                        ) : null}
                        {handlers?.onDefer ? (
                            <button type="button" className="creation-agent-proposal-button" disabled={disabled} onClick={handlers.onDefer}>
                                稍后处理
                            </button>
                        ) : null}
                        <button type="button" className="creation-agent-proposal-button" disabled={disabled} onClick={() => void handlers?.onReject()}>
                            {single ? "暂不生成" : "全部不生成"}
                        </button>
                        <button
                            type="button"
                            className="creation-agent-proposal-button is-primary"
                            disabled={disabled || changed || !included.length}
                            aria-busy={busy}
                            onClick={() => void handlers?.onApprove([...skipped].filter((id) => live.some((proposal) => proposal.itemId === id)))}
                        >
                            {busy ? "正在提交…" : single ? "确认生成" : skipped.size ? `确认生成 ${included.length} 项` : "一键确认"}
                        </button>
                    </div>
                ) : null}
            </header>
            {pending && changed ? (
                <p className="creation-agent-proposals-alert" role="alert">
                    设置已变更，请修改方案后重新确认。
                </p>
            ) : null}
            {pending && set.parametersLocked ? <p className="creation-agent-proposals-note">本轮使用手动参数，卡片里只能修改提示词。</p> : null}
            <div className="creation-agent-proposal-grid" data-single={single ? "true" : undefined}>
                {set.proposals.map((proposal) => (
                    <ProposalCard
                        key={proposal.itemId}
                        set={set}
                        proposal={proposal}
                        task={creationAgentProposalTask(set, proposal, tasks)}
                        pending={pending && !proposal.skipped}
                        editable={set.editable}
                        skippable={set.skippable && live.length > 1}
                        skipped={skipped.has(proposal.itemId)}
                        disabled={disabled}
                        updating={updatingItem === proposal.itemId}
                        options={options}
                        creditsEnabled={creditsEnabled}
                        onToggleSkip={() =>
                            setSkipped((current) => {
                                const next = new Set(current);
                                if (next.has(proposal.itemId)) next.delete(proposal.itemId);
                                else next.add(proposal.itemId);
                                return next;
                            })
                        }
                        onUpdate={(edit) => update(proposal.itemId, edit)}
                        renderResult={renderResult}
                    />
                ))}
            </div>
        </section>
    );
}
