import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Spin, Table, Tabs } from "antd";
import { ArrowRight, Copy, RefreshCw, UsersRound } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { useUserStore } from "@/stores/use-user-store";
import { ApiError } from "@/services/api/request";
import {
    createPromotionCode,
    getPromotionInvitations,
    getPromotionOverview,
    getPromotionRecords,
    getPromotionTransferResult,
    getPromotionTransfers,
    transferPromotion,
    type CommissionRecord,
    type PromotionTransfer,
    type TransferRequest,
} from "@/services/api/promotion";
import { clearPendingPromotionTransfer, commissionRemaining, formatPromotionCredits as credits, MAX_PROMOTION_TRANSFER, parsePromotionCredits, readPendingPromotionTransfer, savePendingPromotionTransfer } from "@/lib/promotion-credits";
import "./promotion.css";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

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
    const [tab, setTab] = useState("records");
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
            message.error(error instanceof Error ? error.message : "转入结果未确认，请核对原请求");
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

    const recordColumns = [
        { title: "产生时间", dataIndex: "createdAt", render: date },
        { title: "充值到账积分", dataIndex: "baseMicrocredits", render: credits },
        { title: "比例", dataIndex: "ratioBps", render: (value: number) => `${value / 100}%` },
        { title: "返利积分", dataIndex: "amountMicrocredits", render: credits },
        { title: "已转入", dataIndex: "transferredMicrocredits", render: credits },
        { title: "已作废", dataIndex: "voidedMicrocredits", render: (value: string, record: CommissionRecord) => <span title={record.voidReason}>{credits(value)}</span> },
        {
            title: "可用时间",
            dataIndex: "availableAt",
            render: (value: string, record: CommissionRecord) => (commissionRemaining(record) <= BigInt(0) ? "已处理" : `${new Date(value).getTime() > clock + serverOffset ? "冻结至 " : "已可用 · "}${date(value)}`),
        },
    ];

    if (overview.isPending)
        return (
            <div className="promotion-page">
                <Spin tip="正在读取邀请返利">
                    <div className="h-32" />
                </Spin>
            </div>
        );
    if (!overview.data)
        return (
            <div className="promotion-page">
                <Alert type="error" title="读取邀请返利失败" description={overview.error?.message} action={<Button onClick={() => void overview.refetch()}>重试</Button>} />
            </div>
        );
    const data = overview.data;
    const code = data.profile.inviteCode;
    const invitationURL = new URL("/register", window.location.origin);
    if (code) invitationURL.searchParams.set("inviteCode", code);
    const pageError = overview.error || (tab === "records" ? records.error : tab === "invites" ? invites.error : transfers.error);

    return (
        <main className="promotion-page">
            <header className="promotion-heading">
                <div>
                    <h1>
                        <UsersRound className="size-6" />
                        邀请返利
                    </h1>
                    <p>邀请新用户注册，每次充值到账后获得积分返利。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>
                    刷新
                </Button>
            </header>
            {!data.canPromote ? <Alert type="info" showIcon title={data.profile.paused ? "推广资格已暂停" : "邀请活动暂未开放"} description="新邀请和新订单返利已暂停，历史记录和已有返利仍可查看、转入。" /> : null}
            {pageError ? <Alert type="error" title="部分数据读取失败" description={pageError.message} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
            {storageError ? <Alert type="error" title="暂时无法转入积分" description={storageError} /> : null}
            {pending ? <Alert type="warning" showIcon title="有一笔转入请求等待核对" description={`${credits(pending.amountMicrocredits)} 积分 · ${pending.requestId}`} action={<Button onClick={() => setOpen(true)}>核对 / 重试</Button>} /> : null}
            <section className="promotion-card promotion-invite">
                <div>
                    <h2>我的推广规则</h2>
                    <p>
                        当前有效比例 <strong>{data.effectiveRatioBps / 100}%</strong> · {data.policy.freezeDays ? `冻结 ${data.policy.freezeDays} 天` : "返利立即可用"} · 已邀请 {data.inviteCount} 人
                    </p>
                    <p className="promotion-muted">规则调整仅影响之后新建的充值订单。返利包含充值套餐赠送的积分。</p>
                </div>
                <div className="promotion-code">
                    <Input aria-label="我的邀请码" readOnly value={code ?? "尚未生成邀请码"} />
                    {code ? (
                        <Button
                            disabled={!data.canPromote}
                            icon={<Copy className="size-4" />}
                            onClick={() =>
                                void navigator.clipboard
                                    .writeText(invitationURL.toString())
                                    .then(() => message.success("邀请链接已复制"))
                                    .catch(() => message.error("复制失败，请重试"))
                            }
                        >
                            复制邀请链接
                        </Button>
                    ) : (
                        <Button disabled={!data.canPromote} loading={creating} onClick={() => void createCode()}>
                            生成邀请码
                        </Button>
                    )}
                </div>
            </section>
            <section className="promotion-stats" aria-label="返利概览">
                {(
                    [
                        ["累计产生", data.totalMicrocredits],
                        ["冻结中", data.frozenMicrocredits],
                        ["可转入", data.availableMicrocredits],
                        ["已转入", data.transferredMicrocredits],
                        ["已作废", data.voidedMicrocredits],
                    ] as const
                ).map(([label, value]) => (
                    <div className="promotion-card" key={label}>
                        <span>{label}</span>
                        <strong>{credits(value)}</strong>
                        <small>积分</small>
                    </div>
                ))}
            </section>
            <div className="promotion-transfer-bar">
                <p>可用返利按 1:1 转为站内积分，无手续费。</p>
                <Button
                    type="primary"
                    icon={<ArrowRight className="size-4" />}
                    disabled={Boolean(storageError) || (!pending && BigInt(data.availableMicrocredits) === BigInt(0))}
                    onClick={() => {
                        setInput("");
                        setOpen(true);
                    }}
                >
                    {pending ? "核对上次转入" : "转入积分钱包"}
                </Button>
            </div>
            <section className="promotion-card promotion-table">
                <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    items={[
                        {
                            key: "records",
                            label: "返利明细",
                            children: (
                                <Table<CommissionRecord>
                                    rowKey="id"
                                    columns={recordColumns}
                                    dataSource={records.data?.items ?? []}
                                    loading={records.isFetching}
                                    scroll={{ x: 1050 }}
                                    locale={{ emptyText: "暂无返利记录" }}
                                    pagination={{ current: recordPage, pageSize: 20, total: records.data?.total ?? 0, showSizeChanger: false, onChange: setRecordPage }}
                                />
                            ),
                        },
                        {
                            key: "invites",
                            label: "邀请明细",
                            children: (
                                <Table
                                    rowKey="id"
                                    columns={[
                                        { title: "被邀请人", dataIndex: "displayName" },
                                        { title: "注册时间", dataIndex: "createdAt", render: date },
                                    ]}
                                    dataSource={invites.data?.items ?? []}
                                    loading={invites.isFetching}
                                    locale={{ emptyText: "暂无邀请记录" }}
                                    pagination={{ current: invitePage, pageSize: 20, total: invites.data?.total ?? 0, showSizeChanger: false, onChange: setInvitePage }}
                                />
                            ),
                        },
                        {
                            key: "transfers",
                            label: "转入记录",
                            children: (
                                <Table
                                    rowKey="id"
                                    columns={[
                                        { title: "转入时间", dataIndex: "createdAt", render: date },
                                        { title: "积分", dataIndex: "amountMicrocredits", render: credits },
                                        { title: "请求标识", dataIndex: "requestId" },
                                    ]}
                                    dataSource={transfers.data?.items ?? []}
                                    loading={transfers.isFetching}
                                    scroll={{ x: 700 }}
                                    locale={{ emptyText: "暂无转入记录" }}
                                    pagination={{ current: transferPage, pageSize: 20, total: transfers.data?.total ?? 0, showSizeChanger: false, onChange: setTransferPage }}
                                />
                            ),
                        },
                    ]}
                />
            </section>
            <AppModal
                title={pending ? "核对并重试原转入请求" : "转入积分钱包"}
                open={open}
                onCancel={() => !busy && setOpen(false)}
                onOk={() => void submit()}
                confirmLoading={busy}
                okText={pending ? "核对 / 重试" : "确认转入"}
                cancelButtonProps={{ disabled: busy }}
                closable={!busy}
                maskClosable={!busy}
            >
                <div className="space-y-4">
                    <p>
                        可转入 {credits(data.availableMicrocredits)} 积分。{pending ? "将复用上次请求，不会重复入账。" : "支持最多六位小数。"}
                    </p>
                    <Input aria-label="转入积分" inputMode="decimal" disabled={Boolean(pending) || busy} value={pending ? credits(pending.amountMicrocredits).replaceAll(",", "") : input} onChange={(event) => setInput(event.target.value)} />
                    {!pending ? (
                        <Button disabled={busy} onClick={() => setInput(credits((BigInt(data.availableMicrocredits) > MAX_PROMOTION_TRANSFER ? MAX_PROMOTION_TRANSFER : BigInt(data.availableMicrocredits)).toString()).replaceAll(",", ""))}>
                            全部转入
                        </Button>
                    ) : null}
                </div>
            </AppModal>
        </main>
    );
}
