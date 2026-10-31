import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton } from "antd";
import { BarChart3, ChevronLeft, ChevronRight, CircleAlert, CreditCard, HardDrive, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { WorkspaceCreditMark } from "@/components/layout/workspace-credit-mark";
import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { AppModal } from "@/components/ui/product/app-modal";
import { CreditIcon, formatCredits } from "@/constant/credits";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { generationErrorMessage } from "@/lib/generation-error";
import { settingsPath } from "@/lib/settings-navigation";
import { listPaymentProviders, listTopupProducts, type PaymentOrder, type PaymentProvider, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { listMyStorageGrants } from "@/services/api/storage-grants";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { defaultTopupQuantity, isCustomTopup, quoteTopup } from "@/lib/topup-pricing";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

type WalletModalTab = "topup" | "redeem" | "history";

const storageGrantsQueryKey = ["account-storage-grants"] as const;

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const loggedIn = useUserStore((state) => Boolean(state.user));
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [openDetail, setOpenDetail] = useState<WorkspaceWalletOpenDetail>({});

    // 积分关闭时仍要能打开充值页购买存储空间，只是隐藏积分余额、兑换和积分记录。
    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        setOpenDetail(detail);
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/wallet") return;
        const params = new URLSearchParams(search);
        openWorkspaceWallet({
            paymentOrderId: params.get("paymentOrder") || undefined,
            paymentInvalid: params.get("payment") === "invalid",
        });
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    if (!loggedIn) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            creditsEnabled={creditsEnabled}
            initialTab={openDetail.tab}
            initialCategory={openDetail.category}
            pendingPaymentOrderId={openDetail.paymentOrderId}
            paymentInvalid={openDetail.paymentInvalid}
            onClose={() => {
                setOpen(false);
                setOpenDetail({});
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    creditsEnabled = true,
    initialTab,
    initialCategory,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    creditsEnabled?: boolean;
    initialTab?: WalletModalTab;
    initialCategory?: TopupCategory;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const requestSequence = useRef(0);
    const storageQuery = useAccountFileStorageUsage(open);
    const grantsQuery = useQuery({ queryKey: storageGrantsQueryKey, queryFn: listMyStorageGrants, enabled: open });
    const storageMeter = accountStorageMeter(storageQuery.data);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedProvider = useMemo(() => providers.find((item) => item.id === selectedProviderId), [providers, selectedProviderId]);
    // 结算栏与下单共用同一份报价：自定义充值按所选份数，固定套餐恒为 1 份。
    const selectedQuote = useMemo(
        () => (selectedProduct ? quoteTopup(selectedProduct, isCustomTopup(selectedProduct) ? (customQuantities[selectedProduct.id] ?? defaultTopupQuantity(selectedProduct)) : 1) : undefined),
        [selectedProduct, customQuantities],
    );
    const activeTab: WalletModalTab = creditsEnabled ? tab : "topup";

    const reloadWallet = async (targetPage = page) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, "all");
            if (sequence === requestSequence.current) setWallet(result);
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : "读取积分账户失败");
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    /** 读取商品与支付渠道；preferredCategory 为空时保留仍在售的当前选择。 */
    const loadPayments = (preferredCategory?: TopupCategory) => {
        setPaymentsLoading(true);
        return Promise.all([listTopupProducts(), listPaymentProviders()])
            .then(([productResult, providerResult]) => {
                const enabledProducts = productResult.products.filter((item) => item.enabled);
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                setProducts(enabledProducts);
                setProviders(usableProviders);
                // 从容量入口进入时优先选中存储空间套餐；默认选中固定套餐，自定义充值在用户拖动或输入时才选中。
                const preferred = enabledProducts.filter((item) => !preferredCategory || preferredCategory === "all" || item.kind === preferredCategory);
                const firstPurchasable = (items: TopupProduct[]) => items.find((item) => item.canPurchase && !isCustomTopup(item))?.id || items.find((item) => item.canPurchase)?.id;
                setSelectedProductId((current) => (current && enabledProducts.some((item) => item.id === current) && !preferredCategory ? current : firstPurchasable(preferred) || firstPurchasable(enabledProducts) || ""));
                setSelectedProviderId((current) => current || usableProviders[0]?.id || "");
            })
            .catch((error) => {
                message.error(error instanceof Error ? error.message : "读取充值配置失败");
            })
            .finally(() => setPaymentsLoading(false));
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1);
        void loadPayments(initialCategory);
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error("支付结果无效，未产生充值");
    }, [open, paymentInvalid]);

    const announceWalletUpdated = async () => {
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    const announceGranted = async (order: PaymentOrder) => {
        if (order.productKind === "storage") {
            await Promise.all([queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey }), queryClient.invalidateQueries({ queryKey: storageGrantsQueryKey })]);
            return;
        }
        await announceWalletUpdated();
    };

    // 报价过期时重新读取商品：自定义份数保留，金额按新价格重算，用户确认后再付。
    const payment = usePaymentOrderFlow({ onGranted: announceGranted, onQuoteChanged: () => loadPayments() });

    useEffect(() => {
        payment.resetIdempotency();
    }, [selectedProductId, selectedProviderId, selectedQuote?.quantity]);

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        void payment.showOrder(pendingPaymentOrderId);
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error("请输入完整的 32 位兑换码");
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success("兑换成功，积分已到账");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedQuote || !selectedProvider) {
            message.error("请选择套餐和支付方式");
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error("该套餐当前不可购买，请刷新后重试");
            return;
        }
        await payment.start({
            productId: selectedProduct.id,
            providerId: selectedProvider.id,
            quantity: selectedQuote.quantity,
            expectedAmountFen: selectedQuote.amountFen,
            expectedCreditsMicrocredits: selectedQuote.creditsMicrocredits,
        });
    };

    // 定位到某类套餐：滚动到分组，并在当前选中项不属于该类时改选该类第一个可买套餐。
    const focusProducts = (kind: TopupProductKind) => {
        setTab("topup");
        setFocusKind(kind);
        setFocusToken((value) => value + 1);
        if (selectedProduct?.kind === kind) return;
        const next = products.find((item) => item.kind === kind && item.canPurchase);
        if (next) setSelectedProductId(next.id);
    };

    const available = wallet?.account.availableMicrocredits ?? 0;
    const reserved = wallet?.account.reservedMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(1040px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    {/* 页头：左侧余额与容量两枚摘要（与顶栏积分入口同一标识），中间一级标签，右上角留给关闭按钮。 */}
                    <header className="workspace-wallet-header">
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <WorkspaceCreditMark className="workspace-wallet-balance-mark" />
                                    <span className="workspace-wallet-balance-text">
                                        <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                        <small>{reserved > 0 ? `可用积分 · 冻结 ${formatCredits(reserved, 6)}` : "可用积分"}</small>
                                    </span>
                                </div>
                            ) : null}
                            <button
                                type="button"
                                className={cn("workspace-wallet-balance is-storage", storageMeter.state !== "ok" && "is-alert")}
                                aria-label={storageQuery.data ? `存储空间已用 ${storageMeter.usedLabel}，共 ${storageMeter.totalLabel}，查看扩容套餐` : "查看存储空间套餐"}
                                onClick={() => focusProducts("storage")}
                            >
                                <span className="workspace-wallet-balance-icon" aria-hidden="true">
                                    <HardDrive />
                                </span>
                                <span className="workspace-wallet-balance-text">
                                    <strong>
                                        {storageQuery.data ? (
                                            <>
                                                {storageMeter.usedLabel}
                                                <span> / {storageMeter.totalLabel}</span>
                                            </>
                                        ) : (
                                            "--"
                                        )}
                                    </strong>
                                    <small>
                                        {storageMeter.state === "read_only"
                                            ? "已超额 · 只读"
                                            : storageMeter.state === "grace"
                                              ? "已超额 · 暂停上传"
                                              : storageMeter.purchasedLabel
                                                ? `存储空间 · 含已购 ${storageMeter.purchasedLabel}`
                                                : "存储空间"}
                                    </small>
                                </span>
                            </button>
                        </div>

                        {creditsEnabled ? (
                            <div className="workspace-wallet-tabs" role="tablist" aria-label="积分中心">
                                <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                                    <WalletCards />
                                    充值
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                    <TicketCheck />
                                    兑换
                                </button>
                                <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setTab("history")}>
                                    <History />
                                    积分消耗历史
                                </button>
                            </div>
                        ) : (
                            <h2 className="workspace-wallet-title">购买存储空间</h2>
                        )}
                    </header>

                    {activeTab === "topup" ? (
                        <WalletTopupPanel
                            loading={paymentsLoading}
                            products={products}
                            providers={providers}
                            focusKind={focusKind}
                            focusToken={focusToken}
                            selectedProduct={selectedProduct}
                            selectedQuote={selectedQuote}
                            onSelectProduct={setSelectedProductId}
                            customQuantities={customQuantities}
                            onCustomQuantityChange={(productId, quantity) => setCustomQuantities((current) => (current[productId] === quantity ? current : { ...current, [productId]: quantity }))}
                            selectedProviderId={selectedProviderId}
                            onSelectProvider={setSelectedProviderId}
                            creating={payment.creating}
                            onPay={() => void startPayment()}
                            storageUsage={storageQuery.data}
                            storageGrants={grantsQuery.data?.grants || []}
                            onCleanAssets={() => {
                                onClose();
                                navigate("/assets");
                            }}
                        />
                    ) : activeTab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>兑换码</h3>
                                        <p>
                                            购买后请复制卡密，返回此处兑换。
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    获取兑换码
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder="输入 32 位兑换码" onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        确认兑换
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>积分消耗历史</h3>
                                    <p>包含充值、兑换、生成消费、冻结与退款。</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        type="text"
                                        icon={<BarChart3 />}
                                        onClick={() => {
                                            onClose();
                                            navigate(settingsPath("usage"));
                                        }}
                                    >
                                        用量看板
                                    </Button>
                                    <Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>
                                        刷新
                                    </Button>
                                </div>
                            </div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>记录加载失败</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>重试</Button>
                                    </div>
                                ) : walletLoading && !wallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : wallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {wallet.entries.map((entry) => (
                                            <WalletLedgerRow key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>还没有积分记录</strong>
                                        <span>完成充值、兑换或生成任务后，记录会显示在这里。</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>
                                    第 {page} / {totalPages} 页
                                </span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label="上一页"
                                    onClick={() => {
                                        const next = page - 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronLeft />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || walletLoading}
                                    aria-label="下一页"
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            {payment.dialog}
        </>
    );
}

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const positive = entry.amountMicrocredits > 0;
    const note = entry.note ? generationErrorMessage(entry.note) : "";
    // 创作 Agent 联网搜索的按次账单：模型和场景都是内部编码 web_search，换成用户看得懂的说法。
    const webSearch = entry.model === "web_search";
    const title =
        entry.type === "consume"
            ? webSearch
                ? "联网搜索"
                : "模型调用"
            : entry.type === "refund"
              ? "消费退款"
              : entry.type === "payment_topup"
                ? "在线充值"
                : entry.type === "promotion_transfer"
                  ? "邀请奖励领取"
                  : entry.type === "redeem"
                    ? "兑换码充值"
                    : note || "积分调整";
    const detail = webSearch ? [entry.type === "consume" ? "创作 Agent 按次搜索" : "联网搜索", note] : [entry.scene, entry.model, note];
    return (
        <article className="workspace-wallet-ledger-row">
            <span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <CreditIcon /> : <CreditCard />}</span>
            <div>
                <strong>{title}</strong>
                <span>{detail.filter(Boolean).join(" · ") || "积分账户变动"}</span>
            </div>
            <time>{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
            <b className={positive ? "is-income" : "is-consume"}>
                {positive ? "+" : ""}
                {formatCredits(entry.amountMicrocredits, 6)}
            </b>
        </article>
    );
}
