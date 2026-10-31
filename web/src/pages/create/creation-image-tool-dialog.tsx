// 结果图工具弹窗（参考即梦）：左边看图和操作，右边选参数，点生成直接出图，结果接在对话末尾。
// 弹窗只负责交互和换算（蒙版、扩图底图、尺寸档位、提示词），上传参考图和提交生成由创作页统一处理。
// 打光、多角度、区域标注、裁剪和调整尺寸直接复用画布的同名弹窗，保证两边效果一致。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { App, Button, Slider, Spin } from "antd";
import { ArrowUp, Brush, Copy, Download, Eraser, Move, Redo2, RefreshCw, RotateCcw, Undo2, X } from "lucide-react";
import { saveAs } from "file-saver";

import { AppModal } from "@/components/ui/product/app-modal";
import { Tooltip } from "@/components/ui/base/tooltip";
import { ModelPicker } from "@/components/model-picker";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { ImageParameterFields } from "@/components/image-parameter-fields";
import { ImageSizePicker } from "@/components/image-size-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { CanvasNodeAnglePanel } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeLightingPanel, buildLightingLabel } from "@/components/canvas/canvas-node-lighting-dialog";
import { CanvasNodeRegionEditDialog, type CanvasImageRegionEditPayload } from "@/components/canvas/canvas-node-region-edit-dialog";
import { buildCanvasTextEditPrompt } from "@/components/canvas/canvas-node-text-edit-dialog";
import { CanvasNodeUpscaleDialog } from "@/components/canvas/canvas-node-upscale-dialog";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { CANVAS_GRID_SPLIT_MAX, CANVAS_GRID_SPLIT_PRESETS, isValidGridSplit } from "@/lib/canvas/canvas-grid-split";
import { buildAngleLabel, buildAnglePrompt } from "@/lib/canvas/canvas-project-domain";
import { canvasToolMentionToken } from "@/lib/canvas/canvas-resource-references";
import { exportEditMask, paintMaskStrokes, type MaskPoint, type MaskStroke } from "@/lib/canvas/image-mask-document";
import { buildRegionEditPrompt } from "@/lib/canvas/image-region-edit";
import { dataUrlToFile } from "@/lib/image-utils";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { mergedImageCapabilityConfig, resolveCompatibleModel } from "@/lib/model-selection";
import { IMAGE_PROMPT_REVERSE } from "@/lib/prompts";
import { createZip } from "@/lib/zip";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { resolveResourceUrl } from "@/services/api/resources";
import { modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CreationIcon, type CreationIconName } from "./creation-icons";
import {
    creationImageRedoModel,
    creationImageRedoModelIssue,
    creationImageRedoPrompt,
    creationImageRedoRequirements,
    creationImageRedoSettings,
    creationImageRedoVisiblePrompt,
    type CreationImageRedoRequest,
    type CreationImageRedoSettings,
    type CreationImageRedoSource,
} from "./creation-image-redo";
import { creationImageMoreGroups, creationImagePresetTools, creationImageTools, type CreationImageToolId } from "./creation-image-tool-catalog";
import {
    CREATION_EXPAND_RATIOS,
    CREATION_EXPAND_SCALES,
    CREATION_TEXT_DETECTION_PROMPT,
    CREATION_VARIANT_DIRECTIONS,
    creationExpandAddsArea,
    creationExpandPrompt,
    creationImageSettingsForSource,
    creationImageTierOptions,
    creationInpaintPrompt,
    creationRatioSize,
    creationUpscalePrompt,
    creationVariantPrompt,
    loadCreationResultImage,
    maskStrokeBounds,
    parseCreationTextLines,
    planCreationExpand,
    regionEditDisplayPrompt,
    removeBackgroundPrompt,
    renderCreationExpandBase,
    renderMaskAnnotation,
    type CreationExpandPlan,
    type CreationImageSettingsPatch,
    type CreationLoadedImage,
    type CreationPixelSize,
    type CreationTextLine,
    type CreationVariantStrength,
} from "./creation-image-tools";
import type { CreationResultImageRef } from "./creation-workspace-messages";
import "./creation-image-tools.css";

export type CreationImageToolTarget = { tool: CreationImageToolId; image: CreationResultImageRef; url: string };

/** 参考图按顺序发给模型：source 是这张结果图本身（不重传），upload 是弹窗里生成的底图或标注图。 */
export type CreationImageToolReference = { kind: "source"; size?: CreationPixelSize } | { kind: "upload"; file: File; name: string; size?: CreationPixelSize };

export type CreationImageToolRequest = {
    tool: CreationImageToolId;
    model: string;
    prompt: string;
    /** 对话里显示的内容；不传就显示 prompt。 */
    displayPrompt?: string;
    references: CreationImageToolReference[];
    /** 透明像素为可编辑区域；只在模型支持蒙版时传。 */
    mask?: string;
    size: CreationImageSettingsPatch;
    count?: number;
    transparentBackground?: boolean;
};

export type CreationImageDescribePurpose = "text-detection" | "reverse-prompt";

export type CreationImageToolDialogProps = {
    target: CreationImageToolTarget;
    config: AiConfig;
    /** 输入框记住的图片参数；除高清外，工具沿用这里的清晰度档位。 */
    savedSettings: CreationImageSettingsPatch;
    onClose: () => void;
    /** 提交生成；成功后由创作页关闭弹窗，失败时抛出可以直接展示的错误。 */
    onGenerate: (request: CreationImageToolRequest) => Promise<void>;
    /** 裁剪、切分出来的图片放进输入框作为参考。 */
    onUseImages: (files: File[], label: string) => Promise<void>;
    /** 用文本模型看图（识别文字、反推提示词），返回模型原文。 */
    onDescribe: (instruction: string, purpose: CreationImageDescribePurpose, signal: AbortSignal) => Promise<string>;
    onFillPrompt: (prompt: string) => void;
};

/** 标注图里的涂抹色：模型看到的颜色要和界面一致，所以不跟随主题。 */
const MASK_COLOR = "#ff3b30";
const primaryIcons: Partial<Record<CreationImageToolId, CreationIconName>> = { variant: "variant", upscale: "hd", inpaint: "inpaint", expand: "expand", erase: "erase" };

export function CreationImageToolDialog(props: CreationImageToolDialogProps) {
    switch (props.target.tool) {
        case "upscale":
            return <UpscaleTool {...props} />;
        case "expand":
            return <ExpandTool {...props} />;
        case "inpaint":
            return <MaskTool {...props} erase={false} />;
        case "erase":
            return <MaskTool {...props} erase />;
        case "variant":
            return <VariantTool {...props} />;
        case "region":
            return <RegionTool {...props} />;
        case "textEdit":
            return <TextEditTool {...props} />;
        case "lighting":
        case "angle":
            return <PanelTool {...props} />;
        case "crop":
            return <CropTool {...props} />;
        case "resize":
            return <ResizeTool {...props} />;
        case "split":
            return <SplitTool {...props} />;
        case "reversePrompt":
            return <ReversePromptTool {...props} />;
        default:
            return <PresetTool {...props} />;
    }
}

function editableModel(config: AiConfig, model: string) {
    return (modelCapabilityConfigFor(config, model).image?.references.maxImages ?? 0) >= 1;
}

/** 默认用输入框选的图片模型；它不能收参考图时换成第一个能编辑图片的模型。 */
function initialToolModel(config: AiConfig) {
    if (config.imageModel && editableModel(config, config.imageModel)) return config.imageModel;
    return selectableModelsByCapability(config, "image").find((model) => editableModel(config, model)) || config.imageModel || "";
}

function useToolModel(config: AiConfig) {
    const [model, setModel] = useState(() => initialToolModel(config));
    const profile = useMemo(() => modelCapabilityConfigFor(config, model).image, [config, model]);
    // 尺寸档位按同名模型组合并后的能力算，提交时由兼容路由落到具体模型。
    const sizeProfile = useMemo(() => mergedImageCapabilityConfig(config, model), [config, model]);
    return { model, setModel, profile, sizeProfile };
}

function useToolSource(target: Pick<CreationImageToolTarget, "image" | "url">) {
    const [state, setState] = useState<{ source: CreationLoadedImage | null; error: string }>({ source: null, error: "" });
    // 弹窗按工具和图片设了 key，同一个实例里目标不会变，这里只读一次。
    useEffect(() => {
        const controller = new AbortController();
        loadCreationResultImage({ url: target.url, storageKey: target.image.storageKey }, controller.signal).then(
            (source) => {
                if (!controller.signal.aborted) setState({ source, error: "" });
            },
            (failure: unknown) => {
                if (!controller.signal.aborted) setState({ source: null, error: failure instanceof Error ? failure.message : "图片读取失败" });
            },
        );
        return () => controller.abort();
    }, [target.image.storageKey, target.url]);
    return state;
}

function useMountedRef() {
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    return mounted;
}

/** 提交期间按钮转圈、重复点击无效；失败把原因留在弹窗里，用户改完可以直接重试。 */
function useToolSubmit<T>(onGenerate: (request: T) => Promise<void>) {
    const mounted = useMountedRef();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const busy = useRef(false);
    const submit = async (build: () => T | Promise<T>) => {
        if (busy.current) return;
        busy.current = true;
        setError("");
        setSubmitting(true);
        try {
            await onGenerate(await build());
        } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : "提交失败，请重试");
        } finally {
            busy.current = false;
            if (mounted.current) setSubmitting(false);
        }
    };
    return { submitting, error, setError, submit };
}

/**
 * 打开弹窗后自动跑一次的看图任务（识别文字、反推提示词），可以手动重跑。
 * 用定时器推迟到挂载完成后再发起：StrictMode 的模拟卸载会清掉第一次定时器，不会重复提交收费任务。
 */
function useAutoTask<T>(task: (signal: AbortSignal) => Promise<T>) {
    const taskRef = useRef(task);
    useEffect(() => {
        taskRef.current = task;
    });
    const controllerRef = useRef<AbortController | null>(null);
    const [state, setState] = useState<{ value?: T; loading: boolean; error: string }>({ loading: true, error: "" });
    const run = useCallback(() => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setState((current) => ({ value: current.value, loading: true, error: "" }));
        taskRef.current(controller.signal).then(
            (value) => {
                if (!controller.signal.aborted) setState({ value, loading: false, error: "" });
            },
            (failure: unknown) => {
                if (!controller.signal.aborted) setState((current) => ({ value: current.value, loading: false, error: failure instanceof Error ? failure.message : "识别失败，请重试" }));
            },
        );
    }, []);
    useEffect(() => {
        const timer = window.setTimeout(run, 0);
        return () => {
            window.clearTimeout(timer);
            controllerRef.current?.abort();
        };
    }, [run]);
    return { ...state, run };
}

/** 「重做」不在图上的工具目录里（入口在图下方一行），共用同一个弹窗外壳。 */
type ToolShellKind = CreationImageToolId | "redo";
const redoMeta = { title: "重做", description: "按原提示词再生成一次，可以换模型和尺寸" };
const toolMeta = (tool: ToolShellKind) => (tool === "redo" ? redoMeta : creationImageTools[tool]);

function ToolIcon({ tool }: { tool: ToolShellKind }) {
    if (tool === "redo") return <RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />;
    const name = primaryIcons[tool];
    if (name) return <CreationIcon name={name} size={20} />;
    const Icon = creationImageMoreGroups.flatMap((group) => group.items).find((item) => item.intent === tool)?.icon;
    return Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden="true" /> : null;
}

type ToolShellProps = {
    tool: ToolShellKind;
    stage: ReactNode;
    hint?: ReactNode;
    dock?: ReactNode;
    children: ReactNode;
    config: AiConfig;
    /** 不传时不显示模型选择（反推提示词、宫格切分）。 */
    model?: string;
    onModelChange?: (model: string) => void;
    /** 不传时置灰不能收参考图的模型；重做按原参考图张数判断。 */
    modelDisabledReason?: (model: string) => string;
    footerNote?: ReactNode;
    secondaryAction?: ReactNode;
    submitLabel: string;
    canSubmit: boolean;
    submitting: boolean;
    error?: string;
    onSubmit: () => void;
    onClose: () => void;
    onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** 所有图片工具共用的弹窗外壳，版式与区域标注一致：左看图，右参数，底部模型和生成按钮。 */
function ToolShell(props: ToolShellProps) {
    const meta = toolMeta(props.tool);
    const close = () => {
        if (!props.submitting) props.onClose();
    };
    return (
        <AppModal open centered flush closable={false} footer={null} width="min(1240px, calc(100vw - 48px))" keyboard={!props.submitting} mask={{ closable: !props.submitting }} onCancel={close} aria-label={meta.title}>
            <div className="cit" onKeyDown={props.onKeyDown}>
                <section
                    className="cit-stage"
                    aria-label="图片"
                    tabIndex={-1}
                    onPointerDown={(event) => {
                        // 点看图区后让快捷键（撤销、调笔刷）落在弹窗里；可聚焦的子元素自己接管焦点。
                        if (!(event.target as HTMLElement).closest("button, input, textarea, [tabindex='0']")) event.currentTarget.focus({ preventScroll: true });
                    }}
                >
                    {props.hint ? <div className="cit-stage-hint">{props.hint}</div> : null}
                    <div className="cit-canvas">{props.stage}</div>
                    {props.dock ? (
                        <div className="cit-dock" role="toolbar" aria-label={`${meta.title}工具`}>
                            {props.dock}
                        </div>
                    ) : null}
                </section>
                <aside className="cit-panel">
                    <header className="cit-panel-header">
                        <span className="cit-panel-icon" aria-hidden="true">
                            <ToolIcon tool={props.tool} />
                        </span>
                        <div className="cit-panel-heading">
                            <h2>{meta.title}</h2>
                            <p>{meta.description}</p>
                        </div>
                        <button type="button" className="cit-close" aria-label="关闭" disabled={props.submitting} onClick={close}>
                            <X className="size-4" />
                        </button>
                    </header>
                    <div className="cit-body">{props.children}</div>
                    {props.error ? (
                        <p role="alert" className="cit-error">
                            {props.error}
                        </p>
                    ) : null}
                    <footer className="cit-footer">
                        {props.model !== undefined && props.onModelChange ? (
                            <ModelPicker
                                className="!h-9 !w-full !min-w-0 !justify-start !rounded-[var(--r-lg)] !text-[var(--fs-label)] !font-normal"
                                fullWidth
                                config={{ ...props.config, model: props.model, imageModel: props.model }}
                                value={props.model}
                                capability="image"
                                variant="creation"
                                showSelectedPrice={false}
                                showConfiguredModelName
                                modelDisabledReason={props.modelDisabledReason || ((candidate) => (editableModel(props.config, candidate) ? "" : "不支持参考图编辑"))}
                                onChange={props.onModelChange}
                            />
                        ) : null}
                        <div className="cit-footer-row">
                            {props.footerNote ? <span className="cit-footer-note">{props.footerNote}</span> : null}
                            <span className="cit-footer-spacer" />
                            {props.secondaryAction}
                            <Button className="cit-submit" type="primary" shape="round" icon={<ArrowUp className="size-4" strokeWidth={2.4} />} loading={props.submitting} disabled={!props.canSubmit} onClick={props.onSubmit}>
                                {props.submitLabel}
                            </Button>
                        </div>
                    </footer>
                </aside>
            </div>
        </AppModal>
    );
}

/** 图片读出来之前的占位弹窗；读失败时显示原因，用户自己关掉。 */
function ToolLoading({ tool, error, onClose }: { tool: CreationImageToolId; error: string; onClose: () => void }) {
    return (
        <AppModal open centered width={360} title={creationImageTools[tool].title} footer={null} onCancel={onClose}>
            <p className="cit-loading-modal" role={error ? "alert" : "status"}>
                {error || "正在读取图片…"}
            </p>
        </AppModal>
    );
}

function ToolField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
    return (
        <div className="cit-field">
            <div className="cit-label">
                {label}
                {hint ? <span className="cit-label-hint">{hint}</span> : null}
            </div>
            {children}
        </div>
    );
}

type ChoiceOption<V extends string | number> = { value: V; label: ReactNode; detail?: ReactNode; title?: string; disabled?: boolean };

/** 选项胶囊：单选和多选都用 aria-pressed 表示当前状态。 */
function ToolChoices<V extends string | number>({ label, options, isActive, onSelect, columns = 3 }: { label: string; options: ChoiceOption<V>[]; isActive: (value: V) => boolean; onSelect: (value: V) => void; columns?: number }) {
    return (
        <div className="cit-choices" role="group" aria-label={label} style={{ "--cit-columns": columns } as CSSProperties}>
            {options.map((option) => {
                const active = isActive(option.value);
                return (
                    <button key={String(option.value)} type="button" className="cit-choice" aria-pressed={active} data-active={active || undefined} title={option.title} disabled={option.disabled} onClick={() => onSelect(option.value)}>
                        <span className="cit-choice-label">{option.label}</span>
                        {option.detail ? <span className="cit-choice-detail">{option.detail}</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

function ToolTextarea({ label, value, onChange, placeholder, rows = 3, autoFocus, onSubmit }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; autoFocus?: boolean; onSubmit?: () => void }) {
    return (
        <textarea
            className="cit-textarea"
            aria-label={label}
            value={value}
            rows={rows}
            placeholder={placeholder}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    onSubmit?.();
                }
            }}
        />
    );
}

function ToolCount({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
    const options = [1, 2, 3, 4].filter((count) => count <= max);
    if (options.length < 2) return null;
    return (
        <ToolField label="生成数量">
            <ToolChoices label="生成数量" columns={4} options={options.map((count) => ({ value: count, label: `${count} 张` }))} isActive={(count) => count === Math.min(value, max)} onSelect={onChange} />
        </ToolField>
    );
}

function ToolDockButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <Tooltip title={title}>
            <button type="button" className="cit-dock-button" aria-label={title} aria-pressed={active} data-active={active || undefined} disabled={disabled} onClick={onClick}>
                {children}
            </button>
        </Tooltip>
    );
}

function ToolImage({ source, error, badge, children }: { source: CreationLoadedImage | null; error: string; badge?: ReactNode; children?: ReactNode }) {
    if (!source)
        return (
            <p className="cit-loading" role={error ? "alert" : "status"}>
                {error || "正在读取图片…"}
            </p>
        );
    return (
        <div className="cit-frame">
            <img src={source.dataUrl} alt="原图" draggable={false} />
            {children}
            {badge ? <span className="cit-frame-badge">{badge}</span> : null}
        </div>
    );
}

const sourceBadge = (source: CreationLoadedImage | null) => (source ? `原图 ${source.size.width} × ${source.size.height}` : undefined);

function UpscaleTool({ target, config, onClose, onGenerate }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, sizeProfile } = useToolModel(config);
    const options = useMemo(() => (source ? creationImageTierOptions(sizeProfile, source.size) : []), [sizeProfile, source]);
    const [tier, setTier] = useState("");
    const selected = options.find((option) => option.tier === tier) || options[options.length - 1];
    const [note, setNote] = useState("");
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const sourcePixels = source ? source.size.width * source.size.height : 0;
    const notLarger = Boolean(selected?.width && selected.height && selected.width * selected.height <= sourcePixels);
    const run = () => {
        if (!source) return;
        void submit(() => ({ tool: "upscale", model, prompt: creationUpscalePrompt(note), references: [{ kind: "source", size: source.size }], size: selected?.patch || {}, count: 1 }));
    };
    return (
        <ToolShell
            tool="upscale"
            stage={<ToolImage source={source} error={loadError} badge={sourceBadge(source)} />}
            config={config}
            model={model}
            onModelChange={setModel}
            submitLabel="生成高清图"
            canSubmit={Boolean(source && model)}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            <ToolField label="清晰度">
                {options.length ? (
                    <ToolChoices
                        label="清晰度"
                        columns={Math.min(4, options.length)}
                        options={options.map((option) => ({ value: option.tier, label: option.label, detail: option.width && option.height ? `${option.width}×${option.height}` : undefined }))}
                        isActive={(value) => value === selected?.tier}
                        onSelect={setTier}
                    />
                ) : (
                    <p className="cit-note">{source ? "这个模型不能单独选清晰度，按模型默认尺寸输出。" : "读取原图后显示可选清晰度。"}</p>
                )}
                {notLarger ? <p className="cit-note">所选档位不高于原图分辨率，效果以修复细节为主。</p> : null}
            </ToolField>
            <ToolField label="补充要求" hint="可选">
                <ToolTextarea label="补充要求" value={note} onChange={setNote} placeholder="例如：保留皮肤纹理，让文字更锐利" onSubmit={run} />
            </ToolField>
            <p className="cit-note">原图作为参考重新生成，构图和颜色保持不变；只想放大像素可用「更多 → 调整尺寸」。</p>
        </ToolShell>
    );
}

function ExpandTool({ target, config, savedSettings, onClose, onGenerate }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, profile, sizeProfile } = useToolModel(config);
    const [ratio, setRatio] = useState<string>("original");
    const [scale, setScale] = useState(1.5);
    const [offset, setOffset] = useState({ x: 0.5, y: 0.5 });
    const [note, setNote] = useState("");
    const [count, setCount] = useState(1);
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const plan = useMemo(() => (source ? planCreationExpand(source.size, { ratio, scale, offset }) : null), [offset, ratio, scale, source]);
    const maskSupported = Boolean(profile?.references.maskSupported);
    const maxOutputs = Math.min(4, profile?.maxOutputs || 1);
    const scales = CREATION_EXPAND_SCALES.filter((value) => value > 1 || ratio !== "original");
    const chooseRatio = (value: string) => {
        setRatio(value);
        setOffset({ x: 0.5, y: 0.5 });
        if (value === "original" && scale <= 1) setScale(1.5);
    };
    const run = () => {
        if (!source || !plan) return;
        void submit(async (): Promise<CreationImageToolRequest> => {
            const base = await renderCreationExpandBase(source.element, plan);
            return {
                tool: "expand",
                model,
                prompt: creationExpandPrompt(note, maskSupported),
                references: [{ kind: "upload", file: base.file, name: "扩图底图", size: { width: plan.width, height: plan.height } }],
                mask: maskSupported ? base.maskDataUrl : undefined,
                size: creationImageSettingsForSource(sizeProfile, plan, "current", savedSettings),
                count: Math.min(count, maxOutputs),
            };
        });
    };
    return (
        <ToolShell
            tool="expand"
            hint={
                <>
                    <Move className="size-3.5" aria-hidden="true" />
                    拖动原图调整它在新画面里的位置
                </>
            }
            stage={<ExpandStage source={source} error={loadError} plan={plan} onOffsetChange={setOffset} />}
            config={config}
            model={model}
            onModelChange={setModel}
            submitLabel="开始扩图"
            canSubmit={Boolean(source && plan && model && creationExpandAddsArea(plan))}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            <ToolField label="画幅">
                <ToolChoices label="画幅" columns={4} options={CREATION_EXPAND_RATIOS.map((value) => ({ value, label: value === "original" ? "原比例" : value }))} isActive={(value) => value === ratio} onSelect={chooseRatio} />
            </ToolField>
            <ToolField label="扩展倍数">
                <ToolChoices
                    label="扩展倍数"
                    columns={4}
                    options={scales.map((value) => ({ value, label: value === 1 ? "仅补齐" : `${value}×`, title: value === 1 ? "只补出画幅差出来的部分" : `画面整体扩大到原图的 ${value} 倍` }))}
                    isActive={(value) => value === scale}
                    onSelect={setScale}
                />
                {plan ? (
                    <p className="cit-note">
                        底图 {plan.width} × {plan.height}，原图约占 {Math.round(((plan.inner.width * plan.inner.height) / (plan.width * plan.height)) * 100)}%
                    </p>
                ) : null}
            </ToolField>
            <ToolField label="扩展区域描述" hint="可选">
                <ToolTextarea label="扩展区域描述" value={note} onChange={setNote} placeholder="例如：左右延伸成海边的沙滩和天空" onSubmit={run} />
            </ToolField>
            <ToolCount value={count} max={maxOutputs} onChange={setCount} />
            <p className="cit-note">{maskSupported ? "当前模型支持蒙版：原图部分保持不变，只补全四周。" : "当前模型不支持蒙版：四周用模糊底图示意，原图边缘可能有轻微变化。"}</p>
        </ToolShell>
    );
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

/** 扩图画框：虚线框是新画面，原图可以拖动或用方向键移动，四周是待补全区域。 */
function ExpandStage({ source, error, plan, onOffsetChange }: { source: CreationLoadedImage | null; error: string; plan: CreationExpandPlan | null; onOffsetChange: (offset: { x: number; y: number }) => void }) {
    const frameRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; origin: { x: number; y: number } } | null>(null);
    if (!source || !plan)
        return (
            <p className="cit-loading" role={error ? "alert" : "status"}>
                {error || "正在读取图片…"}
            </p>
        );
    const freeX = plan.width - plan.inner.width;
    const freeY = plan.height - plan.inner.height;
    const current = { x: freeX > 0 ? plan.inner.x / freeX : 0.5, y: freeY > 0 ? plan.inner.y / freeY : 0.5 };
    const percent = (value: number, total: number) => `${(value / total) * 100}%`;
    const move = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const frame = frameRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !frame) return;
        const rect = frame.getBoundingClientRect();
        const dx = ((event.clientX - drag.x) / Math.max(1, rect.width)) * plan.width;
        const dy = ((event.clientY - drag.y) / Math.max(1, rect.height)) * plan.height;
        onOffsetChange({ x: freeX > 0 ? clampUnit(drag.origin.x + dx / freeX) : 0.5, y: freeY > 0 ? clampUnit(drag.origin.y + dy / freeY) : 0.5 });
    };
    const finish = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    return (
        <div ref={frameRef} className="cit-expand-frame" style={{ "--cit-ratio": plan.width / plan.height } as CSSProperties}>
            <img className="cit-expand-fill" src={source.dataUrl} alt="" aria-hidden="true" draggable={false} />
            <div className="cit-expand-hatch" aria-hidden="true" />
            <div
                className="cit-expand-image"
                role="group"
                tabIndex={0}
                aria-label="原图位置，可以拖动或用方向键移动"
                style={{ left: percent(plan.inner.x, plan.width), top: percent(plan.inner.y, plan.height), width: percent(plan.inner.width, plan.width), height: percent(plan.inner.height, plan.height) }}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.focus({ preventScroll: true });
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: current };
                }}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={finish}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 0.1 : 0.02;
                    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
                    if (!delta) return;
                    event.preventDefault();
                    onOffsetChange({ x: freeX > 0 ? clampUnit(current.x + delta[0]) : 0.5, y: freeY > 0 ? clampUnit(current.y + delta[1]) : 0.5 });
                }}
            >
                <img src={source.dataUrl} alt="原图" draggable={false} />
            </div>
        </div>
    );
}

function MaskTool({ target, config, savedSettings, onClose, onGenerate, erase }: CreationImageToolDialogProps & { erase: boolean }) {
    const tool = erase ? "erase" : "inpaint";
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, profile, sizeProfile } = useToolModel(config);
    const [strokes, setStrokes] = useState<MaskStroke[]>([]);
    const [undone, setUndone] = useState<MaskStroke[]>([]);
    const [brushMode, setBrushMode] = useState<"paint" | "erase">("paint");
    const [brush, setBrush] = useState(40);
    const [prompt, setPrompt] = useState("");
    const [count, setCount] = useState(1);
    const { submitting, error, setError, submit } = useToolSubmit(onGenerate);
    const painted = strokes.some((stroke) => !stroke.erase);
    const maxImages = profile?.references.maxImages ?? 0;
    const maskSupported = Boolean(profile?.references.maskSupported);
    const maxOutputs = Math.min(4, profile?.maxOutputs || 1);
    const addStroke = (stroke: MaskStroke) => {
        setStrokes([...strokes, stroke]);
        setUndone([]);
        setError("");
    };
    const undo = () => {
        const last = strokes[strokes.length - 1];
        if (!last) return;
        setStrokes(strokes.slice(0, -1));
        setUndone([...undone, last]);
    };
    const redo = () => {
        const last = undone[undone.length - 1];
        if (!last) return;
        setUndone(undone.slice(0, -1));
        setStrokes([...strokes, last]);
    };
    const clear = () => {
        setStrokes([]);
        setUndone([]);
    };
    const run = () => {
        if (!source) return;
        void submit((): CreationImageToolRequest => {
            // 先导出蒙版：橡皮把涂抹全擦掉时会在这里报"请先涂抹需要修改的区域"。
            const mask = exportEditMask(source.size.width, source.size.height, strokes);
            const annotated = maxImages >= 2;
            const label = creationImageTools[tool].title;
            return {
                tool,
                model,
                prompt: creationInpaintPrompt({ prompt, erase, size: source.size, bounds: maskStrokeBounds(strokes, source.size), annotated, mask: maskSupported }),
                displayPrompt: erase ? "消除：去掉涂抹区域里的物体，用背景自然补全" : `局部重绘：${prompt.trim()}`,
                references: [
                    { kind: "source", size: source.size },
                    ...(annotated
                        ? [
                              {
                                  kind: "upload" as const,
                                  file: dataUrlToFile({ id: `${tool}-annotation`, name: `${label}标注.jpg`, type: "image/jpeg", dataUrl: renderMaskAnnotation(source.element, source.size, strokes, MASK_COLOR) }),
                                  name: `${label}标注`,
                                  size: source.size,
                              },
                          ]
                        : []),
                ],
                mask: maskSupported ? mask : undefined,
                size: creationImageSettingsForSource(sizeProfile, source.size, "current", savedSettings),
                count: erase ? 1 : Math.min(count, maxOutputs),
            };
        });
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [contenteditable='true']")) return;
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
        } else if (!mod && event.key === "[") setBrush((value) => Math.max(8, value - 6));
        else if (!mod && event.key === "]") setBrush((value) => Math.min(160, value + 6));
        else if (!mod && event.key.toLowerCase() === "b") setBrushMode("paint");
        else if (!mod && event.key.toLowerCase() === "e") setBrushMode("erase");
    };
    const referenceNote = maskSupported ? "当前模型支持蒙版，只会改动涂抹的区域。" : maxImages >= 2 ? "当前模型不支持蒙版，会附一张涂抹标注图帮助定位。" : "当前模型只收一张参考图，按涂抹位置的坐标定位，边缘可能略有变化。";
    return (
        <ToolShell
            tool={tool}
            hint={
                <>
                    <Brush className="size-3.5" aria-hidden="true" />
                    {erase ? "涂抹要去掉的物体，比物体略大一圈效果更干净" : "涂抹要修改的地方"} · <kbd>[</kbd> <kbd>]</kbd> 调笔刷
                </>
            }
            stage={<MaskStage source={source} error={loadError} strokes={strokes} brushMode={brushMode} brush={brush} onStroke={addStroke} />}
            dock={
                <>
                    <ToolDockButton title="画笔 B" active={brushMode === "paint"} onClick={() => setBrushMode("paint")}>
                        <Brush className="size-4" />
                    </ToolDockButton>
                    <ToolDockButton title="橡皮 E" active={brushMode === "erase"} onClick={() => setBrushMode("erase")}>
                        <Eraser className="size-4" />
                    </ToolDockButton>
                    <span aria-hidden="true" className="cit-dock-divider" />
                    <div className="cit-dock-size">
                        <span>笔刷</span>
                        <Slider min={8} max={160} value={brush} onChange={setBrush} tooltip={{ formatter: (value) => `${value}px` }} ariaLabelForHandle="笔刷大小" />
                    </div>
                    <span aria-hidden="true" className="cit-dock-divider" />
                    <ToolDockButton title="撤销 ⌘Z" disabled={!strokes.length} onClick={undo}>
                        <Undo2 className="size-4" />
                    </ToolDockButton>
                    <ToolDockButton title="重做 ⇧⌘Z" disabled={!undone.length} onClick={redo}>
                        <Redo2 className="size-4" />
                    </ToolDockButton>
                    <ToolDockButton title="清空涂抹" disabled={!strokes.length} onClick={clear}>
                        <RotateCcw className="size-4" />
                    </ToolDockButton>
                </>
            }
            config={config}
            model={model}
            onModelChange={setModel}
            submitLabel={erase ? "立即消除" : "生成"}
            canSubmit={Boolean(source && model && painted && (erase || prompt.trim()))}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
            onKeyDown={onKeyDown}
        >
            {erase ? (
                <p className="cit-lead">在左侧涂抹画面里不想要的物体、路人或文字，松手后点「立即消除」，模型会用周围的背景把那里补上。</p>
            ) : (
                <>
                    <ToolField label="修改要求">
                        <ToolTextarea label="修改要求" value={prompt} onChange={setPrompt} rows={4} autoFocus placeholder="例如：把衣服换成红色丝绸长裙" onSubmit={run} />
                    </ToolField>
                    <ToolCount value={count} max={maxOutputs} onChange={setCount} />
                </>
            )}
            <p className="cit-note">{painted ? referenceNote : "还没有涂抹区域。"}</p>
        </ToolShell>
    );
}

/** 涂抹层：笔画按原图像素记录，界面上半透明叠在图片上；导出的蒙版与笔画一一对应。 */
function MaskStage({ source, error, strokes, brushMode, brush, onStroke }: { source: CreationLoadedImage | null; error: string; strokes: MaskStroke[]; brushMode: "paint" | "erase"; brush: number; onStroke: (stroke: MaskStroke) => void }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);
    const drawingRef = useRef<{ pointerId: number; stroke: MaskStroke } | null>(null);
    useEffect(() => {
        if (canvasRef.current) paintMaskStrokes(canvasRef.current, strokes, MASK_COLOR);
    }, [source, strokes]);
    if (!source)
        return (
            <p className="cit-loading" role={error ? "alert" : "status"}>
                {error || "正在读取图片…"}
            </p>
        );
    const pointOf = (canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>): MaskPoint => {
        const rect = canvas.getBoundingClientRect();
        return [((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width, ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height];
    };
    const moveCursor = (event: PointerEvent<HTMLCanvasElement>) => {
        const cursor = cursorRef.current;
        if (!cursor) return;
        const rect = event.currentTarget.getBoundingClientRect();
        cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`;
        cursor.style.opacity = "1";
    };
    const finish = (event: PointerEvent<HTMLCanvasElement>) => {
        const drawing = drawingRef.current;
        if (!drawing || drawing.pointerId !== event.pointerId) return;
        drawingRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        onStroke(drawing.stroke);
    };
    return (
        <div className="cit-frame is-mask">
            <img src={source.dataUrl} alt="待修改的图片" draggable={false} />
            <canvas
                ref={canvasRef}
                width={source.size.width}
                height={source.size.height}
                className={`cit-mask${brushMode === "erase" ? " is-erase" : ""}`}
                aria-label="在图片上涂抹要修改的区域"
                onPointerDown={(event) => {
                    if (event.button !== 0 || drawingRef.current) return;
                    const canvas = event.currentTarget;
                    event.preventDefault();
                    canvas.setPointerCapture(event.pointerId);
                    const rect = canvas.getBoundingClientRect();
                    // 笔刷按屏幕像素调节，记录时换算成原图像素，缩放显示不影响涂抹粗细。
                    const stroke: MaskStroke = { diameter: Math.max(1, brush * (canvas.width / Math.max(1, rect.width))), erase: brushMode === "erase", points: [pointOf(canvas, event)] };
                    drawingRef.current = { pointerId: event.pointerId, stroke };
                    paintMaskStrokes(canvas, [...strokes, stroke], MASK_COLOR);
                }}
                onPointerMove={(event) => {
                    moveCursor(event);
                    const drawing = drawingRef.current;
                    if (!drawing || drawing.pointerId !== event.pointerId) return;
                    const canvas = event.currentTarget;
                    const point = pointOf(canvas, event);
                    const previous = drawing.stroke.points[drawing.stroke.points.length - 1];
                    drawing.stroke.points.push(point);
                    // 拖动中只补画新的一段；松手后由笔画列表整体重绘。
                    const context = canvas.getContext("2d");
                    if (!context) return;
                    context.globalCompositeOperation = drawing.stroke.erase ? "destination-out" : "source-over";
                    context.strokeStyle = MASK_COLOR;
                    context.lineWidth = drawing.stroke.diameter;
                    context.lineCap = "round";
                    context.lineJoin = "round";
                    context.beginPath();
                    context.moveTo(previous[0], previous[1]);
                    context.lineTo(point[0], point[1]);
                    context.stroke();
                    context.globalCompositeOperation = "source-over";
                }}
                onPointerUp={finish}
                onPointerCancel={finish}
                onPointerLeave={() => {
                    if (cursorRef.current) cursorRef.current.style.opacity = "0";
                }}
            />
            <div ref={cursorRef} className={`cit-brush-cursor${brushMode === "erase" ? " is-erase" : ""}`} style={{ width: brush, height: brush, marginLeft: -brush / 2, marginTop: -brush / 2 }} aria-hidden="true" />
        </div>
    );
}

function VariantTool({ target, config, savedSettings, onClose, onGenerate }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, profile, sizeProfile } = useToolModel(config);
    const [directions, setDirections] = useState<string[]>(["composition", "lighting"]);
    const [strength, setStrength] = useState<CreationVariantStrength>("bold");
    const [note, setNote] = useState("");
    const [count, setCount] = useState(1);
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const maxOutputs = Math.min(4, profile?.maxOutputs || 1);
    const toggle = (id: string) => setDirections((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    const run = () => {
        if (!source) return;
        void submit(() => ({
            tool: "variant",
            model,
            prompt: creationVariantPrompt(directions, strength, note),
            references: [{ kind: "source", size: source.size }],
            size: creationImageSettingsForSource(sizeProfile, source.size, "current", savedSettings),
            count: Math.min(count, maxOutputs),
        }));
    };
    return (
        <ToolShell
            tool="variant"
            stage={<ToolImage source={source} error={loadError} badge={sourceBadge(source)} />}
            config={config}
            model={model}
            onModelChange={setModel}
            submitLabel="生成变体"
            canSubmit={Boolean(source && model)}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            <ToolField label="变化方向" hint="可多选">
                <ToolChoices label="变化方向" columns={4} options={CREATION_VARIANT_DIRECTIONS.map((item) => ({ value: item.id, label: item.label }))} isActive={(value) => directions.includes(value)} onSelect={toggle} />
            </ToolField>
            <ToolField label="变化幅度">
                <ToolChoices<CreationVariantStrength>
                    label="变化幅度"
                    columns={2}
                    options={[
                        { value: "subtle", label: "轻微", detail: "接近原图" },
                        { value: "bold", label: "明显", detail: "换一种表现" },
                    ]}
                    isActive={(value) => value === strength}
                    onSelect={setStrength}
                />
            </ToolField>
            <ToolField label="补充要求" hint="可选">
                <ToolTextarea label="补充要求" value={note} onChange={setNote} placeholder="例如：换成雨夜街头，人物穿深色风衣" onSubmit={run} />
            </ToolField>
            <ToolCount value={count} max={maxOutputs} onChange={setCount} />
        </ToolShell>
    );
}

/** 去除背景，以及由后端提示词工具驱动的宫格、三视图、光影校正和画面推演。 */
function PresetTool({ target, config, savedSettings, onClose, onGenerate }: CreationImageToolDialogProps) {
    const tool = target.tool;
    const meta = creationImageTools[tool];
    const preset = creationImagePresetTools[tool];
    const removeBackground = tool === "removeBackground";
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, profile, sizeProfile } = useToolModel(config);
    const transparent = Boolean(profile?.transparentBackground.supported);
    // 没改过要求时跟着模型是否支持透明背景切换默认文案。
    const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
    const prompt = editedPrompt ?? removeBackgroundPrompt(transparent);
    const [note, setNote] = useState("");
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const outputSize = preset && preset.ratio !== "original" ? creationRatioSize(preset.ratio) : source?.size;
    const run = () => {
        if (!source || (!removeBackground && !preset)) return;
        const extra = note.trim();
        void submit(() => ({
            tool,
            model,
            prompt: removeBackground || !preset ? prompt.trim() : `${canvasToolMentionToken(preset.toolId, preset.label, "nine_grid", preset.iconName)}${extra ? `\n补充要求：${extra}` : ""}`,
            // 工具标签由后端展开成完整提示词；对话里只显示工具名和补充要求。
            displayPrompt: removeBackground ? undefined : extra ? `${meta.title}：${extra}` : meta.title,
            references: [{ kind: "source", size: source.size }],
            size: outputSize ? creationImageSettingsForSource(sizeProfile, outputSize, "current", savedSettings) : {},
            count: 1,
            transparentBackground: removeBackground && transparent ? true : undefined,
        }));
    };
    return (
        <ToolShell
            tool={tool}
            stage={<ToolImage source={source} error={loadError} badge={sourceBadge(source)} />}
            config={config}
            model={model}
            onModelChange={setModel}
            submitLabel={removeBackground ? "去除背景" : "开始生成"}
            canSubmit={Boolean(source && model && (!removeBackground || prompt.trim()))}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            {removeBackground ? (
                <>
                    <ToolField label="要求">
                        <ToolTextarea label="去除背景要求" value={prompt} onChange={setEditedPrompt} rows={4} onSubmit={run} />
                    </ToolField>
                    <p className="cit-note">{transparent ? "当前模型支持透明背景，会输出透明底图片。" : "当前模型不支持透明背景，会换成纯白背景；需要透明底请换支持透明背景的模型。"}</p>
                </>
            ) : (
                <>
                    <p className="cit-lead">{meta.description}。原图作为参考，提示词由平台内置的同名工具提供，和画布上的效果一致。</p>
                    <p className="cit-note">输出画幅：{preset?.ratio === "original" ? "沿用原图比例" : preset?.ratio}</p>
                    <ToolField label="补充要求" hint="可选">
                        <ToolTextarea label="补充要求" value={note} onChange={setNote} placeholder="例如：保持人物服装不变" onSubmit={run} />
                    </ToolField>
                </>
            )}
        </ToolShell>
    );
}

function TextEditTool({ target, config, savedSettings, onClose, onGenerate, onDescribe }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { model, setModel, sizeProfile } = useToolModel(config);
    const detection = useAutoTask(async (signal) => parseCreationTextLines(await onDescribe(CREATION_TEXT_DETECTION_PROMPT, "text-detection", signal)));
    const [lines, setLines] = useState<CreationTextLine[]>([]);
    useEffect(() => {
        if (detection.value) setLines(detection.value);
    }, [detection.value]);
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const changed = lines.filter((line) => line.text.trim() && line.text !== line.original);
    const run = () => {
        if (!source || !changed.length) return;
        void submit(() => ({
            tool: "textEdit",
            model,
            prompt: buildCanvasTextEditPrompt(lines),
            displayPrompt: `文字编辑：${changed.map((line) => `“${line.original}”改为“${line.text.trim()}”`).join("；")}`,
            references: [{ kind: "source", size: source.size }],
            size: creationImageSettingsForSource(sizeProfile, source.size, "current", savedSettings),
            count: 1,
        }));
    };
    return (
        <ToolShell
            tool="textEdit"
            stage={<ToolImage source={source} error={loadError} />}
            config={config}
            model={model}
            onModelChange={setModel}
            footerNote={config.textModel ? `识图：${modelDisplayName(config, config.textModel)}` : undefined}
            submitLabel="生成修改结果"
            canSubmit={Boolean(source && model && changed.length && !detection.loading)}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            <ToolField
                label="识别到的文字"
                hint={
                    <button type="button" className="cit-link-button" disabled={detection.loading} onClick={detection.run}>
                        <RefreshCw className="size-3" aria-hidden="true" />
                        重新识别
                    </button>
                }
            >
                {detection.loading ? (
                    <div className="cit-note cit-note-row" role="status">
                        <Spin size="small" /> 正在识别图片文字…
                    </div>
                ) : detection.error ? (
                    <p className="cit-note is-error" role="alert">
                        {detection.error}
                    </p>
                ) : (
                    <div className="cit-lines">
                        {lines.map((line, index) => (
                            <label key={`${line.original}-${index}`} className="cit-line">
                                <span className="cit-line-meta">
                                    第 {index + 1} 处 · {line.location} · 原文：{line.original}
                                </span>
                                <input
                                    className="cit-input"
                                    value={line.text}
                                    placeholder={line.original}
                                    onChange={(event) => setLines((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, text: event.target.value } : item)))}
                                />
                            </label>
                        ))}
                    </div>
                )}
            </ToolField>
            <p className="cit-note">只改你动过的那几处，字体、字号、颜色和排版保持原样。</p>
        </ToolShell>
    );
}

function ReversePromptTool({ target, config, onClose, onDescribe, onFillPrompt }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const copyText = useCopyText();
    const description = useAutoTask((signal) => onDescribe(IMAGE_PROMPT_REVERSE, "reverse-prompt", signal));
    const [text, setText] = useState("");
    useEffect(() => {
        if (description.value) setText(description.value);
    }, [description.value]);
    return (
        <ToolShell
            tool="reversePrompt"
            stage={<ToolImage source={source} error={loadError} />}
            config={config}
            footerNote={config.textModel ? `识图：${modelDisplayName(config, config.textModel)}` : undefined}
            secondaryAction={
                <Button shape="round" icon={<Copy className="size-4" />} disabled={!text.trim()} onClick={() => copyText(text.trim())}>
                    复制
                </Button>
            }
            submitLabel="填入输入框"
            canSubmit={Boolean(text.trim()) && !description.loading}
            submitting={false}
            onSubmit={() => onFillPrompt(text.trim())}
            onClose={onClose}
        >
            <ToolField
                label="提示词"
                hint={
                    <button type="button" className="cit-link-button" disabled={description.loading} onClick={description.run}>
                        <RefreshCw className="size-3" aria-hidden="true" />
                        重新反推
                    </button>
                }
            >
                {description.loading && !text ? (
                    <div className="cit-note cit-note-row" role="status">
                        <Spin size="small" /> 正在看图写提示词…
                    </div>
                ) : (
                    <ToolTextarea label="反推出的提示词" value={text} onChange={setText} rows={12} />
                )}
                {description.error ? (
                    <p className="cit-note is-error" role="alert">
                        {description.error}
                    </p>
                ) : null}
            </ToolField>
            <p className="cit-note">可以先改再填入；填入会替换输入框里已有的文字。</p>
        </ToolShell>
    );
}

function SplitTool({ target, config, onClose, onUseImages }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { message } = App.useApp();
    const mounted = useMountedRef();
    const [rows, setRows] = useState(3);
    const [columns, setColumns] = useState(3);
    const [busy, setBusy] = useState<"" | "download" | "use">("");
    const [error, setError] = useState("");
    const valid = isValidGridSplit({ rows, columns });
    const pieces = async () => {
        if (!source) throw new Error("图片还没有读取完成");
        const split = await splitDataUrl(source.dataUrl, { rows, columns });
        return split.map((piece) => dataUrlToFile({ id: `split-${piece.row}-${piece.column}`, name: `宫格-${piece.row + 1}-${piece.column + 1}.png`, type: "image/png", dataUrl: piece.dataUrl }));
    };
    const act = async (kind: "download" | "use") => {
        if (busy || !valid) return;
        setBusy(kind);
        setError("");
        try {
            const files = await pieces();
            if (kind === "use") {
                await onUseImages(files, "宫格");
                return;
            }
            saveAs(await createZip(files.map((file) => ({ name: file.name, data: file }))), `宫格切分-${rows}x${columns}.zip`);
            message.success(`已打包下载 ${files.length} 张图片`);
        } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : "切分失败，请重试");
        } finally {
            if (mounted.current) setBusy("");
        }
    };
    const sizes = Array.from({ length: CANVAS_GRID_SPLIT_MAX }, (_, index) => index + 1);
    return (
        <ToolShell
            tool="split"
            stage={
                <ToolImage source={source} error={loadError}>
                    <div className="cit-grid-overlay" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }} aria-hidden="true">
                        {Array.from({ length: rows * columns }, (_, index) => (
                            <span key={index} />
                        ))}
                    </div>
                </ToolImage>
            }
            config={config}
            secondaryAction={
                <Button shape="round" icon={<Download className="size-4" />} loading={busy === "download"} disabled={!source || !valid || Boolean(busy)} onClick={() => void act("download")}>
                    下载全部
                </Button>
            }
            submitLabel="放入输入框"
            canSubmit={Boolean(source && valid) && busy !== "download"}
            submitting={busy === "use"}
            error={error}
            onSubmit={() => void act("use")}
            onClose={onClose}
        >
            <ToolField label="常用宫格">
                <ToolChoices
                    label="常用宫格"
                    columns={2}
                    options={CANVAS_GRID_SPLIT_PRESETS.map((preset) => ({ value: `${preset.rows}x${preset.columns}`, label: preset.label }))}
                    isActive={(value) => value === `${rows}x${columns}`}
                    onSelect={(value) => {
                        const [nextRows, nextColumns] = value.split("x").map(Number);
                        setRows(nextRows);
                        setColumns(nextColumns);
                    }}
                />
            </ToolField>
            <ToolField label="行数">
                <ToolChoices label="行数" columns={5} options={sizes.map((value) => ({ value, label: String(value) }))} isActive={(value) => value === rows} onSelect={setRows} />
            </ToolField>
            <ToolField label="列数">
                <ToolChoices label="列数" columns={5} options={sizes.map((value) => ({ value, label: String(value) }))} isActive={(value) => value === columns} onSelect={setColumns} />
            </ToolField>
            <p className="cit-note">{valid ? `切成 ${rows * columns} 张，按从左到右、从上到下编号；放入输入框时超出模型参考图上限的部分不会加入。` : "至少要切成 2 张。"}</p>
        </ToolShell>
    );
}

/** 区域标注直接用画布的弹窗；尺寸按原图比例取输入框当前档位。 */
function RegionTool({ target, config, savedSettings, onClose, onGenerate }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { message } = App.useApp();
    const submitting = useRef(false);
    const model = useMemo(() => initialToolModel(config), [config]);
    const dialogConfig = useMemo(() => {
        const size = source ? creationImageSettingsForSource(mergedImageCapabilityConfig(config, model), source.size, "current", savedSettings).ratio : undefined;
        return { ...config, model, imageModel: model, ...(size || savedSettings.ratio ? { size: size || savedSettings.ratio } : {}), ...(savedSettings.quality ? { quality: savedSettings.quality } : {}), count: "1" };
    }, [config, model, savedSettings, source]);
    if (!source && !loadError) return <ToolLoading tool="region" error="" onClose={onClose} />;
    const confirm = async (payload: CanvasImageRegionEditPayload) => {
        if (submitting.current) return;
        const selected = payload.generationConfig?.imageModel || payload.generationConfig?.model || model;
        const profile = modelCapabilityConfigFor(config, selected).image;
        const maxImages = profile?.references.maxImages ?? 0;
        if (!payload.regions.length) return void message.warning("请先框选需要修改的区域");
        if (maxImages < 1) return void message.error("当前图片模型不支持参考图编辑，请换一个支持图片编辑的模型");
        // 能收两张参考图时附带编号标注图；支持蒙版时再用蒙版锁住框外像素。坐标始终写进提示词，单图模型也能定位。
        const annotated = maxImages >= 2;
        const useMask = Boolean(profile?.references.maskSupported);
        submitting.current = true;
        try {
            await onGenerate({
                tool: "region",
                model: selected,
                prompt: buildRegionEditPrompt({ prompt: payload.prompt, regions: payload.regions, size: payload.size, annotatedReference: annotated, mask: useMask }),
                displayPrompt: regionEditDisplayPrompt(payload.prompt),
                references: [
                    { kind: "source", size: payload.size },
                    ...(annotated ? [{ kind: "upload" as const, file: dataUrlToFile({ id: "region-annotated", name: "局部修改标注.jpg", type: "image/jpeg", dataUrl: payload.annotatedDataUrl }), name: "局部修改标注", size: payload.size }] : []),
                ],
                mask: useMask ? payload.maskDataUrl : undefined,
                size: { ratio: payload.generationConfig?.size, quality: payload.generationConfig?.quality },
                count: Math.max(1, Math.floor(Number(payload.generationConfig?.count) || 1)),
            });
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "局部修改提交失败，请重试");
        } finally {
            submitting.current = false;
        }
    };
    return <CanvasNodeRegionEditDialog open image={{ url: target.url, storageKey: target.image.storageKey }} config={dialogConfig} onClose={onClose} onConfirm={(payload) => void confirm(payload)} />;
}

/** 打光和多角度直接用画布的面板：面板里确认后用默认图片模型生成，尺寸按原图比例取当前档位。 */
function PanelTool({ target, config, savedSettings, onClose, onGenerate }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { message } = App.useApp();
    const submitting = useRef(false);
    const model = useMemo(() => initialToolModel(config), [config]);
    if (!source) return <ToolLoading tool={target.tool} error={loadError} onClose={onClose} />;
    const generate = async (prompt: string, displayPrompt: string) => {
        if (submitting.current) return;
        submitting.current = true;
        try {
            await onGenerate({
                tool: target.tool,
                model,
                prompt,
                displayPrompt,
                references: [{ kind: "source", size: source.size }],
                size: creationImageSettingsForSource(mergedImageCapabilityConfig(config, model), source.size, "current", savedSettings),
                count: 1,
            });
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : "提交失败，请重试");
        } finally {
            submitting.current = false;
        }
    };
    if (target.tool === "angle")
        return (
            <AppModal flush open centered title={null} closable={false} footer={null} width={640} onCancel={onClose} aria-label="多角度">
                <CanvasNodeAnglePanel dataUrl={source.dataUrl} onClose={onClose} onConfirm={(params) => void generate(buildAnglePrompt(params), buildAngleLabel(params))} />
            </AppModal>
        );
    return (
        <AppModal flush open centered title={null} closable={false} footer={null} width={720} onCancel={onClose} aria-label="打光">
            <CanvasNodeLightingPanel dataUrl={source.dataUrl} onClose={onClose} onConfirm={(options, prompt) => void generate(prompt, buildLightingLabel(options))} />
        </AppModal>
    );
}

/** 裁剪不调用模型：裁好后放进输入框作为参考。 */
function CropTool({ target, onClose, onUseImages }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { message } = App.useApp();
    const mounted = useMountedRef();
    const [busy, setBusy] = useState(false);
    if (!source) return <ToolLoading tool="crop" error={loadError} onClose={onClose} />;
    return (
        <ImageCropDialog
            open
            dataUrl={source.dataUrl}
            title="裁剪"
            confirmLoading={busy}
            onClose={onClose}
            onConfirm={async (rect) => {
                setBusy(true);
                try {
                    const dataUrl = await cropDataUrl(source.dataUrl, rect);
                    await onUseImages([dataUrlToFile({ id: "crop", name: "裁剪图.png", type: "image/png", dataUrl })], "裁剪图");
                } catch (failure) {
                    message.error(failure instanceof Error ? `裁剪失败：${failure.message}` : "裁剪失败，请重试");
                } finally {
                    if (mounted.current) setBusy(false);
                }
            }}
        />
    );
}

/** 调整尺寸是插值放大，不调用模型：放大后直接下载 PNG。 */
function ResizeTool({ target, onClose }: CreationImageToolDialogProps) {
    const { source, error: loadError } = useToolSource(target);
    const { message } = App.useApp();
    if (!source) return <ToolLoading tool="resize" error={loadError} onClose={onClose} />;
    return (
        <CanvasNodeUpscaleDialog
            open
            dataUrl={source.dataUrl}
            description="插值放大后下载 PNG，原图保留。此操作不生成新的真实细节，需要更清晰的细节请用「高清」。"
            okText="下载放大图"
            onClose={onClose}
            onConfirm={async (params) => {
                try {
                    const dataUrl = await upscaleDataUrl(source.dataUrl, params);
                    saveAs(dataUrlToFile({ id: "resize", name: `放大-${params.targetLongEdge}.png`, type: "image/png", dataUrl }), `放大-${params.targetLongEdge}.png`);
                    message.success("已下载放大后的图片");
                    onClose();
                } catch (failure) {
                    message.error(failure instanceof Error ? `放大失败：${failure.message}` : "放大失败，请重试");
                }
            }}
        />
    );
}

export type CreationImageRedoTarget = { image: CreationResultImageRef; url: string; source: CreationImageRedoSource };

export type CreationImageRedoDialogProps = {
    target: CreationImageRedoTarget;
    config: AiConfig;
    onClose: () => void;
    /** 提交生成；成功后由创作页关闭弹窗，失败时抛出可以直接展示的错误。 */
    onGenerate: (request: CreationImageRedoRequest) => Promise<void>;
};

/** 重做的积分：系统模型先按路由报价，拿不到时按价目表算；个人渠道和关闭积分时不显示。 */
function useRedoCredits(config: AiConfig, model: string, settings: CreationImageRedoSettings, count: number, referenceCount: number) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const requirements = useMemo(() => creationImageRedoRequirements(config, model, settings, count, referenceCount), [config, count, model, referenceCount, settings]);
    const routed = useMemo(() => (model ? resolveCompatibleModel(config, model, requirements) || model : ""), [config, model, requirements]);
    const quoteRequest = useMemo(() => (creditsEnabled && routed ? modelQuoteRequest(config, routed, "image", requirements) : undefined), [config, creditsEnabled, requirements, routed]);
    const [quote, setQuote] = useState<LogicalModelQuote | null>(null);
    useEffect(() => {
        setQuote(null);
        if (!quoteRequest) return;
        const controller = new AbortController();
        quoteModel(quoteRequest, controller.signal).then(
            ({ quote: next }) => {
                if (!controller.signal.aborted) setQuote(next);
            },
            () => undefined,
        );
        return () => controller.abort();
    }, [quoteRequest]);
    if (!creditsEnabled || !routed) return null;
    if (quote) return { amount: quote.amountMicrocredits / 1_000_000, estimated: Boolean(quote.estimated), title: modelQuoteDescription(quote) };
    const channel = resolveModelChannel(config, routed);
    const amount = requestCreditCost({
        channelMode: channel.scope === "system" ? "remote" : "local",
        modelCosts: channel.modelCosts,
        model: modelOptionName(routed),
        count,
        seconds: 1,
        capability: "image",
        config: { ...config, model: routed, imageModel: routed },
        requirements,
    });
    return typeof amount === "number" ? { amount, estimated: false, title: undefined } : null;
}

/**
 * 结果图下方的「重做」：沿用这张图的提示词和参考图，模型、尺寸、张数默认取它当初的设置，都可以改。
 * 原模型不可用或收不下这些参考图时换成能用的模型并说明；原尺寸在所选模型上不可选时，按比例或这张图的实际像素换到最接近的一项。
 * 确认后按图片生成提交，结果作为新的一组消息接在对话末尾，原图保留。
 */
export function CreationImageRedoDialog({ target, config, onClose, onGenerate }: CreationImageRedoDialogProps) {
    const redo = target.source;
    const { source: loaded, error: loadError } = useToolSource(target);
    const referenceCount = redo.attachments.length;
    // 弹窗按结果设了 key，来源和初始模型在同一个实例里不会变，只算一次。
    const [initial] = useState(() => {
        const choice = creationImageRedoModel(config, redo);
        return { ...choice, size: creationImageRedoSettings(config, choice.model, redo.settings) };
    });
    const originalPrompt = useMemo(() => creationImageRedoVisiblePrompt(redo), [redo]);
    const [prompt, setPrompt] = useState(originalPrompt);
    const [model, setModel] = useState(initial.model);
    const [modelNote, setModelNote] = useState(initial.note || "");
    const [size, setSize] = useState(initial.size);
    const sizeTouched = useRef(false);
    const [count, setCount] = useState(redo.count);
    const { submitting, error, submit } = useToolSubmit(onGenerate);
    const profile = useMemo(() => modelCapabilityConfigFor(config, model).image, [config, model]);
    const sizeProfile = useMemo(() => mergedImageCapabilityConfig(config, model), [config, model]);
    const maxOutputs = Math.min(4, profile?.maxOutputs || 1);
    const requestCount = Math.max(1, Math.min(count, maxOutputs));
    const modelIssue = model ? creationImageRedoModelIssue(config, model, referenceCount) : "";
    const credits = useRedoCredits(config, model, size.settings, requestCount, referenceCount);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    // 原尺寸在这个模型上不可选、也没有比例可参考时，等图片读出来按实际像素换一次；用户已经选过就不动。
    useEffect(() => {
        if (!loaded || size.fitted || sizeTouched.current) return;
        setSize(creationImageRedoSettings(config, model, redo.settings, loaded.size));
    }, [config, loaded, model, redo.settings, size.fitted]);
    const changeModel = (next: string) => {
        setModel(next);
        setModelNote("");
        // 没动过尺寸时按原图的尺寸换算到新模型，动过就按当前选择换算。
        setSize((current) => creationImageRedoSettings(config, next, sizeTouched.current ? current.settings : redo.settings, loaded?.size));
    };
    const updateSize = (patch: Partial<CreationImageRedoSettings>) => {
        sizeTouched.current = true;
        setSize((current) => ({ settings: { ...current.settings, ...patch }, fitted: true }));
    };
    const sizeReady = size.fitted || Boolean(loaded) || Boolean(loadError);
    const canSubmit = Boolean(model && prompt.trim() && !modelIssue && sizeReady);
    const run = () => {
        if (!canSubmit) return;
        void submit(() => ({ model, ...creationImageRedoPrompt(redo, prompt), attachments: redo.attachments, settings: size.settings, count: requestCount }));
    };
    const sizeControl = !sizeReady ? (
        <p className="cit-note" role="status">
            正在读取原图尺寸…
        </p>
    ) : profile?.parameters ? (
        <ImageParameterFields
            profile={profile}
            config={{
                ...config,
                model,
                imageModel: model,
                size: size.settings.ratio,
                quality: size.settings.quality,
                imageResolution: size.settings.imageResolution,
                imageParameters: size.settings.imageParameters,
                transparentBackground: size.settings.transparentBackground,
                count: String(requestCount),
            }}
            showCount={false}
            showTransparent={false}
            onChange={(key, value) => {
                if (key === "count") setCount(Math.max(1, Math.floor(Number(value) || 1)));
                else if (key === "size") updateSize({ ratio: value });
                else updateSize({ [key]: value } as Partial<CreationImageRedoSettings>);
            }}
        />
    ) : sizeProfile.size.parameter === "none" && !sizeProfile.resolution.supported ? (
        <p className="cit-note">这个模型不能选尺寸，按模型默认尺寸输出。</p>
    ) : (
        <ImageSizePicker
            profile={sizeProfile}
            size={size.settings.ratio}
            quality={size.settings.quality}
            imageResolution={size.settings.imageResolution}
            onChange={(ratio, quality, imageResolution) => updateSize({ ratio, ...(quality ? { quality } : {}), ...(imageResolution ? { imageResolution } : {}) })}
        />
    );
    return (
        <ToolShell
            tool="redo"
            stage={<ToolImage source={loaded} error={loadError} badge={sourceBadge(loaded)} />}
            config={config}
            model={model}
            onModelChange={changeModel}
            modelDisabledReason={(candidate) => creationImageRedoModelIssue(config, candidate, referenceCount)}
            footerNote={
                credits ? (
                    <span title={credits.title}>
                        <CreditSymbol aria-hidden="true" /> {credits.estimated ? "预估" : "消耗"} {credits.amount.toLocaleString("zh-CN", { maximumFractionDigits: 4 })} 积分
                    </span>
                ) : undefined
            }
            submitLabel="重新生成"
            canSubmit={canSubmit}
            submitting={submitting}
            error={error}
            onSubmit={run}
            onClose={onClose}
        >
            <ToolField
                label="提示词"
                hint={
                    prompt !== originalPrompt ? (
                        <button type="button" className="cit-link-button" onClick={() => setPrompt(originalPrompt)}>
                            <RotateCcw className="size-3" aria-hidden="true" />
                            恢复原提示词
                        </button>
                    ) : undefined
                }
            >
                <ToolTextarea label="提示词" value={prompt} onChange={setPrompt} rows={6} placeholder="描述想要的画面" onSubmit={run} />
            </ToolField>
            {referenceCount ? (
                <ToolField label="参考图" hint={`${referenceCount} 张，和原图一样带上`}>
                    <div className="cit-redo-references">
                        {redo.attachments.map((attachment, index) => (
                            <span key={attachment.id} className="cit-redo-reference" title={attachment.name || `参考图 ${index + 1}`}>
                                <CachedResourceImage
                                    storageKey={attachment.storageKey}
                                    src={resolveResourceUrl(attachment.storageKey, attachment.previewUrl || attachment.url || "")}
                                    alt={attachment.name || `参考图 ${index + 1}`}
                                    loading="lazy"
                                    decoding="async"
                                    draggable={false}
                                />
                            </span>
                        ))}
                    </div>
                </ToolField>
            ) : null}
            <ToolField label="尺寸">{sizeControl}</ToolField>
            <ToolCount value={requestCount} max={maxOutputs} onChange={setCount} />
            {modelIssue ? (
                <p className="cit-note is-error" role="alert">
                    当前模型{modelIssue}，这张图用了 {referenceCount} 张参考图，请换一个模型。
                </p>
            ) : modelNote ? (
                <p className="cit-note">{modelNote}</p>
            ) : null}
            <p className="cit-note">{creditsEnabled ? "重做是一次新的生成，会再扣一次积分；" : "重做是一次新的生成；"}结果接在对话末尾，原图保留。</p>
        </ToolShell>
    );
}
