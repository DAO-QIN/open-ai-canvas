import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Spin } from "antd";
import { ArrowRight, ChevronDown, Coins, Copy, Gift, Link2, LockKeyhole, RefreshCw, UsersRound, Wallet } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { StatusBadge } from "@/components/ui/base/badges/status-badge";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { PaginationBar } from "@/components/layout/workspace-page";
import { useUserStore } from "@/stores/use-user-store";
import { ApiError } from "@/services/api/request";
import { createPromotionCode, getPromotionInvitations, getPromotionOverview, getPromotionRecords, getPromotionTransferResult, getPromotionTransfers, transferPromotion, type PromotionTransfer, type TransferRequest } from "@/services/api/promotion";
import { clearPendingPromotionTransfer, formatPromotionCredits as credits, MAX_PROMOTION_TRANSFER, parsePromotionCredits, readPendingPromotionTransfer, savePendingPromotionTransfer } from "@/lib/promotion-credits";
import { CommissionItem, InvitationItem, TransferItem } from "./record-items";
import "./promotion.css";

type RecordTab = "invites" | "records" | "transfers";
const recordTabs = [
    { value: "invites" as const, label: "已邀请" },
    { value: "records" as const, label: "返利明细" },
    { value: "transfers" as const, label: "转入记录" },
];

export default function PromotionPage() {
    const userID = useUserStore((state) => state.user?.id);
    return userID ? <PromotionWorkspace key={userID} userID={userID} /> : null;
}

function PromotionWorkspace({ userID }: { userID: string }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [recordPage, setRecordPage] = useState(1);
    const [invitePage, setInvitePage] = useState(1);
    const [transferPage, setTransferPage] = useState(1);
    const [tab, setTab] = useState<RecordTab>("invites");
    const [open, setOpen] = useState(false);
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
    const overview = useQuery({ queryKey: [...scope, "overview"], queryFn: ({ signal }) => getPromotionOverview(signal), refetchOnWindowFocus: true });
    const records = useQuery({ queryKey: [...scope, "records", recordPage], queryFn: ({ signal }) => getPromotionRecords(recordPage, signal), enabled: tab === "records" });
    const invites = useQuery({ queryKey: [...scope, "invites", invitePage], queryFn: ({ signal }) => getPromotionInvitations(invitePage, signal), enabled: tab === "invites" });
    const transfers = useQuery({ queryKey: [...scope, "transfers", transferPage], queryFn: ({ signal }) => getPromotionTransfers(transferPage, signal), enabled: tab === "transfers" });
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
        message.success(`已转入 ${credits(result.amountMicrocredits)} 积分`);
    };

    useEffect(() => {
        const controller = new AbortController();
        let request: TransferRequest | null;
        try {
            request = readPendingPromotionTransfer(userID);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : "无法读取转入记录");
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
                    message.success(`已核对上次转入：${credits(result.amountMicrocredits)} 积分`);
                })
                .catch((error) => {
                    if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 404)) {
                        message.warning("上次转入结果暂未确认，请使用原请求核对或重试");
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
                if (!overview.data || BigInt(amountMicrocredits) > BigInt(overview.data.availableMicrocredits)) throw new Error("可转入返利不足，请刷新后重试");
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
            message.error(request && !definitive ? "暂时无法确认转入结果，请稍后继续核对，避免重复转入。" : error instanceof Error ? error.message : "转入结果未确认，请继续核对");
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
            if (current()) message.error(error instanceof Error ? error.message : "生成邀请码失败");
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
    const selectedRecords = tab === "records" ? records : tab === "invites" ? invites : transfers;
    const currentPage = tab === "records" ? recordPage : tab === "invites" ? invitePage : transferPage;
    const setPage = tab === "records" ? setRecordPage : tab === "invites" ? setInvitePage : setTransferPage;
    const available = BigInt(data.availableMicrocredits);
    const maximumTransfer = credits((available > MAX_PROMOTION_TRANSFER ? MAX_PROMOTION_TRANSFER : available).toString()).replaceAll(",", "");
    let inputError = "";
    if (!pending && input.trim()) {
        try {
            if (BigInt(parsePromotionCredits(input)) > available) inputError = "金额超过可转入返利，请调整后再试。";
        } catch (error) {
            inputError = error instanceof Error ? error.message : "请输入有效积分";
        }
    }
    const copy = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            if (current()) message.success(`${label}已复制，快去分享给好友吧`);
        } catch {
            if (current()) message.error("复制失败，可选中内容手动复制");
        }
    };
    const emptyDescription = tab === "invites" ? "好友通过你的邀请码完成注册后，会显示在这里。" : tab === "records" ? "受邀好友在线充值到账后，就能看到你的返利。" : "把可用返利转入积分后，到账记录会显示在这里。";

    return (
        <main className="promotion-page">
            <div className="promotion-content">
                <header className="promotion-heading">
                    <div>
                        <h1>邀请有礼</h1>
                        <p>把好用的创作工具分享给朋友，收获更多创作积分。</p>
                    </div>
                    <div className="promotion-heading-actions">
                        <StatusBadge tone={data.canPromote && data.effectiveRatioBps > 0 ? "success" : "neutral"} label={data.canPromote ? `充值返利 ${data.effectiveRatioBps / 100}%` : "邀请暂未开放"} />
                        <Button type="text" aria-label="刷新邀请奖励" loading={overview.isFetching} icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>
                            刷新
                        </Button>
                    </div>
                </header>
                {!data.canPromote ? <Alert type="info" showIcon title={data.profile.paused ? "你的邀请功能已暂停" : "邀请活动暂未开放"} description="暂时不能邀请新好友或获得新的充值返利，已有返利仍可查看和转入积分。" /> : null}
                {overview.error ? <Alert type="error" title="数据更新失败，当前显示上次读取的结果" description={overview.error.message} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
                {storageError ? <Alert type="error" title="暂时无法转入积分" description={storageError} /> : null}
                {pending ? (
                    <Alert
                        type="warning"
                        showIcon
                        title="上次转入的结果还未确认"
                        description={`${credits(pending.amountMicrocredits)} 积分正在等待核对。继续操作会先查询结果，避免重复转入。`}
                        action={<Button onClick={() => setOpen(true)}>继续核对</Button>}
                    />
                ) : null}
                <section className="promotion-card promotion-invite" aria-labelledby="promotion-invite-title">
                    <div className="promotion-section-heading">
                        <div className="promotion-invite-intro">
                            <span className="promotion-gift-mark">
                                <Gift aria-hidden />
                            </span>
                            <div>
                                <h2 id="promotion-invite-title">邀请好友，一起创作</h2>
                                <p>
                                    好友通过你的邀请注册并在线充值，你可获得充值到账积分的 <strong>{data.effectiveRatioBps / 100}%</strong> 作为返利。
                                </p>
                            </div>
                        </div>
                        <span className="promotion-invite-count">
                            <UsersRound aria-hidden />
                            已邀请 <strong>{data.inviteCount}</strong> 人
                        </span>
                    </div>
                    {data.canPromote && data.effectiveRatioBps === 0 ? <p className="promotion-zero-ratio">当前返利比例为 0%，新充值暂不产生返利。</p> : null}
                    {code ? (
                        <div className="promotion-share-fields">
                            <div className="promotion-share-field">
                                <label htmlFor="promotion-code">我的邀请码</label>
                                <div className="promotion-copy-field">
                                    <Input id="promotion-code" readOnly value={code} />
                                    <Button disabled={!data.canPromote} aria-label="复制邀请码" icon={<Copy className="size-4" />} onClick={() => void copy(code, "邀请码")}>
                                        复制
                                    </Button>
                                </div>
                            </div>
                            <div className="promotion-share-field">
                                <label htmlFor="promotion-link">专属邀请链接</label>
                                <div className="promotion-copy-field">
                                    <Link2 aria-hidden />
                                    <Input id="promotion-link" readOnly value={invitationURL.toString()} />
                                    <Button disabled={!data.canPromote} aria-label="复制邀请链接" icon={<Copy className="size-4" />} onClick={() => void copy(invitationURL.toString(), "邀请链接")}>
                                        复制链接
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="promotion-create-code">
                            <div>
                                <strong>你的邀请，从一个专属链接开始</strong>
                                <p>生成后即可复制分享，好友也可以在注册时填写你的邀请码。</p>
                            </div>
                            <Button type="primary" disabled={!data.canPromote} loading={creating} icon={<Link2 className="size-4" />} onClick={() => void createCode()}>
                                生成我的邀请链接
                            </Button>
                        </div>
                    )}
                    <ol className="promotion-steps" aria-label="如何获得邀请奖励">
                        <li>
                            <span>01</span>
                            <div>
                                <strong>分享邀请</strong>
                                <p>把链接或邀请码发给新朋友。</p>
                            </div>
                        </li>
                        <li>
                            <span>02</span>
                            <div>
                                <strong>好友注册并充值</strong>
                                <p>注册时绑定邀请，在线充值到账后产生返利。</p>
                            </div>
                        </li>
                        <li>
                            <span>03</span>
                            <div>
                                <strong>转为创作积分</strong>
                                <p>{data.policy.freezeDays ? `新返利等待 ${data.policy.freezeDays} 天解锁后，手动转入积分。` : "返利到账即可手动转入积分。"}</p>
                            </div>
                        </li>
                    </ol>
                </section>
                <section className="promotion-card promotion-account" aria-labelledby="promotion-account-title">
                    <div className="promotion-section-heading">
                        <h2 id="promotion-account-title">
                            <Wallet aria-hidden />
                            我的返利
                        </h2>
                        <span className="promotion-muted">1 返利积分 = 1 创作积分 · 无手续费</span>
                    </div>
                    <div className="promotion-account-body">
                        <div className="promotion-available">
                            <span>可转入积分</span>
                            <strong>
                                {credits(data.availableMicrocredits)} <small>积分</small>
                            </strong>
                            <Button
                                type="primary"
                                icon={<ArrowRight className="size-4" />}
                                disabled={Boolean(storageError) || (!pending && available === BigInt(0))}
                                onClick={() => {
                                    setInput(maximumTransfer);
                                    setOpen(true);
                                }}
                            >
                                {pending ? "核对上次转入" : "转入积分"}
                            </Button>
                            <p>
                                {pending
                                    ? "先确认上次转入结果，再开始新的转入。"
                                    : storageError
                                      ? "转入暂不可用，请先核对上方提示。"
                                      : available > BigInt(0)
                                        ? "转入后即可用于站内创作，支持全部或部分转入。"
                                        : BigInt(data.frozenMicrocredits) > BigInt(0)
                                          ? "返利还在等待解锁，解锁后即可转入。"
                                          : "好友充值后，返利会显示在这里。"}
                            </p>
                        </div>
                        <div className="promotion-stats" aria-label="返利概览">
                            <div>
                                <span>
                                    <LockKeyhole aria-hidden />
                                    待解锁
                                </span>
                                <strong>
                                    {credits(data.frozenMicrocredits)} <small>积分</small>
                                </strong>
                                <p>等待期结束后自动可用</p>
                            </div>
                            <div>
                                <span>
                                    <Coins aria-hidden />
                                    累计返利
                                </span>
                                <strong>
                                    {credits(data.totalMicrocredits)} <small>积分</small>
                                </strong>
                                <p>邀请好友累计获得的返利</p>
                            </div>
                            <div>
                                <span>
                                    <Wallet aria-hidden />
                                    已转入积分
                                </span>
                                <strong>
                                    {credits(data.transferredMicrocredits)} <small>积分</small>
                                </strong>
                                <p>已成功存入积分钱包</p>
                            </div>
                        </div>
                    </div>
                </section>
                <section className="promotion-card promotion-records" aria-labelledby="promotion-records-title">
                    <div className="promotion-section-heading">
                        <div>
                            <h2 id="promotion-records-title">邀请与奖励记录</h2>
                            <p>每一次邀请和每一笔到账，都能在这里查看。</p>
                        </div>
                        <SegmentedControl<RecordTab> ariaLabel="选择记录类型" value={tab} onChange={setTab} options={recordTabs} />
                    </div>
                    <div className="promotion-record-content" role="region" aria-label={recordTabs.find((item) => item.value === tab)?.label} aria-busy={selectedRecords.isFetching}>
                        {selectedRecords.error ? (
                            <Alert type="error" title="暂时无法读取记录" description={selectedRecords.error.message} action={<Button onClick={() => void selectedRecords.refetch()}>重试</Button>} />
                        ) : selectedRecords.isPending ? (
                            <div className="promotion-record-loading">
                                <Spin />
                            </div>
                        ) : selectedRecords.data?.items.length ? (
                            <ul className="promotion-record-list">
                                {tab === "invites"
                                    ? invites.data?.items.map((item) => <InvitationItem key={item.id} invitation={item} />)
                                    : tab === "records"
                                      ? records.data?.items.map((item) => <CommissionItem key={item.id} record={item} serverNow={clock + serverOffset} />)
                                      : transfers.data?.items.map((item) => <TransferItem key={item.id} transfer={item} />)}
                            </ul>
                        ) : (
                            <EmptyState
                                size="compact"
                                icon={tab === "invites" ? UsersRound : tab === "records" ? Gift : Wallet}
                                title={tab === "invites" ? "还没有好友加入" : tab === "records" ? "还没有收到返利" : "还没有转入记录"}
                                description={emptyDescription}
                            />
                        )}
                    </div>
                    {!selectedRecords.error && selectedRecords.data ? <PaginationBar current={currentPage} pageSize={20} total={selectedRecords.data.total} pageSizeOptions={[20]} onChange={(page) => setPage(page)} /> : null}
                </section>
                <details className="promotion-card promotion-rules">
                    <summary>
                        <span>活动规则</span>
                        <ChevronDown aria-hidden />
                    </summary>
                    <ul>
                        <li>仅邀请新用户。好友须在注册时填写你的邀请码，一个账号只能绑定一位邀请人，注册后不能补绑或更换。</li>
                        <li>返利按好友在线充值实际到账的积分计算，包含套餐赠送积分。签到、注册赠送、兑换码和积分调整不产生返利。</li>
                        <li>{data.policy.freezeDays ? `当前新订单的返利等待期为 ${data.policy.freezeDays} 天，从充值积分到账时起计算。` : "当前新订单的返利到账即可使用。"} 已有返利的具体解锁时间，以返利明细为准。</li>
                        <li>返利比例和等待期在好友下单时确定，之后调整不影响该笔订单。</li>
                    </ul>
                </details>
            </div>
            <AppModal
                title={pending ? "核对上次转入" : "返利转入积分"}
                open={open}
                onCancel={() => !busy && setOpen(false)}
                onOk={() => void submit()}
                confirmLoading={busy}
                okText={pending ? "查询并重试" : "确认转入"}
                okButtonProps={{ disabled: Boolean(storageError) || (!pending && (!input.trim() || Boolean(inputError))) }}
                cancelButtonProps={{ disabled: busy }}
                closable={!busy}
                maskClosable={!busy}
            >
                <div className="promotion-transfer-form">
                    <p>{pending ? "先查询是否已到账；尚未到账时，将使用原请求重试，避免重复转入。" : "把返利存入积分钱包，即可用于下一次创作。1:1 转入，无手续费。"}</p>
                    <div className="promotion-transfer-label">
                        <label htmlFor="promotion-transfer-amount">转入积分</label>
                        <span>可转入 {credits(data.availableMicrocredits)} 积分</span>
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
                                    全部转入
                                </Button>
                            ) : (
                                "积分"
                            )
                        }
                    />
                    <p id="promotion-transfer-hint" className={inputError ? "promotion-input-error" : "promotion-muted"} role={inputError ? "alert" : undefined}>
                        {inputError || (pending ? "本次金额已锁定，请先完成核对。" : "可修改金额，支持最多六位小数。")}
                    </p>
                </div>
            </AppModal>
        </main>
    );
}
