import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Skeleton } from "antd";
import { Image, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useBlocker } from "react-router";
import type { EcommerceSettings, ProductConfig } from "@/lib/ecommerce/contracts";
import { ECOMMERCE_PLUGIN_ID } from "@/lib/ecommerce/contracts";
import { modelChoices, selectedModelKey } from "@/lib/ecommerce/models";
import { fetchEcommerceOptions, getEcommerceSettings, updateEcommerceSettings } from "@/services/api/ecommerce";
import { setPluginPlatformAvailability } from "@/services/api/plugins";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { AdminSelect, AdminSwitch } from "../ui/controls";

export default function EcommerceSettingsPage() {
    const { message, modal } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const client = useQueryClient();
    const key = ["admin", userId, "ecommerce-settings"];
    const query = useQuery({
        queryKey: key,
        queryFn: async ({ signal }) => {
            const [settings, options] = await Promise.all([getEcommerceSettings(signal), fetchEcommerceOptions(signal)]);
            return { settings, options };
        },
        enabled: Boolean(userId),
    });
    const [draft, setDraft] = useState<EcommerceSettings>();
    const [busy, setBusy] = useState(false);
    const value = draft ?? query.data?.settings;
    const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(query.data?.settings));
    const blocker = useBlocker(dirty && !busy);
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        const dialog = modal.confirm({ title: "配置还没有保存", content: "离开后将丢弃本次修改。", okText: "离开", cancelText: "继续编辑", onOk: () => blocker.proceed(), onCancel: () => blocker.reset() });
        return () => dialog.destroy();
    }, [blocker, modal]);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const invalidate = async () => {
        await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ["ecommerce", userId] }), client.invalidateQueries({ queryKey: ["admin-feature-availability"] })]);
    };
    const save = async () => {
        if (!value) return;
        setBusy(true);
        try {
            const saved = await updateEcommerceSettings(value);
            if (saved.revision !== value.revision + 1) throw new Error("保存响应不确定，请刷新核对");
            client.setQueryData(key, (old: typeof query.data) => (old ? { ...old, settings: saved } : old));
            setDraft(undefined);
            message.success("配置已保存，只影响后续创作");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            await invalidate();
            setBusy(false);
        }
    };
    const toggle = async (available: boolean) => {
        setBusy(true);
        try {
            const state = await setPluginPlatformAvailability(ECOMMERCE_PLUGIN_ID, available);
            if (state.pluginId !== ECOMMERCE_PLUGIN_ID || state.platformAvailable !== available) throw new Error("开关响应不确定，正在核对实际状态");
            message.success(available ? "商品套图已开放" : "商品套图已关闭，在途任务继续收尾");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "开关保存失败");
        } finally {
            await invalidate();
            setBusy(false);
        }
    };
    const setDefault = <K extends keyof ProductConfig>(field: K, next: ProductConfig[K]) => value && setDraft({ ...value, defaults: { ...value.defaults, [field]: next } });
    const state = query.data?.options.state;
    const texts = query.data ? modelChoices(query.data.options.catalog, "text") : [];
    const images = query.data ? modelChoices(query.data.options.catalog, "image") : [];
    const reviewKey = value?.reviewModel && (value.reviewModel.logicalModelId || (value.reviewModel.channelId && value.reviewModel.channelModelKey)) ? selectedModelKey(value.reviewModel) : undefined;
    const selected = value && images.find((choice) => choice.value === selectedModelKey(value.defaults.imageModel));
    const profile = selected?.model.capabilityConfig as { image?: { size?: { values?: string[]; presets?: { size: string }[] }; quality?: { values?: string[] } } } | undefined;
    const sizes = [...new Set([...(profile?.image?.size?.values ?? []), ...(profile?.image?.size?.presets ?? []).map((item) => item.size)])];
    return (
        <AdminPageFrame
            title="商品套图"
            description="官方创作模块的默认模型、交付规格与编排限制。"
            scroll
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} disabled={busy} onClick={() => void query.refetch()}>
                        刷新状态
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={() => void save()}>
                        保存配置
                    </Button>
                </>
            }
        >
            {query.isPending ? (
                <Skeleton active />
            ) : query.error ? (
                <div role="alert" className="admin-error-state">
                    {query.error.message}
                </div>
            ) : (
                value && (
                    <div className="admin-settings-stack shrink-0">
                        <SettingsSectionCard
                            title="平台开放"
                            icon={<Image className="size-4" />}
                            description="与功能开放、插件管理共用同一个开关。配置模型后才能开放。"
                            status={<AdminStatusBadge label={state?.platformAvailable ? "已开放" : "已关闭"} tone={state?.platformAvailable ? "success" : "neutral"} />}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                                <div>
                                    <p>关闭后暂停尚未派发的步骤，已提交任务继续存储和结算。</p>
                                    <p className="mt-2 text-sm text-[var(--admin-text-secondary)]">
                                        历史作品仍可查看、导出。重新开放后由用户手动继续。{state?.platformAvailable && !state.effectiveEnabled ? "当前账号未生效：" + (state.blockedReason || "请检查插件总开关及个人启用状态") : ""}
                                    </p>
                                </div>
                                <AdminSwitch size="sm" aria-label="商品套图平台开放" checked={state?.platformAvailable ?? false} loading={busy} disabled={dirty || busy} onChange={(enabled) => void toggle(enabled)} />
                            </div>
                        </SettingsSectionCard>
                        <SettingsSectionCard title="默认模型与交付" description="创作模型统一负责策划、细化与标题，必须理解原图；生图模型必须支持参考图。保存时由服务端校验能力、规格及价格。">
                            <div className="grid gap-4 p-4 md:grid-cols-2">
                                {(
                                    [
                                        ["planner", "创作模型", texts],
                                        ["imageModel", "生图模型", images],
                                    ] as const
                                ).map(([field, label, choices]) => (
                                    <label key={field} className="space-y-2 text-sm">
                                        {label}
                                        <AdminSelect
                                            className="w-full"
                                            ariaLabel={label}
                                            disabled={busy}
                                            value={selectedModelKey(value.defaults[field])}
                                            options={choices.map(({ value, label }) => ({ value, label }))}
                                            onChange={(id) => {
                                                const choice = choices.find((item) => item.value === id);
                                                if (choice) setDefault(field, choice.selection);
                                            }}
                                        />
                                    </label>
                                ))}
                                <label className="space-y-2 text-sm">
                                    默认风格
                                    <Input aria-label="默认风格" maxLength={1200} disabled={busy} value={value.defaults.style} onChange={(event) => setDefault("style", event.target.value)} />
                                </label>
                                {(["hero", "detail"] as const).map((kind) => (
                                    <div key={kind} className="space-y-2">
                                        <p className="font-medium">{kind === "hero" ? "主图" : "详情图"}</p>
                                        <InputNumber
                                            className="!w-full"
                                            aria-label={kind + "默认数量"}
                                            min={1}
                                            max={20}
                                            disabled={busy}
                                            value={value.defaults[kind].count}
                                            onChange={(count) => setDefault(kind, { ...value.defaults[kind], count: count ?? 1 })}
                                        />
                                        <AdminSelect
                                            className="w-full"
                                            ariaLabel={kind + "默认规格"}
                                            disabled={busy}
                                            value={value.defaults[kind].size}
                                            options={sizes.map((size) => ({ value: size, label: size }))}
                                            onChange={(size) => setDefault(kind, { ...value.defaults[kind], size })}
                                        />
                                        <AdminSelect
                                            className="w-full"
                                            ariaLabel={kind + "默认质量"}
                                            allowClear
                                            disabled={busy}
                                            value={value.defaults[kind].quality || undefined}
                                            options={(profile?.image?.quality?.values ?? []).map((quality) => ({ value: quality, label: quality }))}
                                            onChange={(quality) => setDefault(kind, { ...value.defaults[kind], quality: quality ?? "" })}
                                        />
                                        <AdminSelect
                                            className="w-full"
                                            ariaLabel={kind + "文字模式"}
                                            disabled={busy}
                                            value={value.defaults[kind].copyMode}
                                            options={[
                                                { value: "none", label: "纯图，无排版文案" },
                                                { value: "typeset", label: "图片含准确文案" },
                                            ]}
                                            onChange={(copyMode) => setDefault(kind, { ...value.defaults[kind], copyMode })}
                                        />
                                    </div>
                                ))}
                                {(
                                    [
                                        ["titleCount", "标题数量", 1, 10],
                                        ["titleMaxLength", "标题最长字符数", 10, 300],
                                    ] as const
                                ).map(([field, label, min, max]) => (
                                    <label key={field} className="space-y-2 text-sm">
                                        {label}
                                        <InputNumber className="!w-full" aria-label={label} min={min} max={max} disabled={busy} value={value.defaults[field]} onChange={(number) => setDefault(field, number ?? min)} />
                                    </label>
                                ))}
                                {(
                                    [
                                        ["platform", "目标平台"],
                                        ["market", "目标市场"],
                                        ["language", "成品语言"],
                                    ] as const
                                ).map(([field, label]) => (
                                    <label key={field} className="space-y-2 text-sm">
                                        {label}
                                        <Input aria-label={label} disabled={busy} value={value.defaults[field]} maxLength={1200} onChange={(event) => setDefault(field, event.target.value)} />
                                    </label>
                                ))}
                            </div>
                        </SettingsSectionCard>
                        <SettingsSectionCard title="智能质检" description="生成后对照原图与成图检查。模型只在后台配置，用户自主选择是否质检；费用计入生成阶段报价，不自动重生成。">
                            <div className="space-y-4 p-4">
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-sm">开放智能质检</span>
                                    <AdminSwitch
                                        aria-label="开放智能质检"
                                        checked={value.reviewAvailable ?? false}
                                        disabled={busy}
                                        onChange={(enabled) => setDraft({ ...value, reviewAvailable: enabled, defaults: { ...value.defaults, qualityCheck: enabled && Boolean(value.defaults.qualityCheck) } })}
                                    />
                                </div>
                                <label className="block space-y-2 text-sm">
                                    质检模型
                                    <AdminSelect
                                        className="w-full"
                                        ariaLabel="质检模型"
                                        disabled={busy}
                                        placeholder="选择质检模型"
                                        value={reviewKey}
                                        options={texts.map(({ value, label }) => ({ value, label }))}
                                        onChange={(id) => {
                                            const choice = texts.find((item) => item.value === id);
                                            if (choice) setDraft({ ...value, reviewModel: choice.selection });
                                        }}
                                    />
                                </label>
                                <p className="text-xs text-[var(--admin-text-secondary)]">至少支持同时理解两张图片。保存时校验能力；每次授权固定模型与价格。</p>
                                <div className="flex items-center justify-between gap-4">
                                    <span className="text-sm">新商品默认开启质检</span>
                                    <AdminSwitch aria-label="新商品默认开启质检" checked={Boolean(value.defaults.qualityCheck)} disabled={busy || !value.reviewAvailable} onChange={(enabled) => setDefault("qualityCheck", enabled)} />
                                </div>
                            </div>
                        </SettingsSectionCard>
                        <SettingsSectionCard title="批次与并发" description="这些是商品模块上限，实际执行仍受平台账号活动任务与 Worker、渠道并发限制。等待异步结果的任务持续占用容量。">
                            <div className="grid gap-4 p-4 md:grid-cols-2">
                                {(
                                    [
                                        ["batchLimit", "单批商品上限", 100],
                                        ["productConcurrency", "每用户同时推进商品", 10],
                                        ["textConcurrency", "每用户文本并发", 20],
                                        ["imageConcurrency", "每用户生图并发", 20],
                                        ["productImageConcurrency", "单商品生图并发", 20],
                                    ] as const
                                ).map(([field, label, max]) => (
                                    <label key={field} className="space-y-2 text-sm">
                                        {label}
                                        <InputNumber className="!w-full" aria-label={label} disabled={busy} min={1} max={max} value={value[field]} onChange={(number) => setDraft({ ...value, [field]: number ?? 1 })} />
                                    </label>
                                ))}
                            </div>
                        </SettingsSectionCard>
                    </div>
                )
            )}
        </AdminPageFrame>
    );
}
