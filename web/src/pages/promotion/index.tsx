import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Spin } from "antd";
import { ChevronRight, Copy, Gift, Link2, MessageSquareText, Send, UserPlus, Wallet } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { usePromotionOverview } from "@/hooks/use-promotion-overview";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { promotionDisplay } from "@/lib/promotion-display";
import { ApiError } from "@/services/api/request";
import { createPromotionCode, getPromotionInvitations, getPromotionRecords, getPromotionTransferResult, getPromotionTransfers, transferPromotion, type PromotionTransfer, type TransferRequest } from "@/services/api/promotion";
import { clearPendingPromotionTransfer, formatPromotionCredits as credits, MAX_PROMOTION_TRANSFER, parsePromotionCredits, readPendingPromotionTransfer, savePendingPromotionTransfer } from "@/lib/promotion-credits";
import { CommissionItem, InvitationItem, TransferItem } from "./record-items";
import "./promotion.css";

type RecordTab = "records" | "invites" | "transfers";
const recordTabs = [
    { value: "records" as const, label: "奖励" },
    { value: "invites" as const, label: "好友" },
    { value: "transfers" as const, label: "领取" },
];

// 首屏拼贴：AI 短剧与电商作品各半，全部来自站内已打包的灵感缩略图，不额外请求。
// focus 指定裁切焦点：竖图放进横向卡片时，商品主体不在画面中央。
type ShowcaseShot = { src: string; label: string; shape: "tall" | "wide"; focus?: string };
const showcase: ShowcaseShot[][] = [
    [
        { src: "/short-drama-styles/retro-hong-kong.jpg", label: "港风短剧", shape: "tall" },
        { src: "/inspiration-thumbs/haohaoxue/luxury-skincare-ad.webp", label: "护肤主图", shape: "wide" },
    ],
    [
        { src: "/inspiration-thumbs/haohaoxue/liquid-splash-product.webp", label: "香水大片", shape: "wide" },
        { src: "/inspiration-thumbs/haohaoxue/paris-fashion-portrait.webp", label: "服饰模特", shape: "tall" },
    ],
    [
        { src: "/short-drama-styles/cyberpunk-neon.jpg", label: "雨夜霓虹", shape: "tall" },
        { src: "/inspiration-thumbs/seedance/case-96017ad7706f.webp", label: "耳机广告", shape: "wide", focus: "60% 76%" },
    ],
];
const tapeWords = ["AI 短剧", "商品主图", "电影预告", "带货视频", "模特换装", "角色设定", "详情页", "种草海报", "分镜画布", "产品大片"];

export default function PromotionPage() {
    const userID = useUserStore((state) => state.user?.id);
    return userID ? <PromotionWorkspace key={userID} userID={userID} /> : null;
}

function PromotionWorkspace({ userID }: { userID: string }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "AI 创作平台";
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { policy: walletPolicy } = useWalletBalance(userID, creditsEnabled);
    const [recordPage, setRecordPage] = useState(1);
    const [invitePage, setInvitePage] = useState(1);
    const [transferPage, setTransferPage] = useState(1);
    const [tab, setTab] = useState<RecordTab>("records");
    const [open, setOpen] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<TransferRequest | null>(null);
    const [storageError, setStorageError] = useState("");
    const [serverOffset, setServerOffset] = useState(0);
    const [clock, setClock] = useState(Date.now());
    const submitting = useRef(false);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
        };
    }, []);
    const scope = ["promotion", userID];
    const overview = usePromotionOverview(userID);
    const { canInvite, title } = promotionDisplay(overview.data, Boolean(overview.error));
    const records = useQuery({ queryKey: [...scope, "records", recordPage], queryFn: ({ signal }) => getPromotionRecords(recordPage, signal), enabled: Boolean(overview.data) && tab === "records" });
    const invites = useQuery({ queryKey: [...scope, "invites", invitePage], queryFn: ({ signal }) => getPromotionInvitations(invitePage, signal), enabled: Boolean(overview.data) && tab === "invites" });
    const transfers = useQuery({ queryKey: [...scope, "transfers", transferPage], queryFn: ({ signal }) => getPromotionTransfers(transferPage, signal), enabled: Boolean(overview.data) && tab === "transfers" });
    const current = () => active.current && useUserStore.getState().user?.id === userID;
    const refresh = () => client.invalidateQueries({ queryKey: ["promotion", userID] });

    useEffect(() => {
        if (overview.data) setServerOffset(new Date(overview.data.serverTime).getTime() - Date.now());
    }, [overview.data]);
    useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    // Frozen balances can become available while the page stays open. The
    // server remains authoritative, including when a client's clock is wrong.
    useEffect(() => {
        const timer = window.setInterval(() => void client.invalidateQueries({ queryKey: ["promotion", userID, "overview"] }), 30_000);
        return () => window.clearInterval(timer);
    }, [client, userID]);

    const finish = (result: PromotionTransfer) => {
        if (!current()) return;
        clearPendingPromotionTransfer(userID);
        setPending(null);
        setOpen(false);
        setInput("");
        window.dispatchEvent(new CustomEvent("wallet:updated"));
        void refresh();
        message.success(`已领取 ${credits(result.amountMicrocredits)} 积分，已存入钱包`);
    };

    useEffect(() => {
        const controller = new AbortController();
        let request: TransferRequest | null;
        try {
            request = readPendingPromotionTransfer(userID);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : "无法读取领取记录");
            return;
        }
        if (request) {
            setPending(request);
            void getPromotionTransferResult(request.requestId, controller.signal)
                .then((result) => {
                    if (controller.signal.aborted || useUserStore.getState().user?.id !== userID) return;
                    clearPendingPromotionTransfer(userID);
                    setPending(null);
                    window.dispatchEvent(new CustomEvent("wallet:updated"));
                    void client.invalidateQueries({ queryKey: ["promotion", userID] });
                    message.success(`已核对上次领取：${credits(result.amountMicrocredits)} 积分`);
                })
                .catch((error) => {
                    if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 404)) {
                        message.warning("上次领取结果暂未确认，请继续核对或重试");
                    }
                });
        }
        return () => controller.abort();
    }, [client, message, userID]);

    const submit = async () => {
        if (!current() || submitting.current || storageError) return;
        submitting.current = true;
        setBusy(true);
        let request = pending;
        let attemptedWrite = false;
        try {
            request ??= readPendingPromotionTransfer(userID);
            if (request) setPending(request);
            if (!request) {
                const amountMicrocredits = parsePromotionCredits(input);
                if (!overview.data || BigInt(amountMicrocredits) > BigInt(overview.data.availableMicrocredits)) throw new Error("可领取积分不足，请刷新后重试");
                request = { requestId: crypto.randomUUID(), amountMicrocredits };
                savePendingPromotionTransfer(userID, request);
                setPending(request);
            }
            try {
                finish(await getPromotionTransferResult(request.requestId));
                return;
            } catch (error) {
                if (!(error instanceof ApiError && error.status === 404)) throw error;
            }
            if (!current()) return;
            attemptedWrite = true;
            finish(await transferPromotion(request));
        } catch (error) {
            if (!current()) return;
            const definitive = error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.reason !== "idempotency_conflict" && error.status !== 408 && error.status !== 425 && error.status !== 429;
            if (attemptedWrite && definitive && request) {
                clearPendingPromotionTransfer(userID);
                setPending(null);
                void refresh();
            }
            message.error(request && !definitive ? "暂时无法确认领取结果，请稍后继续核对，避免重复领取。" : error instanceof Error ? error.message : "领取结果未确认，请继续核对");
        } finally {
            submitting.current = false;
            if (current()) setBusy(false);
        }
    };

    const createCode = async () => {
        setCreating(true);
        try {
            await createPromotionCode();
            if (current()) await refresh();
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "生成邀请链接失败");
        } finally {
            if (current()) setCreating(false);
        }
    };

    if (overview.isPending)
        return (
            <div className="promotion-page">
                <Spin tip="正在读取邀请奖励">
                    <div className="h-32" />
                </Spin>
            </div>
        );
    if (!overview.data)
        return (
            <div className="promotion-page">
                <Alert type="error" title="暂时无法读取邀请奖励" description={overview.error?.message} action={<Button onClick={() => void overview.refetch()}>重试</Button>} />
            </div>
        );
    const data = overview.data;
    const code = data.profile.inviteCode;
    const invitationURL = new URL("/register", window.location.origin);
    if (code) invitationURL.searchParams.set("inviteCode", code);
    const ratio = data.effectiveRatioBps / 100;
    const signupBonus = creditsEnabled && walletPolicy && walletPolicy.signupBonusMicrocredits > 0 ? formatCredits(walletPolicy.signupBonusMicrocredits, 2) : "";
    const shareText = `我在用 ${brandName} 做短剧和商品图，${signupBonus ? `注册就送 ${signupBonus} 积分，` : ""}一起来玩：${invitationURL.toString()}`;
    const selectedRecords = tab === "records" ? records : tab === "invites" ? invites : transfers;
    const currentPage = tab === "records" ? recordPage : tab === "invites" ? invitePage : transferPage;
    const setPage = tab === "records" ? setRecordPage : tab === "invites" ? setInvitePage : setTransferPage;
    const available = BigInt(data.availableMicrocredits);
    const maximumTransfer = credits((available > MAX_PROMOTION_TRANSFER ? MAX_PROMOTION_TRANSFER : available).toString()).replaceAll(",", "");
    const canClaim = !storageError && (Boolean(pending) || available > BigInt(0));
    let inputError = "";
    if (!pending && input.trim()) {
        try {
            if (BigInt(parsePromotionCredits(input)) > available) inputError = "超过可领取积分，请调整后再试。";
        } catch (error) {
            inputError = error instanceof Error ? error.message : "请输入有效积分";
        }
    }
    const copy = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            if (current()) message.success(`${label}已复制，快去分享给好友吧`);
        } catch {
            if (current()) message.error("复制失败，可长按或选中内容手动复制");
        }
    };
    const openClaim = () => {
        setInput(maximumTransfer);
        setOpen(true);
    };
    const freezeText = data.policy.freezeDays ? `${data.policy.freezeDays} 天后可领` : "到账即可领";
    const emptyDescription = tab === "transfers" ? "领进钱包的积分会显示在这里。" : !canInvite ? "已有记录会显示在这里。" : tab === "invites" ? "好友用你的链接注册后，会显示在这里。" : "好友充值到账后，奖励会出现在这里。";

    return (
        <main className="promotion-page">
            <div className="promotion-content">
                {!overview.error && !canInvite ? <Alert type="info" showIcon title={data.profile.paused ? "你的邀请功能已暂停" : "邀请活动暂未开放"} description="当前暂停新邀请，已有奖励仍可查看和领取。" /> : null}
                {overview.error ? <Alert type="error" title="数据更新失败，当前显示上次读取的结果" description={overview.error.message} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
                {storageError ? <Alert type="error" title="暂时无法领取" description={storageError} /> : null}
                {pending ? (
                    <Alert
                        type="warning"
                        showIcon
                        title="上次领取的结果还未确认"
                        description={`${credits(pending.amountMicrocredits)} 积分正在等待核对。继续操作会先查询结果，避免重复领取。`}
                        action={<Button onClick={() => setOpen(true)}>继续核对</Button>}
                    />
                ) : null}

                {canInvite ? (
                    <section className="promotion-hero" aria-labelledby="promotion-hero-title">
                        <div className="promotion-collage" aria-hidden>
                            {showcase.map((column, index) => (
                                <div className="promotion-collage-col" key={index}>
                                    {column.map((item) => (
                                        <figure className={`promotion-shot is-${item.shape}`} key={item.src}>
                                            <img src={item.src} alt="" loading="lazy" decoding="async" draggable={false} style={item.focus ? { objectPosition: item.focus } : undefined} />
                                            <figcaption>{item.label}</figcaption>
                                        </figure>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="promotion-hero-fade" aria-hidden />
                        <div className="promotion-hero-copy">
                            <h1 id="promotion-hero-title">
                                邀请好友
                                <br />
                                各得积分
                            </h1>
                            <p className="promotion-hero-sub">
                                {signupBonus ? (
                                    <>
                                        好友注册得 <em>{signupBonus}</em> 积分<span className="promotion-hero-sep">，</span>
                                    </>
                                ) : null}
                                好友充值你得 <em>{ratio}%</em>
                            </p>
                            {data.effectiveRatioBps === 0 ? <p className="promotion-hero-note">当前奖励比例为 0%，新充值暂不产生奖励。</p> : null}
                            {code ? (
                                <>
                                    <div className="promotion-hero-actions">
                                        <button type="button" className="promotion-cta" disabled={!data.canPromote} onClick={() => void copy(invitationURL.toString(), "邀请链接")}>
                                            <Link2 aria-hidden />
                                            复制邀请链接
                                        </button>
                                        <button type="button" className="promotion-ghost" disabled={!data.canPromote} onClick={() => void copy(shareText, "邀请文案")}>
                                            <MessageSquareText aria-hidden />
                                            复制文案
                                        </button>
                                    </div>
                                    <button type="button" className="promotion-code" disabled={!data.canPromote} aria-label={`复制邀请码 ${code}`} onClick={() => void copy(code, "邀请码")}>
                                        <span>邀请码</span>
                                        <b>{code}</b>
                                        <Copy aria-hidden />
                                    </button>
                                </>
                            ) : (
                                <div className="promotion-hero-actions">
                                    <button type="button" className="promotion-cta" disabled={!data.canPromote || creating} aria-busy={creating} onClick={() => void createCode()}>
                                        <Link2 aria-hidden />
                                        {creating ? "正在生成" : "生成我的邀请链接"}
                                    </button>
                                </div>
                            )}
                        </div>
                        <button type="button" className="promotion-rules-link" onClick={() => setRulesOpen(true)}>
                            规则
                            <ChevronRight aria-hidden />
                        </button>
                        <div className="promotion-tape" aria-hidden>
                            <div className="promotion-tape-track">
                                {[...tapeWords, ...tapeWords].map((word, index) => (
                                    <span key={index}>
                                        {word}
                                        <i>✦</i>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : (
                    <header className="promotion-heading">
                        <h1>{title}</h1>
                        <button type="button" className="promotion-rules-link is-inline" onClick={() => setRulesOpen(true)}>
                            规则
                            <ChevronRight aria-hidden />
                        </button>
                    </header>
                )}

                <section className="promotion-kpis" aria-label="邀请收益">
                    <div className="promotion-kpi">
                        <span className="promotion-kpi-label">已邀请</span>
                        <div className="promotion-kpi-value">
                            <span>
                                <b>{data.inviteCount.toLocaleString("zh-CN")}</b>
                                <small>人</small>
                            </span>
                        </div>
                    </div>
                    <div className="promotion-kpi">
                        <span className="promotion-kpi-label">累计获得</span>
                        <div className="promotion-kpi-value">
                            <span>
                                <b>{credits(data.totalMicrocredits)}</b>
                                <small>积分</small>
                            </span>
                        </div>
                    </div>
                    <div className="promotion-kpi">
                        <span className="promotion-kpi-label">即将到账</span>
                        <div className="promotion-kpi-value">
                            <span>
                                <b>{credits(data.frozenMicrocredits)}</b>
                                <small>积分</small>
                            </span>
                        </div>
                    </div>
                    <div className="promotion-kpi is-claim">
                        <span className="promotion-kpi-label">
                            <i className="promotion-dot" aria-hidden />
                            可领取
                        </span>
                        <div className="promotion-kpi-value">
                            <span>
                                <b>{credits(data.availableMicrocredits)}</b>
                                <small>积分</small>
                            </span>
                            <button type="button" className="promotion-claim" disabled={!canClaim} onClick={pending ? () => setOpen(true) : openClaim}>
                                {pending ? "核对" : "领取"}
                            </button>
                        </div>
                    </div>
                </section>

                <div className="promotion-lower">
                    <section className="promotion-panel" aria-labelledby="promotion-flow-title">
                        <div className="promotion-panel-head">
                            <h2 id="promotion-flow-title">怎么拿奖励</h2>
                        </div>
                        <ol className="promotion-flow">
                            <li>
                                <span className="promotion-node">
                                    <Send aria-hidden />
                                </span>
                                <div>
                                    <b>发链接</b>
                                    <p>发给想玩 AI 的朋友</p>
                                </div>
                            </li>
                            <li>
                                <span className="promotion-node">
                                    <UserPlus aria-hidden />
                                </span>
                                <div>
                                    <b>好友注册</b>
                                    <p>
                                        {signupBonus ? (
                                            <>
                                                好友得 <em>{signupBonus}</em> 积分
                                            </>
                                        ) : (
                                            "用你的链接或邀请码注册"
                                        )}
                                    </p>
                                </div>
                            </li>
                            <li>
                                <span className="promotion-node">
                                    <Gift aria-hidden />
                                </span>
                                <div>
                                    <b>好友充值</b>
                                    <p>
                                        你得 <em>{ratio}%</em> 积分，每笔都算
                                    </p>
                                </div>
                            </li>
                            <li>
                                <span className="promotion-node is-end">
                                    <Wallet aria-hidden />
                                </span>
                                <div>
                                    <b>领进钱包</b>
                                    <p>{freezeText}，直接用于创作</p>
                                </div>
                            </li>
                        </ol>
                    </section>

                    <section className="promotion-panel" aria-labelledby="promotion-records-title">
                        <div className="promotion-panel-head">
                            <h2 id="promotion-records-title">记录</h2>
                            <div className="promotion-tabs" role="group" aria-label="选择记录类型">
                                {recordTabs.map((item) => (
                                    <button key={item.value} type="button" aria-pressed={tab === item.value} className={tab === item.value ? "is-active" : undefined} onClick={() => setTab(item.value)}>
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="promotion-ledger" role="region" aria-label={recordTabs.find((item) => item.value === tab)?.label} aria-busy={selectedRecords.isFetching}>
                            {selectedRecords.error ? (
                                <Alert type="error" title="暂时无法读取记录" description={selectedRecords.error.message} action={<Button onClick={() => void selectedRecords.refetch()}>重试</Button>} />
                            ) : selectedRecords.isPending ? (
                                <div className="promotion-ledger-loading">
                                    <Spin />
                                </div>
                            ) : selectedRecords.data?.items.length ? (
                                <ul>
                                    {tab === "invites"
                                        ? invites.data?.items.map((item) => <InvitationItem key={item.id} invitation={item} />)
                                        : tab === "records"
                                          ? records.data?.items.map((item) => <CommissionItem key={item.id} record={item} serverNow={clock + serverOffset} />)
                                          : transfers.data?.items.map((item) => <TransferItem key={item.id} transfer={item} />)}
                                </ul>
                            ) : (
                                <EmptyState
                                    size="compact"
                                    icon={tab === "invites" ? UserPlus : tab === "records" ? Gift : Wallet}
                                    title={tab === "invites" ? "还没有好友加入" : tab === "records" ? "还没有奖励" : "还没有领取记录"}
                                    description={emptyDescription}
                                />
                            )}
                        </div>
                        {!selectedRecords.error && selectedRecords.data ? <PaginationBar current={currentPage} pageSize={20} total={selectedRecords.data.total} pageSizeOptions={[20]} onChange={(page) => setPage(page)} /> : null}
                    </section>
                </div>
            </div>

            <AppModal title="活动规则" open={rulesOpen} onCancel={() => setRulesOpen(false)} footer={null}>
                <ul className="promotion-rules">
                    <li>仅邀请新用户。好友须在注册时使用你的邀请链接或邀请码，一个账号只能绑定一位邀请人，注册后不能补绑或更换。</li>
                    <li>好友在线充值实际到账的积分（含套餐赠送）按 {ratio}% 计算奖励，每笔都算。签到、注册赠送、兑换码和积分调整不产生奖励。</li>
                    <li>{data.policy.freezeDays ? `新奖励从充值到账起等待 ${data.policy.freezeDays} 天后可领取，` : "新奖励到账即可领取，"}领取后 1:1 存入积分钱包，无手续费。具体到账时间以记录为准。</li>
                    <li>奖励比例和等待期在好友下单时确定，之后调整不影响该笔订单。</li>
                </ul>
            </AppModal>

            <AppModal
                title={pending ? "核对上次领取" : "领进钱包"}
                open={open}
                onCancel={() => !busy && setOpen(false)}
                onOk={() => void submit()}
                confirmLoading={busy}
                okText={pending ? "查询并重试" : "确认领取"}
                okButtonProps={{ disabled: Boolean(storageError) || (!pending && (!input.trim() || Boolean(inputError))) }}
                cancelButtonProps={{ disabled: busy }}
                closable={!busy}
                maskClosable={!busy}
            >
                <div className="promotion-transfer-form">
                    <p>{pending ? "先查询是否已到账；尚未到账时，将使用原请求重试，避免重复领取。" : "1:1 存入积分钱包，无手续费，领取后即可用于创作。"}</p>
                    <div className="promotion-transfer-label">
                        <label htmlFor="promotion-transfer-amount">领取积分</label>
                        <span>可领取 {credits(data.availableMicrocredits)} 积分</span>
                    </div>
                    <Input
                        id="promotion-transfer-amount"
                        aria-describedby="promotion-transfer-hint"
                        status={inputError ? "error" : undefined}
                        inputMode="decimal"
                        disabled={Boolean(pending) || busy}
                        value={pending ? credits(pending.amountMicrocredits).replaceAll(",", "") : input}
                        onChange={(event) => setInput(event.target.value)}
                        suffix={
                            !pending ? (
                                <Button type="text" size="small" disabled={busy} onClick={() => setInput(maximumTransfer)}>
                                    全部
                                </Button>
                            ) : (
                                "积分"
                            )
                        }
                    />
                    <p id="promotion-transfer-hint" className={inputError ? "promotion-input-error" : "promotion-muted"} role={inputError ? "alert" : undefined}>
                        {inputError || (pending ? "本次数量已锁定，请先完成核对。" : "可修改数量，支持最多六位小数。")}
                    </p>
                </div>
            </AppModal>
        </main>
    );
}
