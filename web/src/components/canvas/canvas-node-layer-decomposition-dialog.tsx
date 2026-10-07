import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, Input, Segmented, Select, Tag } from "antd";
import { Layers3, Plus, RotateCcw, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { modelCompatibilityError } from "@/lib/model-selection";
import { imageLayerOutputSize, imageLayerPlannerError, imageLayerPlanTargets, imageLayerTargetName, type ImageLayerPlan, type ImageLayerPlanningOptions, type ImageLayerPlanningPurpose } from "@/lib/canvas/canvas-image-layer-plan";
import { parseExperimentalLayerTargets, supportsExperimentalLayerExtraction, supportsLayerDecomposition } from "@/lib/canvas/canvas-image-layers";
import { AppModal } from "@/components/ui/product/app-modal";
import { navigateToSettings } from "@/lib/settings-navigation";
import { imageLayerModelCalls, resolveImageLayerExtractions, type ImageLayerExtraction, type ImageLayerRegion } from "@/lib/canvas/canvas-image-layer-strategy";
import { calibrateImageLayerRegions } from "@/services/canvas-image-layer-source";

export type CanvasImageLayerDecompositionPayload = {
    prompt: string;
    regions?: Array<[number, number, number, number]>;
    experimentalTargets?: string[];
    extractions?: ImageLayerExtraction[];
    removeFromBackground?: boolean[];
    backgroundRemovalModel?: string;
    planning?: Pick<ImageLayerPlan, "model" | "taskId">;
    independentMaterials?: boolean;
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality">>;
};

const DEFAULT_PROMPT =
    "拆出完整不透明背景和必要的独立前景。背景移除已拆内容并修补，保留其他环境与设计结构；框内完整照片或场景保留内部内容，不拆碎。前景保持原始比例、位置和细节，使用真实透明背景；不扩展原图画幅。";

export function CanvasNodeLayerDecompositionDialog({
    dataUrl,
    storageKey,
    open,
    config,
    sourceSize,
    onPlan,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    storageKey?: string;
    open: boolean;
    config: AiConfig;
    sourceSize?: { width: number; height: number };
    onPlan: (model: string, prompt: string, signal: AbortSignal, options?: ImageLayerPlanningOptions) => Promise<ImageLayerPlan>;
    onClose: () => void;
    onConfirm: (payload: CanvasImageLayerDecompositionPayload) => void;
}) {
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number }>();
    const previewSize = sourceSize || measuredSize;
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const [regions, setRegions] = useState<Array<[number, number, number, number]>>([]);
    const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
    const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
    const [experimental, setExperimental] = useState(false);
    const [targetText, setTargetText] = useState("");
    const [detailMode, setDetailMode] = useState(false);
    const [purpose, setPurpose] = useState<ImageLayerPlanningPurpose>("recompose");
    const [calibrating, setCalibrating] = useState<number | null>(null);
    const [calibrationMessage, setCalibrationMessage] = useState("");
    const calibrationEpoch = useRef(0);
    const [backgroundRemovals, setBackgroundRemovals] = useState<boolean[]>([]);
    const [extractionChoices, setExtractionChoices] = useState<ImageLayerExtraction[]>([]);
    const [regionTexts, setRegionTexts] = useState<string[]>([]);
    const [editingRegion, setEditingRegion] = useState<number | null>(null);
    const [plannerModel, setPlannerModel] = useState("");
    const [usePlanner, setUsePlanner] = useState(true);
    const [plan, setPlan] = useState<ImageLayerPlan>();
    const [planning, setPlanning] = useState(false);
    const [planningError, setPlanningError] = useState("");
    const [planningInput, setPlanningInput] = useState<"preview" | "original">("preview");
    const [removeBackground, setRemoveBackground] = useState(true);
    const [removalModel, setRemovalModel] = useState("");
    const planningRequest = useRef<AbortController | null>(null);
    const imageFrameRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);
    configRef.current = config;

    useEffect(() => {
        if (!open) return;
        setPrompt(DEFAULT_PROMPT);
        setMeasuredSize(undefined);
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
        setPurpose("recompose");
        setCalibrating(null);
        setCalibrationMessage("");
        calibrationEpoch.current++;
        setBackgroundRemovals([]);
        setExtractionChoices([]);
        setRegionTexts([]);
        setEditingRegion(null);
        setPlannerModel(current.textModel || selectableModelsByCapability(current, "text")[0] || "");
        setUsePlanner(true);
        setPlan(undefined);
        setPlanning(false);
        setPlanningError("");
        setPlanningInput("preview");
        setRemoveBackground(true);
        setRemovalModel(models.find((value) => supportsExperimentalLayerExtraction(current, value || "") && !supportsLayerDecomposition(current, value || "")) || "");
        return () => {
            planningRequest.current?.abort();
            planningRequest.current = null;
            calibrationEpoch.current++;
        };
    }, [dataUrl, open]);

    const selectedModel = generationConfig.imageModel || generationConfig.model;
    const dedicated = supportsLayerDecomposition(config, selectedModel);
    const plannerError = usePlanner && plannerModel ? imageLayerPlannerError(config, plannerModel) : "";
    let experimentalTargets: string[] | undefined;
    let targetError = "";
    if (experimental && !dedicated) {
        try {
            experimentalTargets = parseExperimentalLayerTargets(targetText);
        } catch (error) {
            targetError = targetText.trim() ? (error instanceof Error ? error.message : "拆层目标无效") : "";
        }
    }
    const removals = experimentalTargets?.map((_, i) => i > 0 && (backgroundRemovals[i] ?? purpose === "recompose"));
    let extractions: ImageLayerExtraction[] | undefined;
    let extractionError = "";
    if (experimentalTargets) {
        try {
            extractions = resolveImageLayerExtractions(
                experimentalTargets.length,
                experimentalTargets.map((_, i) => {
                    const choice = extractionChoices[i] || { method: i === 0 && purpose === "materials" ? "source" as const : "generate" as const };
                    if (choice.method !== "source-region") return choice;
                    return { ...choice, region: { shape: choice.region?.shape || "rect", radiusRatio: choice.region?.radiusRatio, bbox: parseRegionText(regionTexts[i] || "") } };
                }),
                removals,
            );
        } catch (error) {
            extractionError = error instanceof Error ? error.message : "提取方式无效";
        }
    }
    const needsModel = !experimentalTargets || (extractions || extractionChoices).some((extraction) => extraction.method === "generate") || !extractions;
    const generatedObjects = extractions?.some((extraction, i) => i > 0 && extraction.method === "generate") ?? true;
    const supported = !needsModel || dedicated || (experimental && supportsExperimentalLayerExtraction(config, selectedModel));
    const outputSizeError = !needsModel || generationConfig.size ? "" : "所选模型没有支持原图比例的尺寸，或源图尺寸尚未读取；请更换模型或重新打开图片";
    const removalError =
        experimental && !dedicated && removeBackground && generatedObjects
            ? !removalModel || !supportsExperimentalLayerExtraction(config, removalModel)
                ? "请选择可接收图片的去背景模型"
                : !imageLayerOutputSize(config, removalModel, sourceSize)
                  ? "去背景模型没有支持原图比例的尺寸"
                  : modelCompatibilityError(config, removalModel, { capability: "image", imageSize: imageLayerOutputSize(config, removalModel, sourceSize) })
            : "";

    const changeExtraction = (index: number, method: ImageLayerExtraction["method"]) => {
        setExtractionChoices((current) =>
                experimentalTargets!.map((_, i) => (i === index ? { method, ...(method === "source-region" ? { region: current[i]?.region || { shape: "rect", bbox: parseRegionText(regionTexts[i] || "") } } : {}) } : current[i] || { method: i === 0 && purpose === "materials" ? "source" : "generate" })),
        );
        setEditingRegion(null);
        if (index === 0 && method === "source") setBackgroundRemovals(experimentalTargets!.map(() => false));
    };

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
        if (x2 - x1 >= 2 && y2 - y1 >= 2) {
            const box = [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)] as ImageLayerRegion["bbox"];
            if (editingRegion !== null) {
                setRegionTexts((current) => experimentalTargets!.map((_, i) => (i === editingRegion ? box.join(" ") : current[i] || "")));
                setEditingRegion(null);
            } else {
                setRegions((current) => [...current, box]);
                invalidatePlan();
            }
        }
        setDrawing(null);
        setDraft(null);
    };

    const scopePrompt = `${prompt.trim()}\n${detailMode ? "详细拆分：按内容增加适合独立编辑的文字或细节；备用细节可保留在底图，另提取素材。" : "自动拆分：根据实际图像结构选择必要图层，不固定题材或层数；保留完整底图，避免过度拆碎。"}`;
    const selectedPrompt = regions.length ? `${scopePrompt}\n\n重点处理用户框选的区域。选区坐标（图像 0-1000 坐标系）：${regions.map((region, index) => `区域${index + 1} <bbox>${region.join(" ")}</bbox>`).join("；")}` : scopePrompt;

    const invalidatePlan = () => {
        calibrationEpoch.current++;
        setCalibrating(null);
        setCalibrationMessage("");
        planningRequest.current?.abort();
        planningRequest.current = null;
        setPlanning(false);
        setPlan(undefined);
        setPlanningError("");
        setExtractionChoices([]);
        setRegionTexts([]);
        setEditingRegion(null);
        setBackgroundRemovals([]);
    };
    const calibrate = async (index: number) => {
        const region = extractions?.[index].region;
        if (!region) return;
        const request = ++calibrationEpoch.current;
        const previous = regionTexts[index];
        setCalibrating(index);
        setCalibrationMessage("");
        try {
            const [proposal] = await calibrateImageLayerRegions({ dataUrl, storageKey }, [region]);
            if (request !== calibrationEpoch.current) return;
            if (proposal) {
                setRegionTexts((current) => (current[index] === previous ? current.map((value, i) => (i === index ? proposal.bbox.join(" ") : value)) : current));
                setCalibrationMessage("已校准规则边界，请核对场景预览；不保证精确分割，可继续框选调整。没有调用模型。");
            } else setCalibrationMessage("没有找到可靠的规则边界，保留原坐标；请在原图框选并核对预览。没有调用模型。");
        } catch (error) {
            if (request === calibrationEpoch.current) setCalibrationMessage(error instanceof Error ? error.message : "边界校准失败，保留原坐标");
        } finally {
            if (request === calibrationEpoch.current) setCalibrating(null);
        }
    };
    const requestPlan = async (history = false) => {
        const error = history ? "" : imageLayerPlannerError(config, plannerModel);
        if (error) {
            setPlanningError(error);
            return;
        }
        if (planningRequest.current) return;
        const controller = new AbortController();
        planningRequest.current = controller;
        setPlanning(true);
        setPlanningError("");
        setPlan(undefined);
        try {
            const result = await onPlan(plannerModel, selectedPrompt, controller.signal, { input: planningInput, history, purpose });
            if (controller.signal.aborted || planningRequest.current !== controller) return;
            setPlan(result);
            setTargetText(imageLayerPlanTargets(result).join("\n"));
            setBackgroundRemovals(result.layers.map((layer) => Boolean(layer.removeFromBackground)));
            setExtractionChoices(result.layers.map((layer) => layer.extraction || { method: "generate" }));
            setRegionTexts(result.layers.map((layer) => (layer.extraction?.region?.bbox || layer.bbox)?.join(" ") || ""));
            setEditingRegion(null);
        } catch (error) {
            if (!controller.signal.aborted) setPlanningError(error instanceof Error ? error.message : "识图规划失败，未提交拆图任务");
        } finally {
            if (planningRequest.current === controller) {
                planningRequest.current = null;
                setPlanning(false);
            }
        }
    };

    return (
        <AppModal flush open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered width={900} title="AI 图层拆分">
            <div className="grid max-h-[82vh] gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_360px]" data-canvas-no-zoom>
                <div className="grid min-h-[340px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3 dark:bg-white/[0.04] md:sticky md:top-0 md:self-start">
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
                        <img
                            src={dataUrl}
                            alt="待拆分图片"
                            className="block max-h-[60vh] max-w-full object-contain"
                            draggable={false}
                            onLoad={(event) => setMeasuredSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                        />
                        <div className="pointer-events-none absolute inset-0">
                            {regions.map((region, index) => (
                                <RegionBox key={`${region.join("-")}-${index}`} region={region} label={index + 1} />
                            ))}
                            {extractions?.map((extraction, index) =>
                                extraction.method === "source-region" && extraction.region ? (
                                    <RegionBox
                                        key={`layer-${index}`}
                                        region={extraction.region.bbox}
                                        label={index + 1}
                                        shape={extraction.region.shape}
                                        radiusRatio={extraction.region.radiusRatio}
                                        imageAspect={sourceSize ? sourceSize.width / sourceSize.height : 1}
                                    />
                                ) : null,
                            )}
                            {draft ? <RegionBox region={draft} label={regions.length + 1} draft /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-lg font-semibold">拆分背景与前景</h3>
                        <p className="mt-1 text-sm opacity-60">输出完整背景与独立图层，保持原图比例和位置，收纳为一组并默认折叠。框内完整场景保留内部背景。</p>
                    </div>
                    <Segmented
                        block
                        aria-label="拆分目的"
                        value={purpose}
                        options={[
                            { label: "背景与前景", value: "recompose" },
                            { label: "保留原图副本", value: "materials" },
                        ]}
                        onChange={(value) => {
                            setPurpose(value as ImageLayerPlanningPurpose);
                            invalidatePlan();
                        }}
                    />
                    <p className="text-xs opacity-70">{purpose === "materials" ? "保留完整原图，提取图层作为副本；副本默认不重复叠加，可在管理图层中开启。" : "已拆内容从背景移除并修补，前景图层默认参与合成。请核对模型修补效果。"} 如需裁去透明留白，可在完成后通过「管理图层」手动另存素材。</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={regions.length ? "blue" : "default"}>{regions.length ? `已框选 ${regions.length} 个区域` : "未框选，按描述拆分"}</Tag>
                        {regions.length ? (
                            <Button
                                size="small"
                                icon={<RotateCcw className="size-3.5" />}
                                onClick={() => {
                                    setRegions([]);
                                    invalidatePlan();
                                }}
                            >
                                清除选区
                            </Button>
                        ) : (
                            <span className="text-xs opacity-55">
                                <Plus className="mr-1 inline size-3" />
                                在左侧图片上拖动添加选区
                            </span>
                        )}
                    </div>
                    <details>
                    <summary className="cursor-pointer text-sm opacity-75">补充要求与拆分细节</summary>
                    <Checkbox checked={detailMode} onChange={(event) => { setDetailMode(event.target.checked); invalidatePlan(); }}>增加有复用价值的文字与细节</Checkbox>
                    <Input.TextArea
                        rows={4}
                        value={prompt}
                        placeholder="描述拆层要求，支持任意题材的单张图片"
                        onChange={(event) => {
                            setPrompt(event.target.value);
                            invalidatePlan();
                        }}
                    />
                    </details>
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
                            <Checkbox
                                checked={usePlanner}
                                onChange={(event) => {
                                    setUsePlanner(event.target.checked);
                                    invalidatePlan();
                                }}
                            >
                                用文本模型识图规划
                            </Checkbox>
                            {usePlanner ? (
                                <>
                                    <ModelPicker
                                        config={config}
                                        value={plannerModel}
                                        capability="text"
                                        fullWidth
                                        showSelectedPrice
                                        placeholder="选择识图规划文本模型"
                                        onChange={(model) => {
                                            setPlannerModel(model);
                                            invalidatePlan();
                                        }}
                                    />
                                    {plannerError ? (
                                        <p role="alert" className="text-xs text-red-500">
                                            {plannerError}
                                        </p>
                                    ) : null}
                                    <Segmented
                                        block
                                        aria-label="识图输入"
                                        value={planningInput}
                                        options={[
                                            { label: "兼容预览", value: "preview" },
                                            { label: "原图", value: "original" },
                                        ]}
                                        onChange={(value) => {
                                            setPlanningInput(value as "preview" | "original");
                                            invalidatePlan();
                                        }}
                                    />
                                    <p className="text-xs opacity-70">兼容预览仅将识图输入等比例缩至最长边 1000 像素，拆层仍使用原图。密集文字或小细节识别不清时可选原图再手动规划。</p>
                                    <Button loading={planning} disabled={!plannerModel || Boolean(plannerError) || !selectedPrompt} onClick={() => void requestPlan()}>
                                        识图规划
                                    </Button>
                                    <Button disabled={planning} onClick={() => void requestPlan(true)}>
                                        读取最近可用规划
                                    </Button>
                                    <p className="text-xs opacity-70">规划使用一次文本模型调用并按该模型计费。请核对目标与左侧原图一致；识图有误时更换模型或编辑计划，再开始拆分。</p>
                                    {planningError ? (
                                        <p role="alert" className="text-xs text-red-500">
                                            {planningError}。没有提交拆图任务，不会自动付费重试。
                                        </p>
                                    ) : null}
                                    {plan?.warnings?.map((warning, index) => (
                                        <p role="status" key={index} className="text-xs text-amber-600 dark:text-amber-400">
                                            {warning}
                                        </p>
                                    ))}
                                    {plan?.reasoning ? <div aria-label="识图规划依据" className="space-y-1 rounded-lg border border-[var(--border-default)] p-2 text-xs">
                                        <div className="font-medium">识图规划依据</div>
                                        <p>图片结构：{plan.reasoning.structure}</p>
                                        <p>编辑目标：{plan.reasoning.editingGoal}</p>
                                        <p>提取策略：{plan.reasoning.strategy}</p>
                                    </div> : null}
                                </>
                            ) : null}
                            <details open={!plan}>
                            <summary className="cursor-pointer text-sm opacity-75">编辑素材描述（每行一层，第一层为底图）</summary>
                            <Input.TextArea
                                aria-label="拆层目标"
                                rows={4}
                                readOnly={planning}
                                value={targetText}
                                placeholder="先识图规划，也可关闭规划后每行填写一层"
                                onChange={(event) => {
                                    setTargetText(event.target.value);
                                    const nextTargets = event.target.value.split("\n").filter((line) => line.trim());
                                    if (nextTargets.length !== experimentalTargets?.length || nextTargets.some((target, i) => imageLayerTargetName(target) !== imageLayerTargetName(experimentalTargets![i]))) {
                                        invalidatePlan();
                                        if (usePlanner) setPlanningError("素材名称或数量已改变，请重新规划；也可关闭识图规划后手动配置提取方式");
                                        return;
                                    }
                                    setPlan((current) => current ? { ...current, reasoning: undefined, layers: current.layers.map((layer) => ({ ...layer, editUnit: undefined })) } : current);
                                }}
                            />
                            </details>
                            {experimentalTargets?.map((target, i) => {
                                const choice = extractionChoices[i] || { method: i === 0 && purpose === "materials" ? "source" as const : "generate" as const };
                                return (
                                    <div key={i} className="space-y-2 rounded-lg border border-[var(--border-default)] p-2">
                                        <div className="text-xs font-medium">
                                            {i + 1}. {target.split(/[：:]/)[0].slice(0, 40)}
                                            {plan?.layers[i]?.editUnit ? <span className="ml-2 opacity-60">{({ scene: "完整场景", object: "独立对象", text: "文字", decoration: "装饰", group: "完整组件" })[plan.layers[i].editUnit!]}</span> : null}
                                        </div>
                                        <p className="text-xs opacity-65">{choice.method === "source" ? "完整原图底板 · 不调用图片模型" : choice.method === "source-region" ? "复制原图可见素材 · 保留内部背景" : "模型提取透明轮廓 · 请核对生成结果"}</p>
                                        {choice.method === "source-region" && extractions?.[i].region ? <RegionPreview dataUrl={dataUrl} region={extractions[i].region!} sourceSize={previewSize} label={i + 1} /> : null}
                                        <details open={choice.method === "source-region" && !extractions?.[i].region}>
                                        <summary className="cursor-pointer text-xs opacity-75">调整提取方式与边界</summary>
                                        <Select
                                            aria-label={`第${i + 1}层提取方式`}
                                            className="w-full"
                                            value={choice.method}
                                            disabled={planning}
                                            options={
                                                i === 0
                                                    ? [
                                                          { label: "模型修补完整底图", value: "generate" },
                                                          { label: "保留原图底图（不移除对象）", value: "source" },
                                                      ]
                                                    : [
                                                          { label: "模型提取（复杂轮廓、遮挡补全）", value: "generate" },
                                                          { label: "原图区域提取（保留区域内全部像素）", value: "source-region" },
                                                      ]
                                            }
                                            onChange={(method) => changeExtraction(i, method)}
                                        />
                                        {choice.method === "source-region" ? (
                                            <>
                                                <Select
                                                    aria-label={`第${i + 1}层区域形状`}
                                                    className="w-full"
                                                    value={choice.region?.shape || "rect"}
                                                    disabled={planning}
                                                    options={[
                                                        { label: "矩形", value: "rect" },
                                                        { label: "圆角矩形", value: "rounded-rect" },
                                                        { label: "椭圆", value: "ellipse" },
                                                    ]}
                                                    onChange={(shape) =>
                                                        setExtractionChoices((current) =>
                                                            current.map((item, index) =>
                                                                index === i ? { ...item, region: { bbox: parseRegionText(regionTexts[i] || ""), shape, ...(shape === "rounded-rect" ? { radiusRatio: item.region?.radiusRatio ?? 0.04 } : {}) } } : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                                <label className="block text-xs opacity-70">
                                                    区域坐标（0–1000：左 上 右 下）
                                                    <input
                                                        aria-label={`第${i + 1}层区域坐标`}
                                                        className="mt-1 w-full rounded border border-[var(--border-default)] bg-transparent px-2 py-1"
                                                        value={regionTexts[i] || ""}
                                                        disabled={planning}
                                                        onChange={(event) => setRegionTexts((current) => experimentalTargets.map((_, index) => (index === i ? event.target.value : current[index] || "")))}
                                                    />
                                                </label>
                                                {choice.region?.shape === "rounded-rect" ? (
                                                    <label className="block text-xs opacity-70">
                                                        圆角占短边比例（0–0.5）
                                                        <input
                                                            aria-label={`第${i + 1}层圆角比例`}
                                                            className="ml-2 w-20 rounded border border-[var(--border-default)] bg-transparent px-2 py-1"
                                                            type="number"
                                                            min={0}
                                                            max={0.5}
                                                            step={0.01}
                                                            value={choice.region.radiusRatio ?? ""}
                                                            onChange={(event) =>
                                                                setExtractionChoices((current) =>
                                                                    current.map((item, index) => (index === i ? { ...item, region: { ...item.region!, radiusRatio: event.target.value === "" ? undefined : Number(event.target.value) } } : item)),
                                                                )
                                                            }
                                                        />
                                                    </label>
                                                ) : null}
                                                <Button size="small" aria-pressed={editingRegion === i} disabled={planning} onClick={() => setEditingRegion((current) => (current === i ? null : i))}>
                                                    在原图框选第 {i + 1} 层
                                                </Button>
                                                <Button size="small" disabled={planning || calibrating !== null || !extractions?.[i].region || choice.region?.shape === "ellipse"} loading={calibrating === i} onClick={() => void calibrate(i)}>
                                                    校准第 {i + 1} 层规则边界（免费）
                                                </Button>
                                                <p className="text-xs opacity-70">区域内场景保持原样，区域外透明；不会抠除区域内部背景或补画遮挡。请核对边界。</p>
                                            </>
                                        ) : null}
                                        {i > 0 ? (
                                            <Checkbox
                                                className="!flex text-xs"
                                                checked={removals![i]}
                                                disabled={planning}
                                                onChange={(event) => {
                                                    setBackgroundRemovals(experimentalTargets.map((_, index) => (index === i ? event.target.checked : (backgroundRemovals[index] ?? purpose === "recompose"))));
                                                    if (event.target.checked) setExtractionChoices((current) => experimentalTargets.map((_, index) => index === 0 ? { method: "generate" } : current[index] || { method: "generate" }));
                                                }}
                                            >
                                                从底图移除第 {i + 1} 层
                                            </Checkbox>
                                        ) : null}
                                        </details>
                                    </div>
                                );
                            })}
                            {calibrationMessage ? (
                                <p role="status" className="text-xs opacity-70">
                                    {calibrationMessage}
                                </p>
                            ) : null}
                            {editingRegion !== null ? (
                                <p role="status" className="text-xs opacity-70">
                                    在左侧拖动框选第 {editingRegion + 1} 层的完整区域；本次框选替换该层坐标。
                                </p>
                            ) : null}
                            {extractionError ? (
                                <p role="alert" className="text-xs text-red-500">
                                    {extractionError}。未提交模型请求。
                                </p>
                            ) : null}
                            {experimentalTargets ? <p className="text-xs opacity-70">未勾选的细节仍保留在底图，透明副本可作叠加或备用素材。移动、替换或删除这类对象时，需另修补底图中的原对象；合成不保证逐像素还原。</p> : null}
                            <p className="text-xs opacity-70">
                                {sourceSize ? `锁定原图画布 ${sourceSize.width}×${sourceSize.height}。` : ""}原图提取保持原始像素位置与大小；模型提取请求尺寸 {generationConfig.size || "未支持"}，保存时仅归一化 1%
                                内的尺寸取整差，明显比例变化报错。模型提取仍可能改变内容与坐标。
                            </p>
                            <Checkbox checked={removeBackground} disabled={!generatedObjects} onChange={(event) => setRemoveBackground(event.target.checked)}>
                                非透明前景层自动去背景（每层最多一次）
                            </Checkbox>
                            {removeBackground && generatedObjects ? (
                                <ModelPicker
                                    config={config}
                                    value={removalModel}
                                    capability="image"
                                    fullWidth
                                    placeholder="选择去背景模型"
                                    showSelectedPrice
                                    modelFilter={(model) => supportsExperimentalLayerExtraction(config, model) && !supportsLayerDecomposition(config, model)}
                                    onChange={setRemovalModel}
                                />
                            ) : null}
                            {removalError ? (
                                <p role="alert" className="text-xs text-red-500">
                                    {removalError}
                                </p>
                            ) : null}
                            <p className="text-xs opacity-70">
                                各层并发处理；原图提取不调用图片模型。{extractions ? `最多 ${imageLayerModelCalls(extractions, removeBackground)} 次图片模型调用` : "图片调用上限将在计划有效后显示"}
                                ，按实际调用分别计费。模型前景层需要时再去背景。一层失败保留其他结果，不自动付费重试；实际执行受服务器及渠道并发额度限制。刷新不续发未提交阶段。结果收纳为一组，默认折叠。
                            </p>
                            {targetError ? <p className="text-xs text-red-500">{targetError}</p> : null}
                        </div>
                    ) : null}
                    {outputSizeError ? (
                        <p role="alert" className="text-xs text-red-500">
                            {outputSizeError}
                        </p>
                    ) : null}
                    <div className="mt-auto flex justify-end gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            type="primary"
                            icon={<Layers3 className="size-4" />}
                            disabled={
                                !prompt.trim() ||
                                !supported ||
                                !dataUrl ||
                                Boolean(drawing) ||
                                editingRegion !== null ||
                                calibrating !== null ||
                                Boolean(targetError) ||
                                Boolean(extractionError) ||
                                Boolean(outputSizeError) ||
                                Boolean(removalError) ||
                                planning ||
                                (experimental && !dedicated && (!experimentalTargets || (usePlanner && (!plan || Boolean(plannerError)))))
                            }
                            onClick={() =>
                                onConfirm({
                                    prompt: selectedPrompt,
                                    regions,
                                    experimentalTargets,
                                    extractions,
                                    independentMaterials: false,
                                    removeFromBackground: removals,
                                    backgroundRemovalModel: experimental && !dedicated && removeBackground && generatedObjects ? removalModel : undefined,
                                    planning: usePlanner ? plan : undefined,
                                    generationConfig: { model: selectedModel, imageModel: selectedModel, size: generationConfig.size, quality: generationConfig.quality },
                                })
                            }
                        >
                            开始拆分
                        </Button>
                    </div>
                </div>
            </div>
        </AppModal>
    );
}

function parseRegionText(value: string) {
    return value
        .trim()
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map(Number) as ImageLayerRegion["bbox"];
}

function RegionPreview({ dataUrl, region, sourceSize, label }: { dataUrl: string; region: ImageLayerRegion; sourceSize?: { width: number; height: number }; label: number }) {
    const [left, top, right, bottom] = region.bbox;
    const w = right - left,
        h = bottom - top;
    const aspect = (w / h) * (sourceSize ? sourceSize.width / sourceSize.height : 1);
    const radius = (region.radiusRatio || 0) * Math.min(1 / aspect, 1) * 100;
    return (
        <div className="space-y-1">
            <p className="text-xs opacity-70">第 {label} 层完整区域预览（请检查截断、邻图与留白）</p>
            <div
                role="img"
                aria-label={`第${label}层完整区域预览`}
                className="relative max-h-44 overflow-hidden"
                style={{ aspectRatio: aspect, width: `min(100%, ${176 * aspect}px)`, borderRadius: region.shape === "ellipse" ? "50%" : region.shape === "rounded-rect" ? `${radius}% / ${radius * aspect}%` : undefined }}
            >
                <img src={dataUrl} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ width: `${100000 / w}%`, height: `${100000 / h}%`, left: `${(-left / w) * 100}%`, top: `${(-top / h) * 100}%` }} />
            </div>
        </div>
    );
}

function RegionBox({ region, label, draft = false, shape, radiusRatio, imageAspect = 1 }: { region: [number, number, number, number]; label: number; draft?: boolean; shape?: ImageLayerRegion["shape"]; radiusRatio?: number; imageAspect?: number }) {
    const [x1, y1, x2, y2] = region;
    const w = (x2 - x1) * imageAspect,
        h = y2 - y1,
        radius = Math.min(w, h) * (radiusRatio || 0);
    return (
        <div
            className={`absolute rounded-sm border-2 ${draft ? "border-dashed border-blue-500 bg-blue-500/10" : "border-solid border-amber-400 bg-amber-400/10"}`}
            style={{
                left: `${x1 / 10}%`,
                top: `${y1 / 10}%`,
                width: `${(x2 - x1) / 10}%`,
                height: `${(y2 - y1) / 10}%`,
                ...(shape === "ellipse" ? { borderRadius: "50%" } : shape === "rounded-rect" ? { borderRadius: `${(radius / w) * 100}% / ${(radius / h) * 100}%` } : {}),
            }}
        >
            <span className="absolute -left-0.5 -top-0.5 grid size-5 -translate-y-1/2 -translate-x-1/2 place-items-center rounded-full bg-amber-400 text-[11px] font-semibold text-black shadow">{label}</span>
        </div>
    );
}
