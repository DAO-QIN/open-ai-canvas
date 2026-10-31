import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Brain, Check, CheckCircle2, ChevronDown, CircleHelp, Globe, Info, ListChecks, LoaderCircle } from "lucide-react";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { creationAgentReadableText } from "./creation-agent-steps";
import type { CreationAgentQuestion, CreationAgentQuestionField, CreationAgentStep, CreationAgentWebSource } from "./creation-types";

/**
 * 创作页 Agent 回复的执行过程：思考可折叠、工具一行一条、正文按发生顺序穿插，
 * 计划/提问/媒体在各自落点由调用方渲染。只负责展示，不发请求。
 */

export function CreationShimmerText({ children, busy = true }: { children: ReactNode; busy?: boolean }) {
    return (
        <span className="creation-shimmer-text" data-busy={busy ? "true" : undefined}>
            {children}
        </span>
    );
}

function LiveSeconds() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
        return () => window.clearInterval(timer);
    }, []);
    return seconds > 0 ? <span className="creation-agent-thinking-time">{seconds} 秒</span> : null;
}

/** 思考块：输出时自动展开并跟随到底部；结束 1 秒后自动收起，用户手动展开或收起后不再干预。 */
export function CreationAgentThinking({ text, streaming, durationSeconds }: { text: string; streaming: boolean; durationSeconds?: number }) {
    const [open, setOpen] = useState(streaming);
    const touchedRef = useRef(false);
    const wasStreamingRef = useRef(streaming);
    const bodyRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const bodyId = useId();
    useEffect(() => {
        if (streaming) {
            wasStreamingRef.current = true;
            if (!touchedRef.current) setOpen(true);
            return;
        }
        if (!wasStreamingRef.current || touchedRef.current) return;
        const timer = window.setTimeout(() => {
            if (!touchedRef.current) setOpen(false);
        }, 1000);
        return () => window.clearTimeout(timer);
    }, [streaming]);
    useEffect(() => {
        const body = bodyRef.current;
        if (streaming && open && body && followRef.current) body.scrollTop = body.scrollHeight;
    }, [text, streaming, open]);
    const readable = useMemo(() => creationAgentReadableText(text), [text]);
    return (
        <div className="creation-agent-thinking" data-streaming={streaming ? "true" : undefined}>
            <button
                type="button"
                className="creation-agent-thinking-toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => {
                    touchedRef.current = true;
                    setOpen((value) => !value);
                }}
            >
                <Brain aria-hidden="true" />
                {streaming ? (
                    <>
                        <CreationShimmerText>思考中…</CreationShimmerText>
                        <LiveSeconds />
                    </>
                ) : durationSeconds ? (
                    <span>思考了 {durationSeconds} 秒</span>
                ) : (
                    <span>已思考</span>
                )}
                <ChevronDown className="creation-agent-thinking-chevron" aria-hidden="true" />
            </button>
            {open ? (
                <div
                    id={bodyId}
                    ref={bodyRef}
                    className="creation-agent-thinking-body creation-scrollbar"
                    tabIndex={0}
                    aria-label="思考内容"
                    onScroll={(event) => {
                        const element = event.currentTarget;
                        followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
                    }}
                >
                    <AIMessageMarkdown isStreaming={streaming} streamingAnimation="none">
                        {readable}
                    </AIMessageMarkdown>
                </div>
            ) : null}
        </div>
    );
}

function sourceHost(url: string) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

function CreationAgentSourceList({ id, sources, label }: { id: string; sources: CreationAgentWebSource[]; label: string }) {
    return (
        <ol id={id} className="creation-agent-sources" aria-label={label}>
            {sources.map((source, index) => (
                <li key={`${source.url}-${index}`}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
                        <span>{source.title}</span>
                        <small>{source.siteName || sourceHost(source.url)}</small>
                    </a>
                </li>
            ))}
        </ol>
    );
}

export function CreationAgentStepLine({ step }: { step: Extract<CreationAgentStep, { kind: "tool" | "notice" }> }) {
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const sourcesId = useId();
    const failed = step.kind === "tool" && step.status === "failed";
    const runningTool = step.kind === "tool" && step.status === "running";
    const sources = step.kind === "tool" ? step.sources || [] : [];
    // 读取网页只有这一页来源：标题本身做成链接，不再另给"查看来源"。
    const page = step.kind === "tool" && step.toolName === "web_fetch" && sources.length === 1 ? sources[0] : undefined;
    const listed = page ? [] : sources;
    const Icon = step.kind === "notice" ? Info : runningTool ? LoaderCircle : failed ? AlertTriangle : step.toolName === "plan_update" ? ListChecks : CheckCircle2;
    const line = (
        <p className="creation-agent-step-line" data-status={step.kind === "notice" ? "notice" : step.status} role={runningTool ? "status" : undefined}>
            <Icon className={runningTool ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
            {runningTool ? <CreationShimmerText>{`${step.label}…`}</CreationShimmerText> : <span>{step.kind === "notice" ? step.text : step.label}</span>}
            {step.kind === "tool" && step.detail ? (
                page ? (
                    <a className="creation-agent-step-detail creation-agent-step-link" href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
                        {step.detail}
                    </a>
                ) : (
                    <span className="creation-agent-step-detail">{step.detail}</span>
                )
            ) : null}
            {step.kind === "tool" && step.count > 1 ? <span className="creation-agent-step-count">×{step.count}</span> : null}
            {listed.length ? (
                <button type="button" className="creation-agent-sources-toggle" aria-expanded={sourcesOpen} aria-controls={sourcesId} onClick={() => setSourcesOpen((value) => !value)}>
                    {sourcesOpen ? "收起来源" : "查看来源"}
                    <ChevronDown className="creation-agent-thinking-chevron" aria-hidden="true" />
                </button>
            ) : null}
        </p>
    );
    if (!listed.length) return line;
    return (
        <div className="creation-agent-step-group">
            {line}
            {sourcesOpen ? <CreationAgentSourceList id={sourcesId} sources={listed} label="搜索来源" /> : null}
        </div>
    );
}

/** 一条回复里联网用到的网页：搜索结果与读过的网页按链接去重，读过的排在前面。 */
export function creationAgentReplySources(steps: CreationAgentStep[]): CreationAgentWebSource[] {
    const read: CreationAgentWebSource[] = [];
    const searched: CreationAgentWebSource[] = [];
    for (const step of steps) {
        if (step.kind !== "tool" || step.status !== "completed") continue;
        (step.toolName === "web_fetch" ? read : searched).push(...(step.sources || []));
    }
    const seen = new Set<string>();
    const sources: CreationAgentWebSource[] = [];
    for (const source of [...read, ...searched]) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
    }
    return sources;
}

/** 回复末尾的来源汇总：默认一行（网页数和前几个站点），展开后列出全部链接。 */
export function CreationAgentReplySources({ sources }: { sources: CreationAgentWebSource[] }) {
    const [open, setOpen] = useState(false);
    const listId = useId();
    if (!sources.length) return null;
    const sites = [...new Set(sources.map((source) => source.siteName || sourceHost(source.url)).filter(Boolean))].slice(0, 3);
    return (
        <div className="creation-agent-reply-sources">
            <button type="button" className="creation-agent-thinking-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
                <Globe aria-hidden="true" />
                <span>参考了 {sources.length} 个网页</span>
                {sites.length ? <small className="creation-agent-reply-sources-sites">{sites.join("、")}</small> : null}
                <ChevronDown className="creation-agent-thinking-chevron" aria-hidden="true" />
            </button>
            {open ? <CreationAgentSourceList id={listId} sources={sources} label="参考来源" /> : null}
        </div>
    );
}

function processSummary(steps: CreationAgentStep[]) {
    const reasoning = steps.filter((step): step is Extract<CreationAgentStep, { kind: "reasoning" }> => step.kind === "reasoning");
    const tools = steps.reduce((total, step) => total + (step.kind === "tool" ? step.count : 0), 0);
    const seconds = reasoning.reduce((total, step) => total + (step.durationSeconds || 0), 0);
    return [reasoning.length ? (seconds ? `思考了 ${seconds} 秒` : "已思考") : "", tools ? `执行了 ${tools} 步` : ""].filter(Boolean).join(" · ") || "执行过程";
}

/** 简洁偏好下，已结束的连续思考与工具收成一行；展开后按原顺序查看。 */
export function CreationAgentProcessFold({ steps, renderStep }: { steps: CreationAgentStep[]; renderStep: (step: CreationAgentStep) => ReactNode }) {
    const [open, setOpen] = useState(false);
    const bodyId = useId();
    return (
        <div className="creation-agent-fold">
            <button type="button" className="creation-agent-thinking-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
                <ListChecks aria-hidden="true" />
                <span>{processSummary(steps)}</span>
                <ChevronDown className="creation-agent-thinking-chevron" aria-hidden="true" />
            </button>
            {open ? (
                <div id={bodyId} className="creation-agent-fold-body">
                    {steps.map((step) => (
                        <div key={step.id}>{renderStep(step)}</div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

const isProcessStep = (step: CreationAgentStep) => step.kind === "reasoning" || step.kind === "tool" || step.kind === "notice";

export type CreationAgentFlowBlock = { kind: "step"; step: CreationAgentStep } | { kind: "fold"; id: string; steps: CreationAgentStep[] };

/**
 * 时间线分组：collapsed 时只保留落点（方案、提问、媒体）；fold 时把两步以上的连续过程收成一行。
 * 正在输出的思考永远单独展示，不会被收进折叠行。
 */
export function creationAgentFlowBlocks(steps: CreationAgentStep[], options: { collapsed: boolean; fold: boolean }): CreationAgentFlowBlock[] {
    const visible = options.collapsed ? steps.filter((step) => step.kind === "media" || step.kind === "review" || step.kind === "question") : steps;
    if (!options.fold) return visible.map((step) => ({ kind: "step", step }));
    const blocks: CreationAgentFlowBlock[] = [];
    let run: CreationAgentStep[] = [];
    const flush = () => {
        if (run.length >= 2) blocks.push({ kind: "fold", id: `fold-${run[0].id}`, steps: run });
        else blocks.push(...run.map((step): CreationAgentFlowBlock => ({ kind: "step", step })));
        run = [];
    };
    for (const step of visible) {
        if (isProcessStep(step) && !(step.kind === "reasoning" && step.streaming) && !(step.kind === "tool" && step.status === "running")) {
            run.push(step);
            continue;
        }
        flush();
        blocks.push({ kind: "step", step });
    }
    flush();
    return blocks;
}

export function CreationAgentTextStep({ step }: { step: Extract<CreationAgentStep, { kind: "text" }> }) {
    return (
        <div className="creation-agent-flow-text">
            <AIMessageMarkdown isStreaming={step.streaming} streamingAnimation="none">
                {step.text}
            </AIMessageMarkdown>
        </div>
    );
}

export function renderCreationAgentProcessStep(step: CreationAgentStep): ReactNode {
    if (step.kind === "reasoning") return <CreationAgentThinking text={step.text} streaming={step.streaming} durationSeconds={step.durationSeconds} />;
    if (step.kind === "tool" || step.kind === "notice") return <CreationAgentStepLine step={step} />;
    if (step.kind === "text") return <CreationAgentTextStep step={step} />;
    return null;
}

type FieldValue = string | string[];

function fieldKey(field: CreationAgentQuestionField, index: number) {
    return field.id || `field-${index}`;
}

function optionValue(option: { id?: string; label: string }) {
    return option.id || option.label;
}

function fieldDefaults(field: CreationAgentQuestionField): FieldValue {
    const multiple = field.type === "multi_select";
    if (field.defaultValue !== undefined) {
        const values = Array.isArray(field.defaultValue) ? field.defaultValue : [field.defaultValue];
        return multiple ? values : values[0] || "";
    }
    const recommended = (field.options || []).filter((option) => option.recommended).map(optionValue);
    return multiple ? recommended : recommended[0] || "";
}

/** 表单回答写成自然语言发给 Agent，用户气泡里看到的就是这段话。 */
export function creationAgentFormAnswer(question: CreationAgentQuestion, values: Record<string, FieldValue>, notes: string, customs: Record<string, string> = {}) {
    const lines = (question.fields || []).flatMap((field, index) => {
        const key = fieldKey(field, index);
        const raw = values[key];
        const selected = (Array.isArray(raw) ? raw : [raw || ""]).map((value) => value.trim()).filter(Boolean);
        const labels = selected.map((value) => field.options?.find((option) => optionValue(option) === value)?.label || value);
        if (customs[key]?.trim()) labels.push(customs[key].trim());
        return labels.length ? [`${field.title}：${labels.join("、")}`] : [];
    });
    if (notes.trim()) lines.push(`补充说明：${notes.trim()}`);
    return lines.join("\n");
}

/** 单选回答：选项发送选项名，"其他想法"（排在选项之后）发送用户写下的内容。 */
export function creationAgentChoiceAnswer(question: CreationAgentQuestion, choice: number | null, custom: string) {
    if (choice === null) return "";
    return choice >= question.options.length ? custom.trim() : question.options[choice]?.label || "";
}

const ANSWER_LIMIT = 4000;

/**
 * Agent 的提问卡：选项可直接点选，"其他想法"展开输入框，点"继续"后作为下一条消息发送。
 * 不在等待回答时（已回复或换了新一轮）收成一行，可展开查看当时的选项。
 */
export function CreationAgentQuestionCard({ question, pending, disabled = false, onAnswer }: { question: CreationAgentQuestion; pending: boolean; disabled?: boolean; onAnswer: (answer: string) => Promise<boolean> }) {
    const formId = useId();
    const fields = question.fields || [];
    const isForm = question.kind === "form" || fields.length > 0;
    const allowFreeform = question.allowFreeform !== false;
    const [choice, setChoice] = useState<number | null>(null);
    const [custom, setCustom] = useState("");
    const [values, setValues] = useState<Record<string, FieldValue>>(() => Object.fromEntries(fields.map((field, index) => [fieldKey(field, index), fieldDefaults(field)])));
    const [customs, setCustoms] = useState<Record<string, string>>({});
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [validation, setValidation] = useState("");
    const [expanded, setExpanded] = useState(false);
    const prefilled = fields.some((field) => {
        const value = fieldDefaults(field);
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    const otherIndex = question.options.length;
    const usingOther = choice === otherIndex;
    const answer = isForm ? creationAgentFormAnswer(question, values, notes, customs) : creationAgentChoiceAnswer(question, choice, custom);
    const locked = disabled || submitting || sent;

    const submit = async (text: string, source: { values: Record<string, FieldValue>; customs: Record<string, string> } = { values, customs }) => {
        if (locked) return;
        if (!text.trim()) {
            setValidation(isForm ? "请至少填写一项" : usingOther ? "请写下你的想法" : "请选择一项");
            return;
        }
        if (text.length > ANSWER_LIMIT) {
            setValidation(`回答最多 ${ANSWER_LIMIT} 字`);
            return;
        }
        if (isForm) {
            const missing = fields.find((field, index) => {
                const key = fieldKey(field, index);
                const raw = source.values[key];
                return field.required && !(Array.isArray(raw) ? raw.length : String(raw || "").trim()) && !source.customs[key]?.trim();
            });
            if (missing) {
                setValidation(`请填写“${missing.title}”`);
                return;
            }
        }
        setValidation("");
        setSubmitting(true);
        try {
            if (await onAnswer(text.trim())) setSent(true);
        } finally {
            setSubmitting(false);
        }
    };

    if (!pending) {
        return (
            <section className="creation-agent-choice is-settled" aria-label={question.question}>
                <button type="button" className="creation-agent-choice-summary" aria-expanded={expanded} aria-controls={`${formId}-history`} onClick={() => setExpanded((value) => !value)}>
                    <Check aria-hidden="true" />
                    <span>已回复</span>
                    <span className="creation-agent-choice-summary-text" title={question.question}>
                        · {question.question}
                    </span>
                    <ChevronDown className="creation-agent-thinking-chevron" aria-hidden="true" />
                </button>
                {expanded ? (
                    <ol id={`${formId}-history`} className="creation-agent-choice-history">
                        {isForm
                            ? fields.map((field, index) => (
                                  <li key={fieldKey(field, index)}>
                                      <strong>{field.title}</strong>
                                      {field.options?.length ? <span>{field.options.map((option) => option.label).join("、")}</span> : null}
                                  </li>
                              ))
                            : question.options.map((option, index) => (
                                  <li key={`${option.label}-${index}`}>
                                      <strong>{option.label}</strong>
                                      {option.detail ? <span>{option.detail}</span> : null}
                                  </li>
                              ))}
                    </ol>
                ) : null}
            </section>
        );
    }

    return (
        <section className="creation-agent-choice" aria-label={question.question} aria-busy={submitting}>
            <header className="creation-agent-choice-heading">
                <CircleHelp aria-hidden="true" />
                <span>{isForm ? "需要你确认" : "需要你选择 · 单选"}</span>
                {question.round && question.maxRounds && question.maxRounds > 1 ? (
                    <span className="creation-agent-choice-round">
                        {question.round}/{question.maxRounds}
                    </span>
                ) : null}
            </header>
            <h3 className="creation-agent-choice-title">{question.question}</h3>
            <form
                className="creation-agent-choice-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit(answer);
                }}
            >
                {isForm ? (
                    <div className="creation-agent-choice-fields">
                        {fields.map((field, index) => {
                            const key = fieldKey(field, index);
                            const value = values[key];
                            const multiple = field.type === "multi_select";
                            const textual = field.type === "text" || field.type === "textarea" || !field.options?.length;
                            const update = (next: FieldValue) => setValues((current) => ({ ...current, [key]: next }));
                            return (
                                <fieldset key={key} className="creation-agent-choice-field" disabled={locked}>
                                    <legend>
                                        {field.title}
                                        {field.required ? <span aria-hidden="true"> *</span> : null}
                                        {multiple ? <small>可多选</small> : null}
                                    </legend>
                                    {textual ? (
                                        field.type === "textarea" ? (
                                            <textarea value={String(value || "")} placeholder={field.placeholder || "请填写"} maxLength={1000} onChange={(event) => update(event.target.value)} />
                                        ) : (
                                            <input value={String(value || "")} placeholder={field.placeholder || "请填写"} maxLength={300} onChange={(event) => update(event.target.value)} />
                                        )
                                    ) : (
                                        <div className="creation-agent-choice-chips" role="group" aria-label={field.title}>
                                            {field.options!.map((option) => {
                                                const optionId = optionValue(option);
                                                const selected = multiple ? Array.isArray(value) && value.includes(optionId) : value === optionId;
                                                return (
                                                    <button
                                                        key={optionId}
                                                        type="button"
                                                        aria-pressed={selected}
                                                        title={option.detail || option.label}
                                                        onClick={() => {
                                                            if (multiple) {
                                                                const current = Array.isArray(value) ? value : [];
                                                                update(selected ? current.filter((item) => item !== optionId) : [...current, optionId]);
                                                            } else update(selected ? "" : optionId);
                                                        }}
                                                    >
                                                        {option.label}
                                                        {option.recommended ? <small>推荐</small> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {field.allowCustom && !textual ? (
                                        <input
                                            className="creation-agent-choice-custom-input"
                                            value={customs[key] || ""}
                                            placeholder={field.placeholder || "或输入自定义内容"}
                                            maxLength={300}
                                            aria-label={`${field.title}的自定义内容`}
                                            onChange={(event) => setCustoms((current) => ({ ...current, [key]: event.target.value }))}
                                        />
                                    ) : null}
                                </fieldset>
                            );
                        })}
                        {allowFreeform ? (
                            <label className="creation-agent-choice-field">
                                <span className="creation-agent-choice-field-title">补充说明</span>
                                <textarea value={notes} disabled={locked} maxLength={2000} placeholder="还有其他要求，可以写在这里" onChange={(event) => setNotes(event.target.value)} />
                            </label>
                        ) : null}
                    </div>
                ) : (
                    <fieldset className="creation-agent-choice-options" disabled={locked}>
                        <legend className="sr-only">{allowFreeform ? "选择一项，或写下其他想法" : "选择一项"}</legend>
                        {[...question.options, ...(allowFreeform ? [{ label: "其他想法", detail: "写下你希望怎么做" }] : [])].map((option, index) => (
                            <label key={`${option.label}-${index}`} className="creation-agent-choice-option" data-selected={choice === index ? "true" : undefined}>
                                <input className="sr-only" type="radio" name={formId} value={index} checked={choice === index} onChange={() => setChoice(index)} />
                                <span className="creation-agent-choice-number" aria-hidden="true">
                                    {index + 1}
                                </span>
                                <span className="creation-agent-choice-option-text">
                                    <strong>{option.label}</strong>
                                    {option.detail ? <span>{option.detail}</span> : null}
                                </span>
                                <Check className="creation-agent-choice-check" aria-hidden="true" />
                            </label>
                        ))}
                        {usingOther ? <textarea className="creation-agent-choice-custom" autoFocus value={custom} maxLength={2000} placeholder="写下你希望怎么做…" aria-label="你的其他想法" onChange={(event) => setCustom(event.target.value)} /> : null}
                    </fieldset>
                )}
                <footer className="creation-agent-choice-actions">
                    <span className="creation-agent-choice-hint" role="status">
                        {validation || (sent ? "已提交，正在继续…" : submitting ? "正在提交…" : isForm ? (prefilled ? "已按推荐预填，可直接继续" : "填写后继续") : choice === null ? "选择后继续，也可以写下自己的想法" : "")}
                    </span>
                    {isForm ? (
                        <button
                            type="button"
                            className="creation-agent-choice-secondary"
                            disabled={locked}
                            onClick={() => {
                                const defaults = Object.fromEntries(fields.map((field, index) => [fieldKey(field, index), fieldDefaults(field)]));
                                void submit(creationAgentFormAnswer(question, defaults, "") || "按推荐方案继续", { values: defaults, customs: {} });
                            }}
                        >
                            按推荐继续
                        </button>
                    ) : null}
                    <button type="submit" className="creation-agent-choice-submit" disabled={locked || !answer.trim()}>
                        继续
                        <ArrowRight aria-hidden="true" />
                    </button>
                </footer>
            </form>
        </section>
    );
}
