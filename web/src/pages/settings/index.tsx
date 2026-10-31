import { App, Button, InputNumber } from "antd";
import { SettingsRow } from "@/components/ui/product/settings-row";
import { ArrowLeft, BarChart3, Boxes, Brain, Bug, ChevronLeft, Cloud, Inbox, MessageSquareText, RadioTower, SlidersHorizontal, UserRound, Workflow } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { useMediaQuery } from "@/hooks/use-media-query";
import { refreshSystemChannels } from "@/lib/user-session";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
import { ModelDefaultGrid } from "./model-default-grid";
import { PromptPreferencesPane } from "./prompt-preferences-pane";
import DiagnosticsPanel from "./diagnostics-panel";
import AgentMemoryPane from "./agent-memory-pane";
import { RunningHubSettingsPane } from "./runninghub-settings-pane";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";
import { ProfilePane } from "./profile-pane";
import { FeedbackInboxPane } from "./feedback-inbox-pane";
import { UsageDashboardSkeleton } from "./usage-dashboard-skeleton";
import { SettingsMobileHub } from "./settings-mobile-hub";

// 用量看板只在打开时加载图表代码，不拖慢其他设置分区。
const UsageDashboardPane = lazy(() => import("./usage-dashboard-pane"));

type ConfigSectionKey = "profile" | "usage" | "channels" | "models" | "runninghub" | "preferences" | "prompts" | "agent-memory" | "storage" | "diagnostics" | "feedbacks";
type ConfigSectionGroup = "account" | "creation" | "support";

const configSections: Array<{ key: ConfigSectionKey; label: string; description: string; icon: ReactNode; group: ConfigSectionGroup }> = [
    { key: "profile", label: "个人信息", description: "头像、密码与邮箱", icon: <UserRound className="size-4" />, group: "account" },
    { key: "usage", label: "用量看板", description: "最近 365 天的积分消耗", icon: <BarChart3 className="size-4" />, group: "account" },
    { key: "channels", label: "个人渠道", description: "模型服务与个人工作流", icon: <RadioTower className="size-4" />, group: "creation" },
    { key: "runninghub", label: "RunningHub 工作流", description: "个人渠道的云端工作流配置", icon: <Workflow className="size-4" />, group: "creation" },
    { key: "models", label: "模型选择", description: "按领域选择默认模型", icon: <Boxes className="size-4" />, group: "creation" },
    { key: "preferences", label: "生成偏好", description: "画布生成默认值", icon: <SlidersHorizontal className="size-4" />, group: "creation" },
    { key: "prompts", label: "提示词偏好", description: "按任务定制平台模板", icon: <MessageSquareText className="size-4" />, group: "creation" },
    { key: "agent-memory", label: "Agent 记忆", description: "批准、添加、导出导入、压缩", icon: <Brain className="size-4" />, group: "creation" },
    { key: "storage", label: "我的对象存储", description: "管理个人媒体存储", icon: <Cloud className="size-4" />, group: "support" },
    { key: "diagnostics", label: "问题诊断", description: "导出日志协助排查", icon: <Bug className="size-4" />, group: "support" },
    { key: "feedbacks", label: "我的反馈", description: "提交问题、建议与官方答复", icon: <Inbox className="size-4" />, group: "support" },
];

const configSectionGroups: Array<{ key: ConfigSectionGroup; label: string }> = [
    { key: "account", label: "账户" },
    { key: "creation", label: "创作" },
    { key: "support", label: "数据与支持" },
];

/** 编辑器类分区需要更宽的工作区，其余分区保持易读的内容宽度。 */
const wideSections = new Set<ConfigSectionKey>(["channels", "runninghub", "prompts"]);

/** 手机「我的」页列出的分区；渠道、工作流、提示词模板、Agent 记忆、对象存储和诊断面向桌面工作流，仍可用链接直接打开。 */
const mobileHubSections = new Set<ConfigSectionKey>(["profile", "usage", "models", "preferences", "feedbacks"]);

export function isConfigSection(value: string | null): value is ConfigSectionKey {
    return configSections.some((section) => section.key === value);
}

export default function SettingsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSection = searchParams.get("section");
    // 手机上不带 section 的 /settings 是底部导航「我的」中心页；带 section 时只显示该分区和返回行。
    const compact = useMediaQuery("(max-width: 720px)");
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const runningHubPluginEnabled = runtimeStatuses[RUNNINGHUB_PLUGIN_ID] === "enabled";
    const requestedSectionEnabled = (requestedSection !== "runninghub" || runningHubPluginEnabled) && (requestedSection !== "usage" || creditsEnabled);
    const initialSection = isConfigSection(requestedSection) && requestedSectionEnabled ? requestedSection : "profile";
    const [activeTab, setActiveTab] = useState<ConfigSectionKey>(initialSection === "channels" && !customChannelsEnabled ? "models" : initialSection);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const visibleConfigSections = useMemo(
        () => configSections.filter((section) => (section.key !== "channels" || customChannelsEnabled) && (section.key !== "runninghub" || runningHubPluginEnabled) && (section.key !== "usage" || creditsEnabled)),
        [creditsEnabled, customChannelsEnabled, runningHubPluginEnabled],
    );

    const isVisibleConfigSection = (value: string | null): value is ConfigSectionKey => isConfigSection(value) && visibleConfigSections.some((section) => section.key === value);

    useEffect(() => {
        if (isVisibleConfigSection(requestedSection)) {
            setActiveTab(requestedSection);
            return;
        }
        setActiveTab(requestedSection === "channels" && !customChannelsEnabled ? "models" : "profile");
    }, [customChannelsEnabled, requestedSection, visibleConfigSections]);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? `系统模型刷新失败：${error.message}` : "系统模型刷新失败，继续使用本地缓存");
        });
        return () => {
            cancelled = true;
        };
    }, [message, userId]);

    const selectSection = (section: ConfigSectionKey) => {
        if (section === "runninghub" && !runningHubPluginEnabled) return;
        if (section === "usage" && !creditsEnabled) return;
        setActiveTab(section);
        const next = new URLSearchParams(searchParams);
        next.set("section", section);
        // 保留导航 state：手机上从「我的」进来的分区之间互相跳转后，返回仍能直接回退到「我的」。
        setSearchParams(next, { replace: true, state: location.state });
    };

    const showMobileHub = compact && !requestedSection;
    const backToHub = () => {
        if ((location.state as { fromSettingsHub?: boolean } | null)?.fromSettingsHub) navigate(-1);
        else navigate("/settings", { replace: true });
    };

    const finishConfig = () => {
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const workflowReady = Boolean(runningHubPluginEnabled && config.runningHub.enabled && config.runningHub.workflowId.trim() && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim());
        if (!effectiveConfig.channels.some(isChannelReady) && !workflowReady) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (shouldPromptContinue ? "请先完成至少一个渠道的 Base URL、API Key 和模型配置" : "当前没有可用渠道，请先完成连接信息和模型配置") : "当前没有可用的系统模型，请联系管理员配置系统渠道");
            return;
        }
        message.success("配置已保存，正在返回创作页面");
        navigate(-1);
    };

    const panes: Record<ConfigSectionKey, ReactNode> = {
        profile: (
            <SettingsPane>
                <ProfilePane key={userId} onOpenUsage={creditsEnabled ? () => selectSection("usage") : undefined} />
            </SettingsPane>
        ),
        usage: (
            <SettingsPane>
                <Suspense fallback={<UsageDashboardSkeleton />}>
                    <UsageDashboardPane key={userId} />
                </Suspense>
            </SettingsPane>
        ),
        channels: (
            <SettingsPane>
                <ChannelSettingsPane onOpenModels={() => selectSection("models")} onOpenRunningHub={runningHubPluginEnabled ? () => selectSection("runninghub") : undefined} />
            </SettingsPane>
        ),
        models: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>模型选择</h2>
                        <p>按领域选择默认模型；模型能力与请求协议在渠道“模型与能力”中配置。</p>
                    </div>
                </div>
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        runninghub: (
            <SettingsPane>
                <RunningHubSettingsPane />
            </SettingsPane>
        ),
        preferences: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>生成偏好</h2>
                        <p>设置新建生成任务时使用的初始值，节点内仍可单独覆盖。</p>
                    </div>
                </div>
                <div className="settings-section">
                    <section className="settings-preference-block">
                        <div className="settings-preference-heading">
                            <h3>画布生成</h3>
                            <p>用于新建图片生成任务，节点内仍可单独覆盖。</p>
                        </div>
                        <SettingsRow
                            label="默认生图张数"
                            control={
                                <InputNumber
                                    min={1}
                                    max={15}
                                    precision={0}
                                    className="w-full"
                                    value={Number(config.canvasImageCount)}
                                    onChange={(value) => updateConfig("canvasImageCount", normalizeImageCount(String(value ?? defaultConfig.canvasImageCount)))}
                                />
                            }
                            controlClassName="w-[200px]"
                        />
                    </section>
                </div>
            </SettingsPane>
        ),
        prompts: (
            <SettingsPane fill>
                <PromptPreferencesPane />
            </SettingsPane>
        ),
        "agent-memory": (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>Agent 记忆</h2>
                        <p>只属于你。Agent 记下的先待批准；手动添加立刻生效。可导入导出，也可用文本模型压缩相近条目。</p>
                    </div>
                </div>
                <div className="settings-section">
                    <AgentMemoryPane />
                </div>
            </SettingsPane>
        ),
        diagnostics: (
            <SettingsPane>
                <DiagnosticsPanel taskId={searchParams.get("taskId") || undefined} projectId={searchParams.get("projectId") || undefined} />
            </SettingsPane>
        ),
        storage: (
            <SettingsPane>
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
        feedbacks: (
            <SettingsPane>
                <FeedbackInboxPane />
            </SettingsPane>
        ),
    };

    const settingsNav = (
        <aside className="settings-nav-panel">
            <nav className="settings-nav" aria-label="配置分类">
                {configSectionGroups.map((group) => {
                    const items = visibleConfigSections.filter((section) => section.group === group.key);
                    if (items.length === 0) return null;
                    return (
                        <div key={group.key} className="settings-nav-group" role="group" aria-label={group.label}>
                            <span className="settings-nav-group-label" aria-hidden="true">
                                {group.label}
                            </span>
                            {items.map((item) => {
                                const selected = item.key === activeTab;
                                return (
                                    <button key={item.key} type="button" className={`settings-nav-item${selected ? " is-active" : ""}`} title={item.description} onClick={() => selectSection(item.key)} aria-current={selected ? "page" : undefined}>
                                        <span className="settings-nav-item-icon" aria-hidden="true">
                                            {item.icon}
                                        </span>
                                        <span className="settings-nav-item-label">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </nav>
        </aside>
    );

    return (
        <main className={`settings-page app-workspace-page app-user-workspace flex h-full min-h-0 flex-col text-foreground${wideSections.has(activeTab) ? " is-wide" : ""}`}>
            {shouldPromptContinue ? (
                <div className="settings-topbar shrink-0">
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate(-1)}>
                            返回创作
                        </Button>
                        <Button type="primary" onClick={finishConfig}>
                            保存并返回
                        </Button>
                    </div>
                </div>
            ) : null}
            <div className="settings-scroll app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {showMobileHub ? (
                    <div className="settings-library-frame">
                        <SettingsMobileHub sections={visibleConfigSections.filter((section) => mobileHubSections.has(section.key))} />
                    </div>
                ) : (
                    <div className="settings-library-frame">
                        {compact ? null : settingsNav}
                        <section className="settings-content" aria-label={visibleConfigSections.find((section) => section.key === activeTab)?.label}>
                            {compact ? (
                                <button type="button" className="settings-mobile-back" onClick={backToHub}>
                                    <ChevronLeft aria-hidden="true" />
                                    我的
                                </button>
                            ) : null}
                            <div className="settings-pane-root">{panes[activeTab]}</div>
                        </section>
                    </div>
                )}
            </div>
        </main>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "settings-pane is-fill" : "settings-pane"}>{children}</div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}
