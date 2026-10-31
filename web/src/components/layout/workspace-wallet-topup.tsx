import { Button, Skeleton } from "antd";
import { Check, CircleAlert, FolderOpen, HardDrive, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { PaymentBrandIcon } from "@/components/payment-brand-icons";
import { CreditIcon, formatCredits } from "@/constant/credits";
import { accountStorageMeter, accountStorageStateMessage, formatStorageCapacity, formatStorageDate, formatStorageDuration } from "@/lib/account-storage-usage";
import {
    bestValueTopupId,
    customTopupBounds,
    customTopupStops,
    defaultTopupQuantity,
    formatTopupPrice,
    isCustomTopup,
    quoteTopup,
    topupCreditsInputValue,
    topupBonusMicrocredits,
    topupPriceParts,
    topupQuantityForCredits,
    topupSavingsFen,
    topupStopIndex,
    type TopupQuote,
} from "@/lib/topup-pricing";
import { cn } from "@/lib/utils";
import type { PaymentProvider, TopupProduct, TopupProductKind } from "@/services/api/payments";
import type { AccountFileStorageUsage } from "@/services/api/resources";
import { storageGrantActive, type UserStorageGrant } from "@/services/api/storage-grants";

import "./workspace-wallet-topup.css";
import { toLayoutPx } from "@/lib/ui-scale";

export type TopupCategory = "all" | TopupProductKind;

const KIND_META: Record<TopupProductKind, { title: string; description: string; icon: LucideIcon }> = {
    credits: { title: "积分充值", description: "模型生成、Agent 与工具调用通用，按实际用量扣减", icon: CreditIcon },
    storage: { title: "存储空间", description: "扩充素材文件与 Agent 会话附件的总容量，支付后立即生效", icon: HardDrive },
};

function productAvailability(product: TopupProduct) {
    if (product.saleStatus === "upcoming") return `${product.saleStartAt ? new Date(product.saleStartAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "待定"} 开售`;
    if (product.saleStatus === "ended") return "已结束";
    if (product.saleStatus === "sold_out") return "已售罄";
    if (product.saleStrategy === "inventory") return `剩余 ${product.stockRemaining ?? 0} 份`;
    if (product.saleStrategy === "periodic") return `每 ${product.periodDays} 天限购 ${product.periodPurchaseLimit} 次`;
    if (product.saleStrategy === "timed" && product.saleEndAt) return `${new Date(product.saleEndAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 截止`;
    return "";
}

/** 一笔充值的权益摘要（结算栏用）：积分数量，或扩容容量与有效期。 */
function topupGrantLabel(product: TopupProduct, quote: TopupQuote) {
    return product.kind === "storage" ? `+${formatStorageCapacity(product.storageBytes)} · ${formatStorageDuration(product.storageDurationDays)}` : `${formatCredits(quote.creditsMicrocredits, 6)} 积分`;
}

function Price({ amountFen, currency, className }: { amountFen: number; currency?: string; className: string }) {
    const { symbol, value } = topupPriceParts(amountFen, currency);
    return (
        <span className={className}>
            <small>{symbol}</small>
            {value}
        </span>
    );
}

/**
 * 套餐卡：名称与角标 / 大号积分（或容量）/ 比自定义充值多得的积分 / 说明与限购 / 价格与立省金额。
 * 价格块贴底，同一行卡片的价格对齐；reserveSaving 为真时即使本卡没有立省金额也保留这一行，避免同行高低不齐。
 * 积分卡的“积分”单位只给读屏，画面上由闪电字形表示，数字更醒目。
 */
function ProductCard({
    product,
    selected,
    featured,
    savingsFen,
    bonusMicrocredits,
    reserveSaving,
    onSelect,
}: {
    product: TopupProduct;
    selected: boolean;
    featured: boolean;
    savingsFen: number;
    bonusMicrocredits: number;
    reserveSaving: boolean;
    onSelect: () => void;
}) {
    const Icon = KIND_META[product.kind].icon;
    const availability = productAvailability(product);
    const storage = product.kind === "storage";
    return (
        <button
            type="button"
            className={cn("wallet-topup-card", `is-${product.kind}`, selected && "is-selected", featured && "is-featured")}
            aria-pressed={selected}
            disabled={!product.canPurchase}
            title={product.description ? `${product.name}：${product.description}` : product.name}
            onClick={onSelect}
        >
            <span className="wallet-topup-card-head">
                <span className="wallet-topup-card-name">{product.name}</span>
                {featured ? <span className="wallet-topup-badge">最划算</span> : null}
                {selected ? <Check className="wallet-topup-card-check" aria-hidden="true" /> : null}
            </span>
            <span className="wallet-topup-card-value">
                <Icon className="wallet-topup-glyph" aria-hidden="true" />
                <span className="wallet-topup-card-number">{storage ? formatStorageCapacity(product.storageBytes) : formatCredits(product.creditsMicrocredits, 6)}</span>
                <span className={storage ? "wallet-topup-card-unit" : "sr-only"}>{storage ? formatStorageDuration(product.storageDurationDays) : "积分"}</span>
            </span>
            {bonusMicrocredits > 0 ? (
                <span className="wallet-topup-card-gain">
                    较自定义充值多得 <b>{formatCredits(bonusMicrocredits, 0)}</b> 积分
                </span>
            ) : null}
            {product.description || availability ? (
                <span className="wallet-topup-card-body">
                    {product.description ? <span className="wallet-topup-card-desc">{product.description}</span> : null}
                    {availability ? <span className={cn("wallet-topup-chip", !product.canPurchase && "is-muted")}>{availability}</span> : null}
                </span>
            ) : null}
            <span className="wallet-topup-card-foot">
                <Price className="wallet-topup-card-price" amountFen={product.amountFen} currency={product.currency} />
                {savingsFen > 0 ? (
                    <span className="wallet-topup-saving">
                        立省 <b>{formatTopupPrice(savingsFen, product.currency)}</b>
                    </span>
                ) : reserveSaving ? (
                    <span className="wallet-topup-saving" aria-hidden="true">
                        &nbsp;
                    </span>
                ) : null}
            </span>
        </button>
    );
}

/**
 * 自定义金额充值：滑块按档位快速选择，输入框填写任意积分（换算到最接近的整份）。
 * 任何一次拖动、输入或聚焦都会选中本商品，结算栏随之显示应付金额。
 */
function CustomTopupCard({ product, quantity, selected, onSelect, onQuantityChange }: { product: TopupProduct; quantity: number; selected: boolean; onSelect: () => void; onQuantityChange: (quantity: number) => void }) {
    const bounds = customTopupBounds(product);
    const minQuantity = bounds?.min ?? 1;
    const maxQuantity = bounds?.max ?? 1;
    const stops = useMemo(() => customTopupStops(minQuantity, maxQuantity), [minQuantity, maxQuantity]);
    const [draft, setDraft] = useState<string | null>(null);
    const purchasable = Boolean(bounds) && product.canPurchase;
    const quote = quoteTopup(product, quantity);
    const stopIndex = topupStopIndex(stops, quote.quantity);
    const progress = stops.length > 1 ? (stopIndex / (stops.length - 1)) * 100 : 100;
    const creditsLabel = formatCredits(quote.creditsMicrocredits, 6);
    const minCredits = minQuantity * product.creditsMicrocredits;
    const maxCredits = maxQuantity * product.creditsMicrocredits;
    const availability = productAvailability(product);
    const titleId = `wallet-topup-custom-${product.id}`;

    const change = (next: number) => {
        onSelect();
        onQuantityChange(next);
    };

    const commitDraft = () => {
        if (draft === null) return;
        const credits = Number(draft);
        if (draft.trim() && Number.isFinite(credits)) change(topupQuantityForCredits(product, credits));
        setDraft(null);
    };

    return (
        <div className={cn("wallet-topup-custom", selected && "is-selected", !purchasable && "is-disabled")} role="group" aria-labelledby={titleId} onClick={purchasable ? onSelect : undefined}>
            <div className="wallet-topup-custom-head">
                <span className="wallet-topup-custom-title" id={titleId}>
                    {product.name}
                    {selected ? <span className="sr-only">（已选中）</span> : null}
                </span>
                <span className="wallet-topup-custom-rate">
                    {formatTopupPrice(product.amountFen, product.currency)} = {formatCredits(product.creditsMicrocredits, 6)} 积分
                </span>
                {selected ? <Check className="wallet-topup-card-check" aria-hidden="true" /> : null}
            </div>
            <div className="wallet-topup-custom-main">
                <span className="wallet-topup-custom-amount">
                    <CreditIcon className="wallet-topup-glyph" aria-hidden="true" />
                    <strong>{creditsLabel}</strong>
                    <span className="sr-only">积分</span>
                </span>
                <Price className="wallet-topup-custom-price" amountFen={quote.amountFen} currency={product.currency} />
            </div>
            <div className="wallet-topup-custom-controls">
                <div className="wallet-topup-range">
                    <input
                        type="range"
                        min={0}
                        max={Math.max(0, stops.length - 1)}
                        step={1}
                        value={stopIndex}
                        disabled={!purchasable || stops.length < 2}
                        aria-label="拖动选择充值积分"
                        aria-valuetext={`${creditsLabel} 积分，${formatTopupPrice(quote.amountFen, product.currency)}`}
                        style={{ "--wallet-topup-range-progress": `${progress}%` } as CSSProperties}
                        onFocus={onSelect}
                        onChange={(event) => change(stops[Number(event.target.value)] ?? quote.quantity)}
                    />
                    <span className="wallet-topup-range-labels" aria-hidden="true">
                        <span>{formatCredits(minCredits, 6)} 积分</span>
                        <span>{formatCredits(maxCredits, 6)} 积分</span>
                    </span>
                </div>
                <label className="wallet-topup-custom-input">
                    <input
                        inputMode="decimal"
                        autoComplete="off"
                        value={draft ?? topupCreditsInputValue(quote.creditsMicrocredits)}
                        disabled={!purchasable}
                        aria-label="输入充值积分"
                        onFocus={(event) => {
                            onSelect();
                            setDraft(topupCreditsInputValue(quote.creditsMicrocredits));
                            event.currentTarget.select();
                        }}
                        onChange={(event) => {
                            const next = event.target.value.replace(/[^\d.]/g, "");
                            setDraft(next);
                            // 输入落在可选范围内时实时更新报价；范围外的数字等失焦后再夹到边界。
                            const credits = Number(next);
                            if (next && Number.isFinite(credits) && credits * 1_000_000 >= minCredits && credits * 1_000_000 <= maxCredits) change(topupQuantityForCredits(product, credits));
                        }}
                        onBlur={commitDraft}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                        }}
                    />
                    <span>积分</span>
                </label>
            </div>
            {availability ? <span className={cn("wallet-topup-chip", !product.canPurchase && "is-muted")}>{availability}</span> : null}
        </div>
    );
}

function TopupSection({ kind, children }: { kind: TopupProductKind; children: ReactNode }) {
    const meta = KIND_META[kind];
    return (
        <section className={cn("wallet-topup-group", `is-${kind}`)} data-topup-kind={kind} aria-labelledby={`wallet-topup-group-${kind}`}>
            <header className="wallet-topup-group-head">
                <h3 id={`wallet-topup-group-${kind}`}>{meta.title}</h3>
                <p title={meta.description}>{meta.description}</p>
            </header>
            {children}
        </section>
    );
}

function StorageSummary({ usage, grants, onCleanAssets }: { usage?: AccountFileStorageUsage; grants: UserStorageGrant[]; onCleanAssets: () => void }) {
    const meter = accountStorageMeter(usage);
    const stateMessage = accountStorageStateMessage(meter);
    const activeGrants = grants.filter((grant) => storageGrantActive(grant));
    return (
        <div className="wallet-topup-storage">
            <div className="wallet-topup-storage-usage">
                <span>
                    已用 <b>{usage ? meter.usedLabel : "--"}</b> / {usage ? meter.totalLabel : "--"}
                </span>
                <span className={cn("wallet-topup-storage-track", meter.tone !== "ok" && `is-${meter.tone}`)} role="progressbar" aria-label="账号文件容量使用进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.percent)}>
                    <span style={{ width: `${meter.percent}%` }} />
                </span>
                <span className="wallet-topup-storage-split">
                    基础 {meter.baseLabel}
                    {meter.purchasedLabel ? ` + 已购 ${meter.purchasedLabel}` : ""}
                </span>
            </div>
            {stateMessage ? (
                <div className={cn("wallet-topup-storage-alert", meter.state === "read_only" && "is-read-only")} role="status">
                    <CircleAlert aria-hidden="true" />
                    <span>{stateMessage}</span>
                    <Button size="small" icon={<FolderOpen />} onClick={onCleanAssets}>
                        清理素材
                    </Button>
                </div>
            ) : null}
            {activeGrants.length ? (
                <ul className="wallet-topup-grants" aria-label="生效中的扩容">
                    {activeGrants.slice(0, 4).map((grant) => (
                        <li key={grant.id} title={grant.productName || (grant.source === "admin" ? "管理员赠送" : "存储扩容")}>
                            +{formatStorageCapacity(grant.bytes)} · {grant.expiresAt ? `${formatStorageDate(grant.expiresAt)} 到期` : "永久"}
                        </li>
                    ))}
                    {activeGrants.length > 4 ? <li>另有 {activeGrants.length - 4} 份</li> : null}
                </ul>
            ) : null}
        </div>
    );
}

export function WalletTopupPanel({
    loading,
    products,
    providers,
    focusKind,
    focusToken,
    selectedProduct,
    selectedQuote,
    onSelectProduct,
    customQuantities,
    onCustomQuantityChange,
    selectedProviderId,
    onSelectProvider,
    creating,
    onPay,
    storageUsage,
    storageGrants,
    onCleanAssets,
}: {
    loading: boolean;
    products: TopupProduct[];
    providers: PaymentProvider[];
    /** 从容量入口进入时滚动到对应分组；focusToken 变化时重新定位。 */
    focusKind?: TopupProductKind;
    focusToken?: number;
    selectedProduct?: TopupProduct;
    /** 选中商品按当前份数算出的报价，结算栏与下单共用。 */
    selectedQuote?: TopupQuote;
    onSelectProduct: (id: string) => void;
    /** 自定义充值商品各自选择的份数；未选择过的商品使用默认份数。 */
    customQuantities: Record<string, number>;
    onCustomQuantityChange: (productId: string, quantity: number) => void;
    selectedProviderId: string;
    onSelectProvider: (id: string) => void;
    creating: boolean;
    onPay: () => void;
    storageUsage?: AccountFileStorageUsage;
    storageGrants: UserStorageGrant[];
    onCleanAssets: () => void;
}) {
    const groupsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (loading || !focusKind) return;
        const container = groupsRef.current;
        const target = container?.querySelector<HTMLElement>(`[data-topup-kind="${focusKind}"]`);
        if (!container || !target) return;
        // 只滚动分组列表本身。scrollIntoView 会连带滚动 overflow: hidden 的祖先（弹窗外壳、内容区），
        // 把页头和页签推出可视区且无法滚回。
        const top = toLayoutPx(target.getBoundingClientRect().top - container.getBoundingClientRect().top) + container.scrollTop;
        container.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, [loading, focusKind, focusToken]);

    if (loading) {
        return (
            <div className="workspace-wallet-content wallet-topup">
                <Skeleton active paragraph={{ rows: 6 }} />
            </div>
        );
    }

    const creditProducts = products.filter((item) => item.kind !== "storage");
    const packages = creditProducts.filter((item) => !isCustomTopup(item));
    const customProducts = creditProducts.filter((item) => isCustomTopup(item));
    const storageProducts = products.filter((item) => item.kind === "storage");
    const featuredId = bestValueTopupId(packages);
    // “多得 / 立省”只和同货币、配置完整的自定义充值比较；没有自定义充值时两行都不显示。
    const savingsBaseline = (currency: string) => customProducts.find((item) => item.currency === currency && customTopupBounds(item));
    const savingsById = new Map(packages.map((product) => [product.id, topupSavingsFen(product, savingsBaseline(product.currency))]));
    const bonusById = new Map(packages.map((product) => [product.id, topupBonusMicrocredits(product, savingsBaseline(product.currency))]));
    const reserveSaving = [...savingsById.values()].some((value) => value > 0);
    const selectedId = selectedProduct?.id || "";
    const selectedSavingsFen = selectedId ? (savingsById.get(selectedId) ?? 0) : 0;

    return (
        <div className="workspace-wallet-content wallet-topup">
            <div ref={groupsRef} className="wallet-topup-groups">
                {creditProducts.length ? (
                    <TopupSection kind="credits">
                        {packages.length ? (
                            <div className="wallet-topup-grid" data-count={packages.length}>
                                {packages.map((product) => (
                                    <ProductCard
                                        key={product.id}
                                        product={product}
                                        selected={selectedId === product.id}
                                        featured={featuredId === product.id}
                                        savingsFen={savingsById.get(product.id) ?? 0}
                                        bonusMicrocredits={bonusById.get(product.id) ?? 0}
                                        reserveSaving={reserveSaving}
                                        onSelect={() => onSelectProduct(product.id)}
                                    />
                                ))}
                            </div>
                        ) : null}
                        {customProducts.map((product) => (
                            <CustomTopupCard
                                key={product.id}
                                product={product}
                                quantity={customQuantities[product.id] ?? defaultTopupQuantity(product)}
                                selected={selectedId === product.id}
                                onSelect={() => {
                                    if (selectedId !== product.id) onSelectProduct(product.id);
                                }}
                                onQuantityChange={(quantity) => onCustomQuantityChange(product.id, quantity)}
                            />
                        ))}
                    </TopupSection>
                ) : null}
                {/* 存储分类即使没有商品也展示容量信息，便于用户先清理。 */}
                <TopupSection kind="storage">
                    <StorageSummary usage={storageUsage} grants={storageGrants} onCleanAssets={onCleanAssets} />
                    {storageProducts.length ? (
                        <div className="wallet-topup-grid">
                            {storageProducts.map((product) => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    selected={selectedId === product.id}
                                    featured={false}
                                    savingsFen={0}
                                    bonusMicrocredits={0}
                                    reserveSaving={false}
                                    onSelect={() => onSelectProduct(product.id)}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="wallet-topup-group-empty">暂未上架存储空间套餐</div>
                    )}
                </TopupSection>
            </div>

            {products.length ? (
                <footer className="wallet-topup-checkout">
                    <div className="wallet-topup-checkout-summary">
                        {selectedProduct && selectedQuote ? (
                            <>
                                <span className="wallet-topup-checkout-label">应付</span>
                                <Price className="wallet-topup-checkout-amount" amountFen={selectedQuote.amountFen} currency={selectedProduct.currency} />
                                <span className="wallet-topup-checkout-detail" title={`${selectedProduct.name} · ${topupGrantLabel(selectedProduct, selectedQuote)}`}>
                                    {selectedProduct.name} · {topupGrantLabel(selectedProduct, selectedQuote)}
                                    {selectedSavingsFen > 0 ? <span className="wallet-topup-checkout-saving"> · 立省 {formatTopupPrice(selectedSavingsFen, selectedProduct.currency)}</span> : null}
                                </span>
                            </>
                        ) : (
                            <span className="wallet-topup-checkout-hint">选择一个套餐</span>
                        )}
                    </div>
                    {providers.length ? (
                        <div className="wallet-topup-providers" role="radiogroup" aria-label="支付方式">
                            {providers.map((provider) => (
                                <button
                                    key={provider.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={selectedProviderId === provider.id}
                                    className={cn("wallet-topup-provider", selectedProviderId === provider.id && "is-selected")}
                                    title={provider.name}
                                    onClick={() => onSelectProvider(provider.id)}
                                >
                                    <PaymentBrandIcon providerId={provider.id} compact />
                                    <span>{provider.name}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <span className="wallet-topup-checkout-hint">暂无可用支付渠道，请联系管理员</span>
                    )}
                    <Button type="primary" size="large" className="wallet-topup-pay" loading={creating} disabled={!selectedProduct || !selectedQuote || !selectedProduct.canPurchase || !providers.length || !selectedProviderId} onClick={onPay}>
                        立即支付
                    </Button>
                </footer>
            ) : (
                <div className="workspace-wallet-inline-state">
                    <CircleAlert />
                    <div>
                        <strong>在线充值暂不可用</strong>
                        <span>当前没有已上架的套餐，请使用兑换码或联系管理员。</span>
                    </div>
                </div>
            )}
        </div>
    );
}
