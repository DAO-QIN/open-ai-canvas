import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, InputNumber, Switch, Tabs } from "antd";
import { RefreshCw } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { useUserStore } from "@/stores/use-user-store";
import { getFeatureAvailability } from "@/services/api/auth";
import {
    getAdminPromotionPolicy,
    getAdminPromotionProfiles,
    getAdminPromotionRecords,
    updatePromotionPolicy,
    updatePromotionProfile,
    voidPromotionCommission,
    type AdminPromotionProfile,
    type CommissionRecord,
    type PromotionPolicy,
} from "@/services/api/promotion";
import { commissionRemaining, formatPromotionCredits as credits } from "@/lib/promotion-credits";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export default function AdminPromotionPage() {
    const userID = useUserStore((state) => state.user?.id);
    return userID ? <PromotionAdmin key={userID} userID={userID} /> : null;
}

function PromotionAdmin({ userID }: { userID: string }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [tab, setTab] = useState("profiles");
    const [draft, setDraft] = useState<PromotionPolicy | null>(null);
    const [search, setSearch] = useState("");
    const [keyword, setKeyword] = useState("");
    const [profilePage, setProfilePage] = useState(1);
    const [recordsPage, setRecordsPage] = useState(1);
    const [recordUser, setRecordUser] = useState("");
    const [editing, setEditing] = useState<AdminPromotionProfile | null>(null);
    const [voiding, setVoiding] = useState<CommissionRecord | null>(null);
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [mutating, setMutating] = useState(false);
    const scope = ["admin", userID, "promotion"];
    const policy = useQuery({ queryKey: [...scope, "policy"], queryFn: ({ signal }) => getAdminPromotionPolicy(signal), refetchOnWindowFocus: false });
    const profiles = useQuery({ queryKey: [...scope, "profiles", keyword, profilePage], queryFn: ({ signal }) => getAdminPromotionProfiles(keyword, profilePage, signal), enabled: tab === "profiles" });
    const records = useQuery({ queryKey: [...scope, "records", recordUser, recordsPage], queryFn: ({ signal }) => getAdminPromotionRecords(recordUser, recordsPage, signal), enabled: tab === "records" });
    const current = () => useUserStore.getState().user?.id === userID;
    const refresh = () => client.invalidateQueries({ queryKey: ["admin", userID, "promotion"] });
    useEffect(() => {
        if (policy.data) setDraft(policy.data);
    }, [policy.data]);

    const savePolicy = async () => {
        if (!draft || !policy.data || policy.isError || saving) return;
        setSaving(true);
        try {
            const value = await updatePromotionPolicy(draft);
            if (!current()) return;
            client.setQueryData([...scope, "policy"], value);
            setDraft(value);
            message.success("规则已保存，仅影响之后新建的充值订单");
            void client.invalidateQueries({ queryKey: ["promotion", userID] });
            try {
                const { features } = await getFeatureAvailability();
                if (current()) useUserStore.getState().setFeatures(features);
            } catch {
                if (current()) message.warning("规则已保存，功能状态刷新失败，请刷新页面");
            }
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            if (current()) setSaving(false);
        }
    };

    const saveProfile = async () => {
        if (!editing || mutating) return;
        setMutating(true);
        try {
            await updatePromotionProfile(editing);
            if (current()) {
                setEditing(null);
                void refresh();
                message.success("个人推广规则已保存");
            }
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            if (current()) setMutating(false);
        }
    };
    const voidRecord = async () => {
        if (!voiding || !reason.trim() || mutating) return;
        setMutating(true);
        try {
            await voidPromotionCommission(voiding.id, reason);
            if (current()) {
                setVoiding(null);
                setReason("");
                void refresh();
                message.success("剩余未转入返利已作废");
            }
        } catch (error) {
            if (current()) message.error(error instanceof Error ? error.message : "作废失败");
        } finally {
            if (current()) setMutating(false);
        }
    };

    const error = policy.error || (tab === "profiles" ? profiles.error : records.error);
    return (
        <AdminPageFrame
            title="邀请返利"
            description="推广规则、个人比例与返利核对"
            scroll
            actions={
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>
                    重新读取
                </Button>
            }
        >
            <div className="space-y-5">
                <Alert type="info" showIcon title="规则按下单时锁定" description="只计算直接邀请人的在线充值积分返利。关闭活动或暂停个人推广后，既有订单按原规则兑现，已有返利仍可转入积分。" />
                {error ? <Alert type="error" title="读取数据失败" description={error.message} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
                <section className="admin-panel p-5 space-y-4" aria-label="全局返利规则">
                    <div className="flex items-center justify-between gap-4">
                        <h2 className="font-semibold">全局规则</h2>
                        <AdminStatusBadge label={policy.data?.enabled ? "活动开放" : "活动关闭"} tone={policy.data?.enabled ? "success" : "neutral"} />
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                        <label className="flex items-center gap-3">
                            开放邀请推广
                            <Switch aria-label="开放邀请推广" checked={draft?.enabled ?? false} disabled={!draft || policy.isError || saving} onChange={(enabled) => setDraft((value) => (value ? { ...value, enabled } : value))} />
                        </label>
                        <label className="flex items-center gap-3">
                            默认比例（%）
                            <InputNumber
                                aria-label="默认返利比例"
                                min={0}
                                max={100}
                                step={0.01}
                                precision={2}
                                value={draft ? draft.ratioBps / 100 : null}
                                disabled={!draft || policy.isError || saving}
                                onChange={(value) => {
                                    if (value !== null) setDraft((draft) => (draft ? { ...draft, ratioBps: Math.round(Number(value) * 100) } : draft));
                                }}
                            />
                        </label>
                        <label className="flex items-center gap-3">
                            启用冻结
                            <Switch aria-label="启用冻结" checked={Boolean(draft?.freezeDays)} disabled={!draft || policy.isError || saving} onChange={(enabled) => setDraft((value) => (value ? { ...value, freezeDays: enabled ? 1 : 0 } : value))} />
                        </label>
                        {Boolean(draft?.freezeDays) ? (
                            <label className="flex items-center gap-3">
                                冻结天数
                                <InputNumber
                                    aria-label="冻结天数"
                                    min={1}
                                    max={365}
                                    precision={0}
                                    value={draft?.freezeDays}
                                    disabled={saving || policy.isError}
                                    onChange={(value) => {
                                        if (value !== null) setDraft((draft) => (draft ? { ...draft, freezeDays: Number(value) } : draft));
                                    }}
                                />
                            </label>
                        ) : null}
                    </div>
                    <p className="text-sm text-[var(--muted-foreground)]">比例为 0 时不产生返利。个人覆盖比例优先于全局比例，含明确设置为 0。冻结期从充值积分到账时开始计算。</p>
                    <Button type="primary" loading={saving} disabled={!draft || policy.isError || policy.isFetching} onClick={() => void savePolicy()}>
                        保存全局规则
                    </Button>
                </section>
                <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    items={[
                        {
                            key: "profiles",
                            label: "推广人管理",
                            children: (
                                <div className="space-y-4">
                                    <Input.Search
                                        aria-label="搜索推广人"
                                        placeholder="按用户名或用户 ID 搜索"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        onSearch={() => {
                                            setKeyword(search);
                                            setProfilePage(1);
                                        }}
                                        allowClear
                                        style={{ maxWidth: 360 }}
                                    />
                                    <AdminDataTable<AdminPromotionProfile>
                                        empty={<AdminTableEmpty title="暂无匹配用户" />}
                                        table={{
                                            rowKey: "userId",
                                            loading: profiles.isFetching,
                                            dataSource: profiles.data?.items ?? [],
                                            scroll: { x: 950 },
                                            pagination: { current: profilePage, pageSize: 20, total: profiles.data?.total ?? 0, showSizeChanger: false, onChange: setProfilePage },
                                            columns: [
                                                {
                                                    title: "用户",
                                                    dataIndex: "username",
                                                    render: (value: string, row) => (
                                                        <div>
                                                            {value}
                                                            <div className="text-xs text-[var(--muted-foreground)]">{row.userId}</div>
                                                        </div>
                                                    ),
                                                },
                                                { title: "邀请码", dataIndex: "inviteCode", render: (value: string | null) => value ?? "尚未生成" },
                                                {
                                                    title: "推广状态",
                                                    dataIndex: "paused",
                                                    render: (paused: boolean, row) => <AdminStatusBadge label={row.userStatus !== "active" ? "账号禁用" : paused ? "已暂停" : "正常"} tone={row.userStatus !== "active" || paused ? "warning" : "success"} />,
                                                },
                                                { title: "个人比例", dataIndex: "ratioOverrideBps", render: (value: number | null) => (value === null ? `继承全局 ${policy.data ? `${policy.data.ratioBps / 100}%` : ""}` : `${value / 100}%`) },
                                                {
                                                    title: "操作",
                                                    key: "actions",
                                                    render: (_, row) => (
                                                        <div className="flex gap-2">
                                                            <Button size="small" onClick={() => setEditing({ ...row })}>
                                                                配置
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                onClick={() => {
                                                                    setRecordUser(row.userId);
                                                                    setRecordsPage(1);
                                                                    setTab("records");
                                                                }}
                                                            >
                                                                查看返利
                                                            </Button>
                                                        </div>
                                                    ),
                                                },
                                            ],
                                        }}
                                    />
                                </div>
                            ),
                        },
                        {
                            key: "records",
                            label: "返利明细",
                            children: (
                                <div className="space-y-4">
                                    <div className="flex gap-3 items-center">
                                        <span>{recordUser ? `推广人：${recordUser}` : "全部推广人"}</span>
                                        {recordUser ? (
                                            <Button
                                                onClick={() => {
                                                    setRecordUser("");
                                                    setRecordsPage(1);
                                                }}
                                            >
                                                查看全部
                                            </Button>
                                        ) : null}
                                    </div>
                                    <AdminDataTable<CommissionRecord>
                                        empty={<AdminTableEmpty title="暂无返利记录" />}
                                        table={{
                                            rowKey: "id",
                                            loading: records.isFetching,
                                            dataSource: records.data?.items ?? [],
                                            scroll: { x: 1150 },
                                            pagination: { current: recordsPage, pageSize: 20, total: records.data?.total ?? 0, showSizeChanger: false, onChange: setRecordsPage },
                                            columns: [
                                                {
                                                    title: "推广人 / 充值订单",
                                                    key: "source",
                                                    render: (_, row) => (
                                                        <div>
                                                            {row.inviterId}
                                                            <div className="text-xs text-[var(--muted-foreground)]">{row.paymentOrderId}</div>
                                                        </div>
                                                    ),
                                                },
                                                { title: "返利", dataIndex: "amountMicrocredits", render: credits },
                                                { title: "比例", dataIndex: "ratioBps", render: (value: number) => `${value / 100}%` },
                                                { title: "已转入", dataIndex: "transferredMicrocredits", render: credits },
                                                { title: "已作废", dataIndex: "voidedMicrocredits", render: (value: string, row) => <span title={row.voidReason}>{credits(value)}</span> },
                                                { title: "可用时间", dataIndex: "availableAt", render: date },
                                                {
                                                    title: "操作",
                                                    key: "actions",
                                                    render: (_, row) => (
                                                        <Button
                                                            size="small"
                                                            danger
                                                            disabled={commissionRemaining(row) <= BigInt(0)}
                                                            onClick={() => {
                                                                setVoiding(row);
                                                                setReason("");
                                                            }}
                                                        >
                                                            作废剩余返利
                                                        </Button>
                                                    ),
                                                },
                                            ],
                                        }}
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            </div>
            <AppModal
                title="个人推广配置"
                open={Boolean(editing)}
                onCancel={() => !mutating && setEditing(null)}
                onOk={() => void saveProfile()}
                confirmLoading={mutating}
                maskClosable={!mutating}
                closable={!mutating}
                cancelButtonProps={{ disabled: mutating }}
            >
                {editing ? (
                    <div className="space-y-4">
                        <p>
                            {editing.username} · {editing.userId}
                        </p>
                        <label className="flex items-center gap-3">
                            暂停推广
                            <Switch aria-label="暂停推广" disabled={mutating} checked={editing.paused} onChange={(paused) => setEditing({ ...editing, paused })} />
                        </label>
                        <label className="flex items-center gap-3">
                            使用个人比例
                            <Switch aria-label="使用个人比例" disabled={mutating} checked={editing.ratioOverrideBps !== null} onChange={(enabled) => setEditing({ ...editing, ratioOverrideBps: enabled ? 0 : null })} />
                        </label>
                        {editing.ratioOverrideBps !== null ? (
                            <label className="flex items-center gap-3">
                                比例（%）
                                <InputNumber
                                    aria-label="个人返利比例"
                                    disabled={mutating}
                                    min={0}
                                    max={100}
                                    precision={2}
                                    step={0.01}
                                    value={editing.ratioOverrideBps / 100}
                                    onChange={(value) => {
                                        if (value !== null) setEditing({ ...editing, ratioOverrideBps: Math.round(Number(value) * 100) });
                                    }}
                                />
                            </label>
                        ) : (
                            <p>继承全局比例。关闭个人比例后恢复继承。</p>
                        )}
                        <p>保存仅影响之后新建的充值订单；暂停推广不会扣除历史返利。</p>
                    </div>
                ) : null}
            </AppModal>
            <AppModal
                title="作废剩余返利"
                open={Boolean(voiding)}
                onCancel={() => !mutating && setVoiding(null)}
                onOk={() => void voidRecord()}
                confirmLoading={mutating}
                okButtonProps={{ danger: true, disabled: !reason.trim() }}
                okText="确认作废"
                maskClosable={!mutating}
                closable={!mutating}
                cancelButtonProps={{ disabled: mutating }}
            >
                {voiding ? (
                    <div className="space-y-4">
                        <p>当前未转入余额为 {credits(commissionRemaining(voiding).toString())} 积分。提交时以服务端剩余余额为准，已转入部分保持原记录。</p>
                        <Input.TextArea aria-label="返利作废原因" placeholder="请填写作废原因" value={reason} maxLength={500} rows={4} disabled={mutating} onChange={(event) => setReason(event.target.value)} />
                    </div>
                ) : null}
            </AppModal>
        </AdminPageFrame>
    );
}
