import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, Input, Segmented, Tag } from "antd";
import { Layers3, Plus, RotateCcw, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { modelCompatibilityError } from "@/lib/model-selection";
import { imageLayerOutputSize, imageLayerPlannerError, imageLayerPlanTargets, type ImageLayerPlan } from "@/lib/canvas/canvas-image-layer-plan";
import { parseExperimentalLayerTargets, supportsExperimentalLayerExtraction, supportsLayerDecomposition } from "@/lib/canvas/canvas-image-layers";
import { AppModal } from "@/components/ui/product/app-modal";
import { navigateToSettings } from "@/lib/settings-navigation";

export type CanvasImageLayerDecompositionPayload = {
    prompt: string;
    regions?: Array<[number, number, number, number]>;
    experimentalTargets?: string[];
    removeFromBackground?: boolean[];
    backgroundRemovalModel?: string;
    planning?: Pick<ImageLayerPlan, "model" | "taskId">;
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality">>;
};

const DEFAULT_PROMPT = "根据画面结构拆分适合独立编辑的主要对象、图形或文字；完整底图只移除需独立编辑的内容并补全遮挡，保留其他场景或设计结构，保持原图外观、画布比例和原始坐标。";

export function CanvasNodeLayerDecompositionDialog({
    dataUrl,
    open,
    config,
    sourceSize,
    onPlan,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    config: AiConfig;
    sourceSize?: { width: number; height: number };
    onPlan: (model: string, prompt: string, signal: AbortSignal) => Promise<ImageLayerPlan>;
    onClose: () => void;
    onConfirm: (payload: CanvasImageLayerDecompositionPayload) => void;
}) {
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const [regions, setRegions] = useState<Array<[number, number, number, number]>>([]);
    const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
    const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
    const [experimental, setExperimental] = useState(false);
    const [targetText, setTargetText] = useState("");
    const [detailMode, setDetailMode] = useState(false);
    const [backgroundRemovals, setBackgroundRemovals] = useState<boolean[]>([]);
    const [plannerModel, setPlannerModel] = useState("");
    const [usePlanner, setUsePlanner] = useState(true);
    const [plan, setPlan] = useState<ImageLayerPlan>();
    const [planning, setPlanning] = useState(false);
    const [planningError, setPlanningError] = useState("");
    const [removeBackground, setRemoveBackground] = useState(true);
    const [removalModel, setRemovalModel] = useState("");
    const planningRequest = useRef<AbortController | null>(null);
    const imageFrameRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);
    configRef.current = config;

    useEffect(() => {
        if (!open) return;
        setPrompt(DEFAULT_PROMPT);
        const current = configRef.current;
        const models = [current.imageModel, current.model, ...selectableModelsByCapability(current, "image")];
        const model = models.find((value) => supportsLayerDecomposition(current, value || "")) || models.find((value) => supportsExperimentalLayerExtraction(current, value || "")) || "";
        setGenerationConfig({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model), size: imageLayerOutputSize(current, model, sourceSize) });
        setRegions([]);
        setDrawing(null);
        setDraft(null);
        setExperimental(!supportsLayerDecomposition(current, model));
        setTargetText("");
        setDetailMode(false);
        setBackgroundRemovals([]);
        setPlannerModel(current.textModel || selectableModelsByCapability(current, "text")[0] || "");
        setUsePlanner(true);
        setPlan(undefined);
        setPlanning(false);
        setPlanningError("");
        setRemoveBackground(true);
        setRemovalModel(models.find((value) => supportsExperimentalLayerExtraction(current, value || "") && !supportsLayerDecomposition(current, value || "")) || "");
        return () => { planningRequest.current?.abort(); planningRequest.current = null; };
    }, [dataUrl, open]);

    const selectedModel = generationConfig.imageModel || generationConfig.model;
    const dedicated = supportsLayerDecomposition(config, selectedModel);
    const supported = dedicated || (experimental && supportsExperimentalLayerExtraction(config, selectedModel));
    const outputSizeError = generationConfig.size ? "" : "所选模型没有支持原图比例的尺寸，或源图尺寸尚未读取；请更换模型或重新打开图片";
    const plannerError = usePlanner && plannerModel ? imageLayerPlannerError(config, plannerModel) : "";
    const removalError = experimental && !dedicated && removeBackground
        ? !removalModel || !supportsExperimentalLayerExtraction(config, removalModel) ? "请选择可接收图片的去背景模型" : !imageLayerOutputSize(config, removalModel, sourceSize) ? "去背景模型没有支持原图比例的尺寸" : modelCompatibilityError(config, removalModel, { capability: "image", imageSize: imageLayerOutputSize(config, removalModel, sourceSize) })
        : "";
    let experimentalTargets: string[] | undefined;
    let targetError = "";
    if (experimental && !dedicated) {
        try {
            experimentalTargets = parseExperimentalLayerTargets(targetText);
        } catch (error) {
            targetError = targetText.trim() ? error instanceof Error ? error.message : "拆层目标无效" : "";
        }
    }

    const point = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = imageFrameRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000)),
            y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000)),
        };
    };

    const startBox = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const next = point(event);
        if (!next) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrawing(next);
        setDraft([next.x, next.y, next.x, next.y]);
    };

    const moveBox = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!drawing) return;
        const next = point(event);
        if (!next) return;
        setDraft([Math.min(drawing.x, next.x), Math.min(drawing.y, next.y), Math.max(drawing.x, next.x), Math.max(drawing.y, next.y)]);
    };

    const finishBox = () => {
        if (!draft) return;
        const [x1, y1, x2, y2] = draft;
        if (x2 - x1 >= 2 && y2 - y1 >= 2) { setRegions((current) => [...current, [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]]); invalidatePlan(); }
        setDrawing(null);
        setDraft(null);
    };

    const scopePrompt = `${prompt.trim()}\n${detailMode ? "详细拆分：按内容增加适合独立编辑的文字或细节；备用细节可保留在底图，另提取素材。" : "自动拆分：根据实际图像结构选择必要图层，不固定题材或层数；保留完整底图，避免过度拆碎。"}`;
    const selectedPrompt = regions.length
        ? `${scopePrompt}\n\n重点处理用户框选的区域。选区坐标（图像 0-1000 坐标系）：${regions.map((region, index) => `区域${index + 1} <bbox>${region.join(" ")}</bbox>`).join("；")}`
        : scopePrompt;

    const invalidatePlan = () => {
        planningRequest.current?.abort(); planningRequest.current = null;
        setPlanning(false); setPlan(undefined); setPlanningError("");
    };
    const requestPlan = async () => {
        const error = imageLayerPlannerError(config, plannerModel);
        if (error) { setPlanningError(error); return; }
        if (planningRequest.current) return;
        const controller = new AbortController(); planningRequest.current = controller;
        setPlanning(true); setPlanningError(""); setPlan(undefined);
        try {
            const result = await onPlan(plannerModel, selectedPrompt, controller.signal);
            if (controller.signal.aborted || planningRequest.current !== controller) return;
            setPlan(result); setTargetText(imageLayerPlanTargets(result).join("\n"));
            setBackgroundRemovals(result.layers.map((layer) => Boolean(layer.removeFromBackground)));
        } catch (error) {
            if (!controller.signal.aborted) setPlanningError(error instanceof Error ? error.message : "识图规划失败，未提交拆图任务");
        } finally {
            if (planningRequest.current === controller) { planningRequest.current = null; setPlanning(false); }
        }
    };

    return (
        <AppModal flush open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered width={900} title="AI 图层拆分">
            <div className="grid max-h-[82vh] gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_360px]" data-canvas-no-zoom>
                <div className="grid min-h-[340px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3 dark:bg-white/[0.04]">
                    <div
                        ref={imageFrameRef}
                        className="relative inline-block max-h-[60vh] max-w-full touch-none select-none"
                        onPointerDown={startBox}
                        onPointerMove={moveBox}
                        onPointerUp={finishBox}
                        onPointerCancel={() => {
                            setDrawing(null);
                            setDraft(null);
                        }}
                    >
                        <img src={dataUrl} alt="待拆分图片" className="block max-h-[60vh] max-w-full object-contain" draggable={false} />
                        <div className="pointer-events-none absolute inset-0">
                            {regions.map((region, index) => <RegionBox key={`${region.join("-")}-${index}`} region={region} label={index + 1} />)}
                            {draft ? <RegionBox region={draft} label={regions.length + 1} draft /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-lg font-semibold">拆分图片图层</h3>
                        <p className="mt-1 text-sm opacity-60">识图后按画面结构规划完整底图与透明对象，不固定题材或层数。结果收纳为一组，可叠放或展开；细节可继续拆分或提取备用素材。</p>
                    </div>
                    <Segmented block aria-label="拆分范围" value={detailMode ? "detail" : "primary"} options={[{ label: "自动拆分", value: "primary" }, { label: "详细拆分", value: "detail" }]} onChange={(value) => { setDetailMode(value === "detail"); invalidatePlan(); }} />
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={regions.length ? "blue" : "default"}>{regions.length ? `已框选 ${regions.length} 个区域` : "未框选，按描述拆分"}</Tag>
                        {regions.length ? <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => { setRegions([]); invalidatePlan(); }}>清除选区</Button> : <span className="text-xs opacity-55"><Plus className="mr-1 inline size-3" />在左侧图片上拖动添加选区</span>}
                    </div>
                    <Input.TextArea rows={4} value={prompt} placeholder="描述拆层要求，支持任意题材的单张图片" onChange={(event) => { setPrompt(event.target.value); invalidatePlan(); }} />
                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">图层拆分模型</div>
                        <Checkbox checked={experimental} onChange={(event) => setExperimental(event.target.checked)}>
                            并发拆分（普通图片模型，可搭配去背景）
                        </Checkbox>
                        <ModelPicker
                            config={{ ...config, model: selectedModel, imageModel: selectedModel }}
                            value={generationConfig.imageModel || generationConfig.model}
                            capability="image"
                            fullWidth
                            showSelectedPrice={experimental}
                            modelFilter={(model) => supportsLayerDecomposition(config, model) || (experimental && supportsExperimentalLayerExtraction(config, model))}
                            placeholder={experimental ? "选择可编辑参考图的图片模型" : "选择专用拆层模型"}
                            onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            onChange={(model) => setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model), size: imageLayerOutputSize(config, model, sourceSize) }))}
                        />
                        {!supported ? (
                            <div className="text-xs opacity-70">
                                请选择专用拆层模型，或启用逐层拆分并选择接受参考图的模型。
                                <button type="button" className="ml-1 underline" onClick={() => navigateToSettings({ continueCreation: true })}>
                                    前往配置
                                </button>
                            </div>
                        ) : null}
                    </div>
                    {experimental && !dedicated ? (
                        <div className="space-y-2">
                            <Checkbox checked={usePlanner} onChange={(event) => { setUsePlanner(event.target.checked); invalidatePlan(); }}>用文本模型识图规划</Checkbox>
                            {usePlanner ? <>
                                <ModelPicker config={config} value={plannerModel} capability="text" fullWidth showSelectedPrice placeholder="选择识图规划文本模型" onChange={(model) => { setPlannerModel(model); invalidatePlan(); }} />
                                {plannerError ? <p role="alert" className="text-xs text-red-500">{plannerError}</p> : null}
                                <Button loading={planning} disabled={!plannerModel || Boolean(plannerError) || !selectedPrompt} onClick={() => void requestPlan()}>识图规划</Button>
                                <p className="text-xs opacity-70">规划使用一次文本模型调用并按该模型计费；返回计划后可编辑，再开始拆分。</p>
                                {planningError ? <p role="alert" className="text-xs text-red-500">{planningError}</p> : null}
                            </> : null}
                            <div className="text-sm">拆层目标（每行一层，第一层为背景底图）</div>
                            <Input.TextArea aria-label="拆层目标" rows={4} readOnly={planning} value={targetText} placeholder="先识图规划，也可关闭规划后每行填写一层" onChange={(event) => setTargetText(event.target.value)} />
                            {experimentalTargets?.slice(1).map((target, i) => <Checkbox key={i} className="!flex text-xs" checked={backgroundRemovals[i + 1] ?? i === 0} onChange={(event) => setBackgroundRemovals(experimentalTargets!.map((_, index) => index === i + 1 ? event.target.checked : backgroundRemovals[index] ?? index === 1))}>从底图移除第 {i + 2} 层：{target.split(/[：:]/)[0].slice(0, 40)}</Checkbox>)}
                            {experimentalTargets ? <p className="text-xs opacity-70">未勾选的细节仍保留在底图，透明副本可作叠加或备用素材。移动、替换或删除这类对象时，需另修补底图中的原对象；合成不保证逐像素还原。</p> : null}
                            <p className="text-xs opacity-70">{sourceSize ? `锁定原图画布 ${sourceSize.width}×${sourceSize.height}；` : ""}模型请求尺寸 {generationConfig.size || "未支持"}。各层统一保存为原图尺寸与比例；仅归一化 1% 内的模型尺寸取整差，明显比例变化直接报错。生成模型仍不保证原始内容与坐标完全不变。</p>
                            <Checkbox checked={removeBackground} onChange={(event) => setRemoveBackground(event.target.checked)}>非透明前景层自动去背景（每层最多一次）</Checkbox>
                            {removeBackground ? <ModelPicker config={config} value={removalModel} capability="image" fullWidth placeholder="选择去背景模型" showSelectedPrice modelFilter={(model) => supportsExperimentalLayerExtraction(config, model) && !supportsLayerDecomposition(config, model)} onChange={setRemovalModel} /> : null}
                            {removalError ? <p role="alert" className="text-xs text-red-500">{removalError}</p> : null}
                            <p className="text-xs opacity-70">各图层同时提交提取，本层需要时再去背景；最多 {experimentalTargets ? experimentalTargets.length + (removeBackground ? experimentalTargets.length - 1 : 0) : removeBackground ? "3–15" : "2–8"} 次图片调用，分别计费。一层失败不阻断其他已提交图层；不自动付费重试。实际执行受服务器及渠道并发额度限制。刷新不续发未提交阶段。结果收纳为一组，默认折叠。</p>
                            {targetError ? <p className="text-xs text-red-500">{targetError}</p> : null}
                        </div>
                    ) : null}
                    {outputSizeError ? <p role="alert" className="text-xs text-red-500">{outputSizeError}</p> : null}
                    <div className="mt-auto flex justify-end gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            type="primary"
                            icon={<Layers3 className="size-4" />}
                            disabled={!prompt.trim() || !supported || !dataUrl || Boolean(drawing) || Boolean(targetError) || Boolean(outputSizeError) || Boolean(removalError) || planning || (experimental && !dedicated && (!experimentalTargets || (usePlanner && (!plan || Boolean(plannerError)))))}
                            onClick={() => onConfirm({ prompt: selectedPrompt, regions, experimentalTargets, removeFromBackground: experimentalTargets?.map((_, i) => i > 0 && (backgroundRemovals[i] ?? i === 1)), backgroundRemovalModel: experimental && !dedicated && removeBackground ? removalModel : undefined, planning: usePlanner ? plan : undefined, generationConfig: { model: selectedModel, imageModel: selectedModel, size: generationConfig.size, quality: generationConfig.quality } })}
                        >
                            开始拆分
                        </Button>
                    </div>
                </div>
            </div>
        </AppModal>
    );
}

function RegionBox({ region, label, draft = false }: { region: [number, number, number, number]; label: number; draft?: boolean }) {
    const [x1, y1, x2, y2] = region;
    return <div className={`absolute rounded-sm border-2 ${draft ? "border-dashed border-blue-500 bg-blue-500/10" : "border-solid border-amber-400 bg-amber-400/10"}`} style={{ left: `${x1 / 10}%`, top: `${y1 / 10}%`, width: `${(x2 - x1) / 10}%`, height: `${(y2 - y1) / 10}%` }}><span className="absolute -left-0.5 -top-0.5 grid size-5 -translate-y-1/2 -translate-x-1/2 place-items-center rounded-full bg-amber-400 text-[11px] font-semibold text-black shadow">{label}</span></div>;
}
