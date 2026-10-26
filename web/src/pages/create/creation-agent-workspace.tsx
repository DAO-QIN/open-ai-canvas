import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./creation-product.css";
import { App, Button, Select, Switch, Tooltip } from "antd";
import { ArrowUp, Check, History, LoaderCircle, Plus, Square, X } from "lucide-react";
import { createClientUUID } from "@/lib/client-id";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { AgentChatMessage, AgentPlanBar, AgentQuestionBar, type CloudAgentPlanItem, type CloudAgentUserQuestion } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import {
    answerCreationAgentQuestion,
    decideCreationAgentProposal,
    getCreationAgentSnapshot,
    mergeCreationAgentItems,
    sendCreationAgentMessage,
    stopCreationAgent,
    subscribeCreationAgent,
    type CreationAgentItem,
    type CreationAgentLive,
    type CreationAgentProposal,
    type CreationAgentStatus,
} from "@/services/api/creation-agent";
import type { CreationEntry } from "@/services/api/creation-sessions";
import { creationEntryMessages } from "./creation-session-sync";
import { CreationMessageView } from "./creation-workspace-messages";

const STATUS_LABELS: Partial<Record<CreationAgentStatus, string>> = {
    running: "Agent 正在思考",
    approval: "等待你确认方案",
    waiting: "正在生成",
    input: "等待你的回答",
    stopped: "已停止",
    error: "本轮出错了",
};

const BUSY_STATUSES = new Set<CreationAgentStatus>(["running", "waiting"]);

function formatCredits(microcredits?: string) {
    if (!microcredits || !/^\d+$/.test(microcredits)) return "";
    const value = Number(microcredits) / 1_000_000;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(value >= 1 ? 1 : 2).replace(/\.?0+$/, "")} 积分`;
}

function planItems(item?: CreationAgentItem): CloudAgentPlanItem[] {
    const steps = Array.isArray(item?.data.steps) ? (item!.data.steps as Array<Record<string, unknown>>) : [];
    return steps.map((step, index) => ({
        id: String(step.id || index + 1),
        title: String(step.step || ""),
        status: step.status === "completed" ? "done" : step.status === "in_progress" ? "doing" : "pending",
    }));
}

function questionFromItem(item: CreationAgentItem): CloudAgentUserQuestion {
    const data = item.data;
    return {
        question: String(data.question || ""),
        options: Array.isArray(data.options) ? (data.options as CloudAgentUserQuestion["options"]) : [],
        fields: Array.isArray(data.fields) ? (data.fields as CloudAgentUserQuestion["fields"]) : undefined,
        kind: data.kind === "form" ? "form" : "choice",
        questionId: typeof data.questionId === "string" ? data.questionId : undefined,
        allowFreeform: data.allowFreeform !== false,
        round: typeof data.round === "number" ? data.round : undefined,
        maxRounds: typeof data.maxRounds === "number" ? data.maxRounds : undefined,
    };
}

const PROPOSAL_STATUS: Record<CreationAgentProposal["status"], string> = {
    pending: "待确认",
    submitting: "提交中",
    rejected: "已拒绝",
    submitted: "生成中",
    completed: "已完成",
    failed: "未成功",
};

function ProposalCard({ proposal, busy, onDecide }: { proposal: CreationAgentProposal; busy: boolean; onDecide: (approve: boolean) => void }) {
    const pending = proposal.status === "pending";
    const config = proposal.form?.config || {};
    const chips = [proposal.modelName, config.size, config.quality, config.imageResolution, typeof config.durationSeconds === "number" ? `${config.durationSeconds} 秒` : ""].filter((value): value is string => typeof value === "string" && value !== "");
    const references = proposal.form?.references?.length || 0;
    return (
        <article className={`creation-agent-proposal is-${proposal.status}`} aria-label="生成方案">
            <header>
                <strong>{proposal.form?.title || proposal.summary || proposal.title || "生成方案"}</strong>
                <span className="creation-agent-proposal-status">{PROPOSAL_STATUS[proposal.status] || proposal.status}</span>
            </header>
            {proposal.form?.prompt ? <p className="creation-agent-proposal-prompt">{proposal.form.prompt}</p> : null}
            <div className="creation-agent-proposal-chips">
                {chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                ))}
                {references ? <span>参考 {references} 个素材</span> : null}
            </div>
            {proposal.error ? <p className="creation-agent-proposal-error">{proposal.error}</p> : null}
            {pending ? (
                <footer>
                    <span className="creation-agent-proposal-credits">预计 {formatCredits(proposal.creditsMicrocredits) || "—"}</span>
                    <Button size="small" icon={<X />} disabled={busy} onClick={() => onDecide(false)}>
                        不要
                    </Button>
                    <Button size="small" type="primary" icon={<Check />} loading={busy} onClick={() => onDecide(true)}>
                        确认生成
                    </Button>
                </footer>
            ) : null}
        </article>
    );
}

function ResultCard({ entry }: { entry: CreationEntry }) {
    const message = useMemo(() => creationEntryMessages(entry).find((item) => item.role === "assistant"), [entry]);
    if (!message) return null;
    return (
        <div className="creation-agent-result">
            <CreationMessageView item={message} shotNumber={0} onRetryFailure={() => undefined} onCreateVariant={() => undefined} onEditUserMessage={() => undefined} onContinueCanvas={() => undefined} openingCanvas={false} />
        </div>
    );
}

export type CreationAgentWorkspaceProps = {
    sessionId?: string;
    /** 首次发送前创建服务端会话，返回会话 ID。 */
    ensureSession: (title: string) => Promise<string>;
    onNewConversation: () => void;
    onOpenHistory: () => void;
    onExit: () => void;
};

export function CreationAgentWorkspace({ sessionId, ensureSession, onNewConversation, onOpenHistory, onExit }: CreationAgentWorkspaceProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const [model, setModel] = useState(() => (textModels.includes(config.textModel || "") ? config.textModel || "" : textModels[0] || ""));
    const [items, setItems] = useState<CreationAgentItem[]>([]);
    const [status, setStatus] = useState<CreationAgentStatus>("idle");
    const [live, setLive] = useState<CreationAgentLive | null>(null);
    const [loading, setLoading] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);
    const [deciding, setDeciding] = useState("");
    const [autoContinue, setAutoContinue] = useState(true);
    const [planMinimized, setPlanMinimized] = useState(false);
    const [reload, setReload] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const pendingRequest = useRef<{ requestId: string; text: string } | null>(null);

    useEffect(() => {
        if (!model && textModels.length) setModel(textModels[0]);
    }, [model, textModels]);

    useEffect(() => {
        if (!sessionId) {
            setItems([]);
            setStatus("idle");
            setLive(null);
            return;
        }
        let cancelled = false;
        let unsubscribe = () => undefined as void;
        setLoading(true);
        void getCreationAgentSnapshot(sessionId)
            .then((snapshot) => {
                if (cancelled) return;
                setItems(snapshot.items);
                setStatus(snapshot.status);
                unsubscribe = subscribeCreationAgent(sessionId, snapshot.lastSeq, {
                    onItem: (item) => {
                        setItems((current) => mergeCreationAgentItems(current, [item]));
                        if (item.type === "state" && typeof item.data.status === "string") setStatus(item.data.status as CreationAgentStatus);
                        if (item.type === "message" && item.data.role === "assistant") setLive(null);
                    },
                    onLive: setLive,
                    onGap: () => setReload((value) => value + 1),
                });
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "Agent 会话读取失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [message, reload, sessionId]);

    useEffect(() => {
        const element = scrollRef.current;
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }, [items.length, live?.text]);

    const timeline = useMemo(() => items.filter((item) => item.type !== "plan" && item.type !== "state" && item.type !== "context"), [items]);
    const plan = useMemo(() => planItems(items.find((item) => item.type === "plan")), [items]);
    const pendingQuestion = useMemo(() => items.filter((item) => item.type === "question" && item.data.status === "pending").at(-1), [items]);
    const entries = useMemo(() => {
        const map = new Map<string, CreationEntry>();
        for (const item of items) if (item.type === "result") map.set(String(item.data.id), item.data as unknown as CreationEntry);
        return map;
    }, [items]);
    const busy = BUSY_STATUSES.has(status);

    const modelSelection = useCallback(() => {
        if (!model) throw new Error("请先选择 Agent 使用的文本模型");
        const agentConfig = { ...config, model };
        const logicalModelId = logicalModelIDForConfig(agentConfig);
        if (logicalModelId) return { logicalModelId };
        const requestConfig = resolveModelRequestConfig(agentConfig, model);
        if (!requestConfig.channelId) throw new Error("所选模型不可用于 Agent，请换一个文本模型");
        return { channelId: requestConfig.channelId, channelModelKey: modelOptionName(model) || undefined };
    }, [config, model]);

    const send = async (text: string) => {
        const value = text.trim();
        if (!value || sending) return;
        setSending(true);
        try {
            // 同一条消息重试时沿用 requestId，服务端只受理一次。
            if (pendingRequest.current?.text !== value) pendingRequest.current = { requestId: createClientUUID(), text: value };
            const request = pendingRequest.current;
            const id = sessionId || (await ensureSession(value.slice(0, 24)));
            await sendCreationAgentMessage(id, { requestId: request.requestId, text: value, autoContinue, ...modelSelection() });
            pendingRequest.current = null;
            setPrompt("");
            if (id !== sessionId) setReload((current) => current + 1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送失败，请重试");
        } finally {
            setSending(false);
        }
    };

    const answer = async (questionItem: CreationAgentItem, value: string) => {
        if (!sessionId) return;
        setSending(true);
        try {
            await answerCreationAgentQuestion(sessionId, questionItem.id, { requestId: createClientUUID(), answer: value });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "回答提交失败");
        } finally {
            setSending(false);
        }
    };

    const decide = async (proposal: CreationAgentProposal, approve: boolean) => {
        if (!sessionId) return;
        setDeciding(proposal.id);
        try {
            const result = await decideCreationAgentProposal(sessionId, proposal.id, { decisionId: createClientUUID(), approve, expectedCreditsMicrocredits: approve ? proposal.creditsMicrocredits : undefined });
            setItems((current) => mergeCreationAgentItems(current, [result.proposal]));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "方案处理失败");
            setReload((value) => value + 1);
        } finally {
            setDeciding("");
        }
    };

    const stop = async () => {
        if (!sessionId) return;
        try {
            await stopCreationAgent(sessionId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "停止失败");
        }
    };

    const renderItem = (item: CreationAgentItem) => {
        const data = item.data;
        switch (item.type) {
            case "message":
                if (data.role === "user") {
                    return (
                        <div className="creation-agent-user">
                            <p>{String(data.text || "")}</p>
                        </div>
                    );
                }
                return <AgentChatMessage item={{ id: item.id, role: "assistant", text: String(data.text || "") }} theme={theme} />;
            case "output":
                if (data.kind === "reasoning") return <AgentChatMessage item={{ id: item.id, role: "assistant", text: String(data.text || ""), reasoning: true }} theme={theme} />;
                return (
                    <div className={`creation-agent-tool is-${String(data.status)}`}>
                        {data.status === "failed" ? <X /> : <Check />}
                        <span>{String(data.label || data.toolName || "工具")}</span>
                        {data.text ? <em>{String(data.text)}</em> : null}
                    </div>
                );
            case "question":
                if (data.status === "pending") return null;
                return <div className="creation-agent-activity">已回答：{String(data.question || "")}</div>;
            case "approval":
                return <ProposalCard proposal={data as unknown as CreationAgentProposal} busy={deciding === String(data.id)} onDecide={(approve) => void decide(data as unknown as CreationAgentProposal, approve)} />;
            case "result": {
                const entry = entries.get(String(data.id));
                return entry ? <ResultCard entry={entry} /> : null;
            }
            case "usage": {
                const credits = formatCredits(String(data.creditsMicrocredits || ""));
                return credits && credits !== "0 积分" ? <div className="creation-agent-usage">本轮对话消耗 {credits}</div> : null;
            }
            case "activity":
                return <div className={`creation-agent-activity ${data.tone === "error" ? "is-error" : ""}`}>{String(data.text || "")}</div>;
            default:
                return null;
        }
    };

    return (
        <div className="creation-agent-workspace">
            <header className="creation-agent-toolbar">
                <Button type="text" onClick={onExit}>
                    返回快速创作
                </Button>
                <span className="creation-agent-status" role="status">
                    {BUSY_STATUSES.has(status) ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
                    {STATUS_LABELS[status] || ""}
                </span>
                <Tooltip title="新对话">
                    <Button type="text" icon={<Plus />} aria-label="新对话" onClick={onNewConversation} />
                </Tooltip>
                <Tooltip title="历史对话">
                    <Button type="text" icon={<History />} aria-label="历史对话" onClick={onOpenHistory} />
                </Tooltip>
            </header>
            {plan.length ? (
                <div className="creation-agent-plan">
                    <AgentPlanBar items={plan} theme={theme} minimized={planMinimized} onToggle={() => setPlanMinimized((value) => !value)} terminal={status === "stopped" || status === "error"} waitingUser={status === "input"} />
                </div>
            ) : null}
            <main ref={scrollRef} className="creation-agent-timeline creation-scrollbar" aria-live="polite">
                {loading && !items.length ? (
                    <div className="creation-agent-empty">
                        <LoaderCircle className="motion-safe:animate-spin" />
                    </div>
                ) : null}
                {!loading && !timeline.length && !live ? (
                    <div className="creation-agent-empty">
                        <h2>和 Agent 一起创作</h2>
                        <p>说说你想做什么。Agent 会先给出方案，你确认后才会生成和扣费。</p>
                    </div>
                ) : null}
                {timeline.map((item) => (
                    <div key={item.id} className="creation-agent-item">
                        {renderItem(item)}
                    </div>
                ))}
                {live?.text ? (
                    <div className="creation-agent-item">
                        <AgentChatMessage item={{ id: `live:${live.messageId}`, role: "assistant", text: live.text, streaming: true }} theme={theme} isStreaming />
                    </div>
                ) : null}
            </main>
            {pendingQuestion ? (
                <div className="creation-agent-question">
                    <AgentQuestionBar key={pendingQuestion.id} question={questionFromItem(pendingQuestion)} theme={theme} disabled={sending} onAnswer={(value) => void answer(pendingQuestion, value)} />
                </div>
            ) : null}
            <section className="creation-agent-composer">
                <textarea
                    aria-label="给 Agent 的消息"
                    placeholder={busy ? "Agent 正在工作，发送的内容会作为补充要求送达" : "描述你想创作的内容，例如：给我的咖啡店做一组三张海报"}
                    value={prompt}
                    maxLength={16000}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            void send(prompt);
                        }
                    }}
                />
                <div className="creation-agent-composer-bar">
                    <Select size="small" className="creation-agent-model" value={model || undefined} placeholder="选择文本模型" onChange={setModel} options={textModels.map((value) => ({ value, label: modelOptionName(value) || value }))} />
                    <label className="creation-agent-auto">
                        <Switch size="small" checked={autoContinue} onChange={setAutoContinue} />
                        生成后自动继续
                    </label>
                    {busy ? <Button shape="circle" icon={<Square />} aria-label="停止" onClick={() => void stop()} /> : null}
                    <Button type="primary" shape="circle" icon={sending ? <LoaderCircle className="motion-safe:animate-spin" /> : <ArrowUp />} aria-label="发送" disabled={!prompt.trim() || sending} onClick={() => void send(prompt)} />
                </div>
            </section>
        </div>
    );
}
