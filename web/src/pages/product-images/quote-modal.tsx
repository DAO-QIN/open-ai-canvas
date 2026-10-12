import { Alert, Button } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { credits, type Product, type ProductQuote } from "@/lib/ecommerce/contracts";
import { modelChoices, selectedModelKey } from "@/lib/ecommerce/models";
import type { ModelCatalogResponse } from "@/services/api/logical-models";

export type QuotedProduct = { product: Product; quote?: ProductQuote; error?: string };
export function ProductQuoteModal({ items, busy, error, catalog, onClose, onConfirm }: { items: QuotedProduct[] | null; busy: boolean; error?: string; catalog?: ModelCatalogResponse; onClose: () => void; onConfirm: () => void }) {
    const valid = items?.filter((item) => item.quote) ?? [];
    const estimated = valid.reduce((sum, item) => sum + item.quote!.estimatedMicrocredits, 0);
    const budget = valid.reduce((sum, item) => sum + item.quote!.budgetMicrocredits, 0);
    const images = valid.reduce((sum, item) => sum + item.quote!.imageCalls, 0);
    const textCalls = valid.reduce((sum, item) => sum + item.quote!.textCalls, 0);
    const qualityCalls = valid.reduce((sum, item) => sum + (item.quote!.prices.find((price) => price.key === "quality")?.calls ?? 0), 0);
    const qualityEstimated = valid.reduce((sum, item) => sum + item.quote!.prices.filter((price) => price.key === "quality").reduce((total, price) => total + price.calls * price.estimatedMicrocredits, 0), 0);
    const qualityOnly = qualityCalls > 0 && qualityCalls === textCalls && images === 0;
    const expired = valid.some((item) => new Date(item.quote!.expiresAt).getTime() <= Date.now());
    const auto = valid.some((item) => ["auto", "redo-auto"].includes(item.quote!.scope.action));
    const titleOnly = valid.length > 0 && valid.every((item) => item.quote!.scope.action === "redo-titles");
    const planning = valid.length > 0 && valid.every((item) => ["planning", "redo-review", "append"].includes(item.quote!.scope.action));
    const reviewModels = catalog ? modelChoices(catalog, "text", 2) : [];
    return (
        <AppModal
            title={auto ? "确认整套商品与预算" : "确认本阶段费用"}
            open={items !== null}
            onCancel={onClose}
            closable={!busy}
            mask={{ closable: !busy }}
            footer={
                <div className="flex justify-end gap-2">
                    <Button disabled={busy} onClick={onClose}>
                        返回
                    </Button>
                    <Button type="primary" loading={busy} disabled={!valid.length || expired} onClick={onConfirm}>
                        {qualityOnly ? "确认并开始质检" : titleOnly ? "确认并生成标题" : images ? "确认并开始生成" : planning ? "确认并开始策划" : "确认并继续"}
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-sm leading-6">
                    本次处理 <strong>{valid.length}</strong> 个商品，包含 <strong>{textCalls - qualityCalls}</strong> 项文字处理、<strong>{images}</strong> 张图片生成
                    {qualityCalls > 0 && (
                        <>
                            、<strong>{qualityCalls}</strong> 张智能质检
                        </>
                    )}
                    。
                </p>
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-hover p-4">
                    <div>
                        <p className="text-xs text-foreground/60">预计费用</p>
                        <p className="mt-1 text-lg font-semibold">{credits(estimated)} 积分</p>
                    </div>
                    <div>
                        <p className="text-xs text-foreground/60">本阶段授权上限</p>
                        <p className="mt-1 text-lg font-semibold">{credits(budget)} 积分</p>
                    </div>
                </div>
                {qualityCalls > 0 && <p className="text-xs leading-5 text-foreground/60">预计费用已包含智能质检 {credits(qualityEstimated)} 积分。生成图片后逐张检查，不会自动重生成。</p>}
                <p className="text-xs leading-5 text-foreground/60">
                    每个步骤开始时预留积分，完成后按实际用量结算。确认预算不会额外扣费。
                    {qualityOnly
                        ? "只检查已有成图，图片与标题保持不变。"
                        : titleOnly
                          ? "只重新生成标题，已生成图片和旧标题会保留。"
                          : auto
                            ? "方案校验通过后会自动细化和生图；遇到费用或模型变化时暂停并等你重新确认。"
                            : images
                              ? "只推进本次选中的有效方案。"
                              : "策划和标题本身计费。确认方案后，细化与生图会另行报价。"}
                </p>
                <div className="max-h-64 space-y-3 overflow-auto">
                    {items?.map(({ product, quote, error }) => {
                        const config = quote?.scope.config ?? (quote && ["planning", "auto", "redo-review", "redo-auto"].includes(quote.scope.action) ? product.config : (product.run?.config ?? product.config));
                        const reviewer = quote?.prices.find((price) => price.key === "quality" && price.calls > 0)?.reviewModel;
                        const reviewLabel = reviewer && (reviewModels.find((choice) => selectedModelKey(choice.selection) === selectedModelKey(reviewer))?.label || catalog?.models?.find((model) => model.id === reviewer.logicalModelId)?.name || reviewer.channelModelKey || "已确认的审查模型");
                        return (
                            <div key={product.id} className="rounded-lg bg-surface-hover p-3 text-sm">
                                <p className="font-medium">{product.name}</p>
                                {quote ? (
                                    <>
                                        <p className="mt-1 text-xs text-foreground/60">
                                            {["planning", "redo-review"].includes(quote.scope.action)
                                                ? `目标交付：主图 ${config.hero.count} · 详情 ${config.detail.count} · 标题 ${config.titleCount}`
                                                : quote.scope.action === "append"
                                                  ? `补充策划：主图 ${quote.scope.additionalHero ?? 0} · 详情 ${quote.scope.additionalDetail ?? 0}`
                                                  : `本次：主图 ${quote.prices.find((price) => price.key === "image:hero")?.calls ?? 0} · 详情 ${quote.prices.find((price) => price.key === "image:detail")?.calls ?? 0} · 标题 ${quote.prices.some((price) => price.key === "title") ? config.titleCount : "保持"}`}
                                            {` · 上限 ${credits(quote.budgetMicrocredits)} 积分`}
                                            {config.qualityCheck && ` · 智能质检${quote.prices.some((price) => price.key === "quality") ? "已计入" : "在成图阶段另行报价"}`}
                                        </p>
                                        <p className="mt-1 text-xs text-foreground/60">
                                            规格：{config.hero.size} / {config.detail.size} · {config.language}
                                        </p>
                                        {reviewLabel && <p className="mt-1 text-xs text-foreground/60">审查模型：{reviewLabel}</p>}
                                    </>
                                ) : (
                                    <p className="mt-1 text-xs text-status-error">已跳过：{error}</p>
                                )}
                            </div>
                        );
                    })}
                </div>
                {expired && <Alert type="warning" showIcon title="报价已过期，请返回并重新报价" />}
                {error && <Alert type="warning" showIcon title={error} />}
            </div>
        </AppModal>
    );
}
