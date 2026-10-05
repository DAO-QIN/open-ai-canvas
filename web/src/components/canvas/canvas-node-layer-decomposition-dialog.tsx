import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, Input, Tag } from "antd";
import { Layers3, Plus, RotateCcw, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { parseExperimentalLayerTargets, supportsExperimentalLayerExtraction, supportsLayerDecomposition } from "@/lib/canvas/canvas-image-layers";
import { AppModal } from "@/components/ui/product/app-modal";
import { navigateToSettings } from "@/lib/settings-navigation";

export type CanvasImageLayerDecompositionPayload = {
    prompt: string;
    regions?: Array<[number, number, number, number]>;
    experimentalTargets?: string[];
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality">>;
};

const DEFAULT_PROMPT = "将图片拆分为可独立编辑的图层：识别主要主体、前景、背景和重要物体，输出一张底图与多张同尺寸透明 PNG 图层，保持原图外观、边缘细节和原始坐标，不要合并不同图层，透明图层按从底到顶的顺序输出。";

export function CanvasNodeLayerDecompositionDialog({
    dataUrl,
    open,
    config,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    config: AiConfig;
    onClose: () => void;
    onConfirm: (payload: CanvasImageLayerDecompositionPayload) => void;
}) {
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const [regions, setRegions] = useState<Array<[number, number, number, number]>>([]);
    const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
    const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
    const [experimental, setExperimental] = useState(false);
    const [targetText, setTargetText] = useState("背景底图\n主要主体\n前景物体");
    const imageFrameRef = useRef<HTMLDivElement>(null);
    const configRef = useRef(config);
    configRef.current = config;

    useEffect(() => {
        if (!open) return;
        setPrompt(DEFAULT_PROMPT);
        const current = configRef.current;
        const model = [current.imageModel, current.model, ...selectableModelsByCapability(current, "image")].find((value) => supportsLayerDecomposition(current, value || "")) || "";
        setGenerationConfig({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) });
        setRegions([]);
        setDrawing(null);
        setDraft(null);
        setExperimental(false);
        setTargetText("背景底图\n主要主体\n前景物体");
    }, [dataUrl, open]);

    const selectedModel = generationConfig.imageModel || generationConfig.model;
    const dedicated = supportsLayerDecomposition(config, selectedModel);
    const supported = dedicated || (experimental && supportsExperimentalLayerExtraction(config, selectedModel));
    let experimentalTargets: string[] | undefined;
    let targetError = "";
    if (experimental && !dedicated) {
        try {
            experimentalTargets = parseExperimentalLayerTargets(targetText);
        } catch (error) {
            targetError = error instanceof Error ? error.message : "拆层目标无效";
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
        if (x2 - x1 >= 2 && y2 - y1 >= 2) setRegions((current) => [...current, [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]]);
        setDrawing(null);
        setDraft(null);
    };

    const selectedPrompt = regions.length
        ? `${prompt.trim()}\n\n重点处理用户框选的区域，并分别输出这些区域中的主体为独立透明 PNG 图层。选区坐标（图像 0-1000 坐标系）：${regions.map((region, index) => `区域${index + 1} <bbox>${region.join(" ")}</bbox>`).join("；")}`
        : prompt.trim();

    return (
        <AppModal flush open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered width={900} title="AI 图层拆分">
            <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_320px]">
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
                        <p className="mt-1 text-sm opacity-60">拆分为底图和独立透明图层，默认叠放显示合成图，可展开查看、编辑和下载各图层。框选区域作为模型提示，不保证精确分割。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={regions.length ? "blue" : "default"}>{regions.length ? `已框选 ${regions.length} 个区域` : "未框选，按描述拆分"}</Tag>
                        {regions.length ? <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => setRegions([])}>清除选区</Button> : <span className="text-xs opacity-55"><Plus className="mr-1 inline size-3" />在左侧图片上拖动添加选区</span>}
                    </div>
                    <Input.TextArea rows={7} value={prompt} placeholder="例如：分别提取人物、产品、前景装饰和背景" onChange={(event) => setPrompt(event.target.value)} />
                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">图层拆分模型</div>
                        <Checkbox checked={experimental} onChange={(event) => setExperimental(event.target.checked)}>
                            实验拆层（普通模型逐层调用）
                        </Checkbox>
                        <ModelPicker
                            config={{ ...config, model: selectedModel, imageModel: selectedModel }}
                            value={generationConfig.imageModel || generationConfig.model}
                            capability="image"
                            fullWidth
                            showSelectedPrice={experimental}
                            modelFilter={(model) => supportsLayerDecomposition(config, model) || (experimental && supportsExperimentalLayerExtraction(config, model))}
                            placeholder={experimental ? "选择拆层或 OpenAI Images 模型" : "选择专用拆层模型"}
                            onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            onChange={(model) => setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))}
                        />
                        {!supported ? (
                            <div className="text-xs opacity-70">
                                请选择可用模型；普通 OpenAI Images 模型需启用实验拆层。
                                <button type="button" className="ml-1 underline" onClick={() => navigateToSettings({ continueCreation: true })}>
                                    前往配置
                                </button>
                            </div>
                        ) : null}
                    </div>
                    {experimental && !dedicated ? (
                        <div className="space-y-2">
                            <div className="text-sm">拆层目标（每行一层，第一层为背景底图）</div>
                            <Input.TextArea aria-label="实验拆层目标" rows={3} value={targetText} onChange={(event) => setTargetText(event.target.value)} />
                            <p className="text-xs opacity-70">最多调用 {experimentalTargets?.length || "2–8"} 次，分别计费。普通模型不保证输出透明图层；校验失败立即停止，不自动付费重试。刷新后不自动提交尚未调用的图层。</p>
                            {targetError ? <p className="text-xs text-red-500">{targetError}</p> : null}
                        </div>
                    ) : null}
                    <div className="mt-auto flex justify-end gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            type="primary"
                            icon={<Layers3 className="size-4" />}
                            disabled={!selectedPrompt || !supported || !dataUrl || Boolean(drawing) || Boolean(targetError)}
                            onClick={() => onConfirm({ prompt: selectedPrompt, regions, experimentalTargets, generationConfig: { model: selectedModel, imageModel: selectedModel, size: generationConfig.size, quality: generationConfig.quality } })}
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
