import { Input, InputNumber } from "antd";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch/switch";
import type { ProductConfig } from "@/lib/ecommerce/contracts";
import type { ModelCatalogResponse } from "@/services/api/logical-models";
import { modelChoices, selectedModelKey as selectedKey } from "@/lib/ecommerce/models";

type Props = { value: ProductConfig; catalog: ModelCatalogResponse; onChange: (value: ProductConfig) => void; disabled?: boolean; advancedOnly?: boolean; reviewAvailable?: boolean };
export function ProductSettings({ value, catalog, onChange, disabled, advancedOnly = false, reviewAvailable = false }: Props) {
    const texts = modelChoices(catalog, "text");
    const images = modelChoices(catalog, "image");
    const set = <K extends keyof ProductConfig>(key: K, next: ProductConfig[K]) => onChange({ ...value, [key]: next });
    const image = images.find((choice) => choice.value === selectedKey(value.imageModel))?.model;
    const profile = image?.capabilityConfig as { image?: { size?: { values?: string[]; presets?: { size: string }[] }; quality?: { values?: string[] } } } | undefined;
    const sizes = [...new Set([...(profile?.image?.size?.values ?? []), ...(profile?.image?.size?.presets ?? []).map((item) => item.size)])];
    const qualities = profile?.image?.quality?.values ?? [];
    return (
        <div className="space-y-4">
            {!advancedOnly && (
                <div className="grid gap-4 sm:grid-cols-3">
                    <label className="space-y-2 text-sm">
                        主图数量
                        <InputNumber className="!w-full" aria-label="主图数量" min={1} max={20} value={value.hero.count} disabled={disabled} onChange={(count) => set("hero", { ...value.hero, count: count ?? 3 })} />
                    </label>
                    <label className="space-y-2 text-sm">
                        详情图数量
                        <InputNumber className="!w-full" aria-label="详情图数量" min={1} max={20} value={value.detail.count} disabled={disabled} onChange={(count) => set("detail", { ...value.detail, count: count ?? 5 })} />
                    </label>
                    <label className="space-y-2 text-sm">
                        风格
                        <Input aria-label="套图风格" value={value.style} maxLength={1200} disabled={disabled} onChange={(event) => set("style", event.target.value)} />
                    </label>
                </div>
            )}
            <div className="flex items-start justify-between gap-4 rounded-xl bg-surface-hover p-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">
                        智能质检 <span className="text-xs font-normal text-foreground/60">可选</span>
                    </p>
                    <p id="product-quality-description" className="text-xs leading-5 text-foreground/60">
                        {reviewAvailable ? "生成后检查商品一致性和图片文案，会增加积分与等待时间，费用在生成前确认。" : "智能质检暂未开放，仍可正常生成套图。"}
                    </p>
                </div>
                <Switch aria-label="智能质检" aria-describedby="product-quality-description" checked={Boolean(value.qualityCheck)} disabled={disabled || (!reviewAvailable && !value.qualityCheck)} onChange={(enabled) => set("qualityCheck", enabled)} />
            </div>
            <details className="rounded-xl bg-surface-hover p-4" open={advancedOnly || undefined}>
                <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2">高级设置</summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {(
                        [
                            ["planner", "创作模型", texts],
                            ["imageModel", "生图模型", images],
                        ] as const
                    ).map(([key, label, choices]) => (
                        <label key={key} className="space-y-2 text-sm">
                            {label}
                            <Select
                                className="w-full"
                                ariaLabel={label}
                                disabled={disabled}
                                showSearch
                                optionFilterProp="label"
                                value={selectedKey(value[key])}
                                options={choices.map(({ value, label }) => ({ value, label }))}
                                onChange={(id) => {
                                    const choice = choices.find((item) => item.value === id);
                                    if (choice) set(key, choice.selection);
                                }}
                            />
                        </label>
                    ))}
                    {(
                        [
                            ["platform", "目标平台"],
                            ["market", "市场"],
                            ["language", "成品语言"],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key} className="space-y-2 text-sm">
                            {label}
                            <Input aria-label={label} value={value[key]} maxLength={1200} disabled={disabled} onChange={(event) => set(key, event.target.value)} />
                        </label>
                    ))}
                    {(["hero", "detail"] as const).map((kind) => (
                        <div key={kind} className="space-y-2">
                            <p className="text-sm font-medium">{kind === "hero" ? "主图" : "详情图"}规格</p>
                            <Select className="w-full" ariaLabel={`${kind}图片规格`} disabled={disabled} value={value[kind].size} options={sizes.map((size) => ({ value: size, label: size }))} onChange={(size) => set(kind, { ...value[kind], size })} />
                            {qualities.length > 0 && (
                                <Select
                                    className="w-full"
                                    ariaLabel={`${kind}图片质量`}
                                    disabled={disabled}
                                    value={value[kind].quality || undefined}
                                    allowClear
                                    options={qualities.map((quality) => ({ value: quality, label: quality }))}
                                    onChange={(quality) => set(kind, { ...value[kind], quality: quality ?? "" })}
                                />
                            )}
                            <Select
                                className="w-full"
                                ariaLabel={`${kind}文字模式`}
                                disabled={disabled}
                                value={value[kind].copyMode}
                                options={[
                                    { value: "none", label: "纯图，无排版文案" },
                                    { value: "typeset", label: "图片含准确文案" },
                                ]}
                                onChange={(copyMode) => set(kind, { ...value[kind], copyMode })}
                            />
                        </div>
                    ))}
                    <label className="space-y-2 text-sm">
                        标题数量
                        <InputNumber className="!w-full" aria-label="标题数量" min={1} max={10} value={value.titleCount} disabled={disabled} onChange={(count) => set("titleCount", count ?? 3)} />
                    </label>
                    <label className="space-y-2 text-sm">
                        标题最长字符数
                        <InputNumber className="!w-full" aria-label="标题最长字符数" min={10} max={300} value={value.titleMaxLength} disabled={disabled} onChange={(count) => set("titleMaxLength", count ?? 80)} />
                    </label>
                    {(
                        [
                            ["planningInstructions", "补充策划要求"],
                            ["refinementInstructions", "补充细化要求"],
                            ["generationInstructions", "补充生图要求"],
                        ] as const
                    ).map(([key, label]) => (
                        <label key={key} className="space-y-2 text-sm sm:col-span-2">
                            {label}
                            <Input.TextArea aria-label={label} autoSize={{ minRows: 2, maxRows: 6 }} value={value[key]} maxLength={4000} disabled={disabled} onChange={(event) => set(key, event.target.value)} />
                        </label>
                    ))}
                </div>
                <p className="mt-4 text-xs leading-5 text-foreground/60">修改模型或规格后需要重新报价。预设只影响之后创建的商品；已提交任务按原参数继续执行。</p>
            </details>
        </div>
    );
}
