import { App, Button, Form, Input, InputNumber, Skeleton } from "antd";
import { AlertTriangle, BookOpenText, ExternalLink, Globe, KeyRound, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { Select, Switch } from "@/pages/admin/ui/controls";
import {
    getAdminWebSearchSetting,
    testAdminWebSearchSetting,
    updateAdminWebSearchSetting,
    type AdminWebSearchSetting,
    type AdminWebSearchSettingInput,
    type WebReaderProvider,
    type WebSearchProvider,
    type WebSearchTestResult,
    type WebSearchZhipuEngine,
} from "@/services/api/auth";
import { refreshWebSearchSession } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

/** 表单里未选服务时用 undefined，Select 才会显示占位提示；价格在表单里按积分填写，保存时换成微积分。 */
type WebSearchForm = Omit<AdminWebSearchSettingInput, "provider" | "priceMicrocredits"> & { provider?: WebSearchProvider; priceCredits?: number | null };

const PROVIDERS: Array<{ value: WebSearchProvider; label: string; hint: string; link: { href: string; label: string } }> = [
    {
        value: "deepseek",
        label: "DeepSeek 搜索（国内推荐）",
        hint: "DeepSeek 自研搜索引擎，结果带给模型读的长摘要。只按有结果的成功请求计费，没有结果或请求失败不收费；与 DeepSeek 模型共用 API Key。",
        link: { href: "https://platform.deepseek.com/api_keys", label: "DeepSeek 开放平台" },
    },
    { value: "bocha", label: "博查（国内）", hint: "国内直连，中文网页覆盖好，按次计费。", link: { href: "https://open.bochaai.com", label: "博查开放平台" } },
    { value: "metaso", label: "秘塔 AI 搜索（国内）", hint: "中文检索质量高，结果带发布日期，按次计费。", link: { href: "https://metaso.cn/search-api/playground", label: "秘塔搜索 API" } },
    { value: "zhipu", label: "智谱 Web Search（国内）", hint: "与智谱模型共用 API Key；基础版价格最低，高阶版结果更全。", link: { href: "https://open.bigmodel.cn", label: "智谱开放平台" } },
    { value: "tavily", label: "Tavily（海外）", hint: "面向 AI 检索，英文结果好；服务器需能访问境外网络。", link: { href: "https://app.tavily.com", label: "Tavily 控制台" } },
    { value: "serper", label: "Serper · Google 结果（海外）", hint: "返回 Google 搜索结果；服务器需能访问境外网络。", link: { href: "https://serper.dev", label: "Serper 控制台" } },
    {
        value: "searxng",
        label: "SearXNG（开源自建，免费）",
        hint: "开源元搜索，自建后不需要 API Key；在 settings.yml 的 search.formats 中启用 json。内网地址需加入 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS。",
        link: { href: "https://docs.searxng.org", label: "SearXNG 部署文档" },
    },
];

const ZHIPU_ENGINES: Array<{ value: WebSearchZhipuEngine; label: string }> = [
    { value: "search_std", label: "基础版 search_std（最便宜）" },
    { value: "search_pro", label: "高阶版 search_pro" },
    { value: "search_pro_sogou", label: "搜狗 search_pro_sogou" },
    { value: "search_pro_quark", label: "夸克 search_pro_quark" },
];

const READERS: Array<{ value: WebReaderProvider; label: string }> = [
    { value: "", label: "不启用（只由服务端直接读取）" },
    { value: "deepseek", label: "DeepSeek Fetch（按成功次数计费）" },
    { value: "jina", label: "Jina Reader（云端或自建开源版）" },
];

const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
const DEEPSEEK_FETCH_URL = "https://api.deepseek.com/v1/tools/fetch";

const PAGE_TITLE = "联网搜索";
const PAGE_DESCRIPTION = "为创作 Agent 提供网页搜索与网页读取；网页读取默认由服务端直接完成";
const DEFAULT_DAILY_LIMIT = 100;
/** 每人每分钟联网调用次数的默认值与上限，与服务端一致。 */
const DEFAULT_PER_MINUTE_LIMIT = 30;
const MAX_PER_MINUTE_LIMIT = 600;
/** 每次搜索价格上限（积分），与服务端一致。 */
const MAX_PRICE_CREDITS = 10_000;
const INVALID_PRICE = -1;

export default function WebSearchSettingsPage() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<AdminWebSearchSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [testQuery, setTestQuery] = useState("AI 短剧 创作趋势");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<WebSearchTestResult | null>(null);
    const [testError, setTestError] = useState("");
    const [readerUrl, setReaderUrl] = useState("https://example.com");
    const [readerTesting, setReaderTesting] = useState(false);
    const [readerResult, setReaderResult] = useState<WebSearchTestResult["reader"] | null>(null);
    const [readerError, setReaderError] = useState("");
    const [form] = Form.useForm<WebSearchForm>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    // 「向用户开放」一节在服务配置完整前不挂载；preserve 让草稿始终包含开关、次数和价格，不按缺省值误判。
    const watchedValues = Form.useWatch([], { form, preserve: true }) as Partial<WebSearchForm> | undefined;

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminWebSearchSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isAdminWebSearchSetting(result.setting)) throw new Error("服务端返回的联网搜索配置格式无效");
                setSetting(result.setting);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取联网搜索配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取联网搜索配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (loading || !setting) return;
        form.setFieldsValue(toFormValues(setting));
    }, [form, loading, setting]);

    const blocker = useBlocker(dirty && !saving);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);
    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        modal.confirm({
            title: "放弃联网搜索调整？",
            content: "当前页面有尚未保存的搜索服务或密钥草稿，离开后这些内容会丢失。服务端正在使用的配置不会改变。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        form.setFieldsValue(toFormValues(setting));
        form.setFields([]);
        setDirty(false);
        setSaveError("");
        message.info("已撤销联网搜索的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前的搜索服务和密钥草稿，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const submitSave = async () => {
        if (!setting) return;
        let values: WebSearchForm;
        try {
            await form.validateFields();
            // 校验只覆盖已挂载的字段；保存要带上全部草稿，未挂载的「向用户开放」字段沿用已读取的值。
            values = form.getFieldsValue(true) as WebSearchForm;
        } catch {
            return;
        }
        const payload = normalizePayload(values);
        const validationError =
            validateDraft(payload, setting, payload.enabled) || validateReaderDraft(payload, setting) || (payload.priceMicrocredits === INVALID_PRICE ? `每次搜索消耗的积分须在 0 到 ${MAX_PRICE_CREDITS.toLocaleString("zh-CN")} 之间` : "");
        if (validationError) {
            message.error(validationError);
            return;
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminWebSearchSetting(payload);
            if (
                !isAdminWebSearchSetting(result.setting) ||
                result.setting.enabled !== payload.enabled ||
                result.setting.provider !== payload.provider ||
                result.setting.readerProvider !== payload.readerProvider ||
                result.setting.perMinuteLimit !== payload.perMinuteLimit ||
                result.setting.priceMicrocredits !== payload.priceMicrocredits
            ) {
                throw new Error("服务端返回的联网搜索配置与本次保存内容不一致，请重新读取后核对");
            }
            setSetting(result.setting);
            form.setFieldsValue(toFormValues(result.setting));
            setDirty(false);
            // 管理员自己的创作页立即按新状态显示「联网」开关，不用重新登录；每次搜索的价格按本账号分组折算，以服务端为准。
            useUserStore.getState().setWebSearchEnabled(result.setting.enabled);
            void refreshWebSearchSession().catch(() => undefined);
            message.success(result.setting.enabled ? "联网搜索已保存，新发起的创作对话会使用它" : "联网搜索配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存联网搜索配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const runTest = async () => {
        if (!setting || testing) return;
        const payload = normalizePayload(form.getFieldsValue(true));
        const validationError = validateDraft(payload, setting, true);
        if (validationError) {
            setTestError(validationError);
            setTestResult(null);
            return;
        }
        setTesting(true);
        setTestError("");
        setTestResult(null);
        try {
            setTestResult(await testAdminWebSearchSetting({ ...payload, target: "search", query: testQuery.trim() }));
        } catch (error) {
            setTestError(error instanceof Error ? error.message : "测试搜索失败");
        } finally {
            setTesting(false);
        }
    };

    const runReaderTest = async () => {
        if (!setting || readerTesting) return;
        const payload = normalizePayload(form.getFieldsValue(true));
        const readerDraftError = payload.readerProvider ? validateReaderDraft(payload, setting) : "请先选择网页读取增强服务";
        if (readerDraftError) {
            setReaderError(readerDraftError);
            setReaderResult(null);
            return;
        }
        setReaderTesting(true);
        setReaderError("");
        setReaderResult(null);
        try {
            const result = await testAdminWebSearchSetting({ ...payload, target: "reader", url: readerUrl.trim() });
            if (!result.reader) throw new Error("读取服务没有返回测试结果");
            setReaderResult(result.reader);
        } catch (error) {
            setReaderError(error instanceof Error ? error.message : "测试读取失败");
        } finally {
            setReaderTesting(false);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title={PAGE_TITLE} description={PAGE_DESCRIPTION} scroll>
                <div className="admin-settings-stack admin-ark-settings" aria-label="正在读取联网搜索配置" role="status">
                    <div className="admin-ark-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
                    </div>
                    <div className="admin-ark-loading-card">
                        <Skeleton active paragraph={{ rows: 6 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title={PAGE_TITLE} description={PAGE_DESCRIPTION} scroll>
                <div className="admin-settings-stack admin-ark-settings">
                    <div className="admin-ark-load-error" role="alert">
                        <span className="admin-ark-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取联网搜索配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    const draft = normalizePayload(watchedValues || form.getFieldsValue(true));
    const provider = PROVIDERS.find((item) => item.value === draft.provider);
    const keyKept = searchKeyKept(draft, setting);
    const readerKeyKept = readerSavedKeyKept(draft, setting);
    const readerSharesKey = deepseekReaderSharesSearchKey(draft, setting);
    const ready = !validateDraft(draft, setting, true);

    return (
        <AdminPageFrame title={PAGE_TITLE} description={PAGE_DESCRIPTION} scroll>
            <div className="admin-settings-stack admin-ark-settings">
                <div className={cn("admin-ark-command-bar", dirty && "is-dirty")}>
                    <div className="admin-ark-command-copy" aria-live="polite">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{dirty ? "联网搜索有调整待保存" : "联网搜索配置已同步"}</strong>
                            <AdminStatusBadge label={dirty ? "尚未生效" : setting.enabled ? "已启用" : "未启用"} tone={dirty ? "warning" : setting.enabled ? "success" : "neutral"} />
                        </div>
                    </div>
                    <div className="admin-ark-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                撤销调整
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            刷新状态
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || refreshing} onClick={() => void submitSave()}>
                            保存修改
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-ark-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    disabled={refreshing || saving}
                    onValuesChange={(changed: Partial<WebSearchForm>) => {
                        // 用全部草稿判断改动：未挂载的「向用户开放」字段（开关、次数、价格）不能按缺省值算成"有改动"。
                        let nextValues = form.getFieldsValue(true) as WebSearchForm;
                        // 自定义地址只对当时选的服务有意义：换服务后清空，避免把新服务的请求发到旧地址。
                        if ("provider" in changed && nextValues.baseUrl) {
                            form.setFieldValue("baseUrl", "");
                            nextValues = { ...nextValues, baseUrl: "" };
                        }
                        if ("readerProvider" in changed && nextValues.readerBaseUrl) {
                            form.setFieldValue("readerBaseUrl", "");
                            nextValues = { ...nextValues, readerBaseUrl: "" };
                        }
                        // 服务没配完整时不能保持开启，避免保存出一个模型看得见却搜不了的工具。
                        if (nextValues.enabled && validateDraft(normalizePayload(nextValues), setting, true)) {
                            form.setFieldValue("enabled", false);
                            nextValues = { ...nextValues, enabled: false };
                        }
                        setDirty(hasChanges(nextValues, setting));
                        setSaveError("");
                        setTestResult(null);
                        setTestError("");
                        setReaderResult(null);
                        setReaderError("");
                    }}
                >
                    <SettingsSectionCard
                        className="admin-ark-section"
                        icon={<KeyRound className="size-4" aria-hidden="true" />}
                        title="1. 选择搜索服务"
                        description="密钥加密保存在服务端，只在后端发起搜索时使用，不会下发到浏览器。国内部署建议选 DeepSeek，也可以选博查、秘塔或智谱；不想付费可以自建 SearXNG。"
                        status={<AdminStatusBadge label={ready ? "已配置" : "待配置"} tone={ready ? "success" : "neutral"} />}
                    >
                        <div className="admin-ark-form-grid">
                            <Form.Item
                                name="provider"
                                label="搜索服务"
                                extra={
                                    provider ? (
                                        <span className="admin-web-search-hint">
                                            {provider.hint}
                                            <a href={provider.link.href} target="_blank" rel="noopener noreferrer">
                                                {provider.link.label}
                                                <ExternalLink className="size-3" aria-hidden="true" />
                                            </a>
                                        </span>
                                    ) : undefined
                                }
                            >
                                <Select<WebSearchProvider> ariaLabel="搜索服务" placeholder="选择搜索服务" options={PROVIDERS.map((item) => ({ value: item.value, label: item.label }))} />
                            </Form.Item>
                            <Form.Item name="maxResults" label="每次返回结果数" extra="Agent 每次搜索最多拿到的网页数，1 到 10。">
                                <InputNumber min={1} max={10} precision={0} className="w-full" />
                            </Form.Item>
                            {draft.provider === "zhipu" ? (
                                <Form.Item name="engine" label="智谱搜索引擎" extra="不同引擎按次价格不同，以智谱开放平台的价格为准。">
                                    <Select<WebSearchZhipuEngine> ariaLabel="智谱搜索引擎" options={ZHIPU_ENGINES} />
                                </Form.Item>
                            ) : null}
                            <Form.Item
                                name="apiKey"
                                label={keyKept ? `API Key（${configuredSecretText}）` : draft.provider === "searxng" ? "API Key（可选）" : "API Key"}
                                extra={keyKept ? "搜索服务和地址不变时留空可保留原密钥。" : draft.provider === "searxng" ? "实例开启了鉴权时填写，会作为 Bearer 令牌发送。" : setting.hasApiKey ? "换了搜索服务或接口地址，需要重新填写密钥。" : undefined}
                            >
                                <Input.Password autoComplete="new-password" placeholder={keyKept ? "留空保留原密钥" : "仅保存在服务端"} />
                            </Form.Item>
                            <Form.Item
                                name="baseUrl"
                                label={draft.provider === "searxng" ? "SearXNG 地址" : "自定义接口地址（可选）"}
                                extra={draft.provider === "searxng" ? "例如 https://search.example.com，会自动补上 /search。" : "使用官方地址时留空；仅在走代理或私有网关时填写完整接口地址。"}
                            >
                                <Input autoComplete="off" placeholder={draft.provider === "searxng" ? "https://search.example.com" : "留空使用官方地址"} />
                            </Form.Item>
                        </div>
                    </SettingsSectionCard>

                    {ready || draft.enabled ? (
                        <SettingsSectionCard
                            className="admin-ark-section"
                            icon={<Globe className="size-4" aria-hidden="true" />}
                            title="2. 向用户开放"
                            description="开启后，新发起的创作对话可以联网搜索，用户可以在输入框的「联网」开关里自行关闭；进行中的对话不受影响。"
                            status={<AdminStatusBadge label={draft.enabled ? "开启" : "关闭"} tone={draft.enabled ? "success" : "neutral"} />}
                        >
                            <div className="admin-ark-policy-control">
                                <div className="admin-ark-policy-copy">
                                    <strong>允许 Agent 联网搜索</strong>
                                    <p>每人每分钟最多 {draft.perMinuteLimit} 次联网调用（含网页读取）。10 分钟内相同的搜索直接复用结果，不再请求搜索服务，不扣积分，也不计入每日次数。</p>
                                </div>
                                <div className="admin-ark-policy-switch">
                                    <span>{draft.enabled ? "开启" : "关闭"}</span>
                                    <Form.Item name="enabled" valuePropName="checked" noStyle>
                                        <Switch aria-label="允许 Agent 联网搜索，保存修改后生效" />
                                    </Form.Item>
                                </div>
                            </div>
                            <div className="admin-ark-form-grid">
                                <Form.Item name="dailyLimit" label="每人每天搜索次数" extra="超过后当天不再联网搜索，Agent 会告诉用户明天再试；用于控制搜索费用。">
                                    <InputNumber min={1} max={10000} precision={0} className="w-full" />
                                </Form.Item>
                                <Form.Item
                                    name="perMinuteLimit"
                                    label="每人每分钟联网次数"
                                    rules={[{ validator: (_, value) => (isPerMinuteLimit(value) ? Promise.resolve() : Promise.reject(new Error(`请输入 1 到 ${MAX_PER_MINUTE_LIMIT} 之间的整数`))) }]}
                                    extra="搜索和网页读取合计，复用的结果也算；超过后这一分钟内暂停联网，Agent 会提示稍后再试。用于防止短时间内反复请求。"
                                >
                                    <InputNumber min={1} max={MAX_PER_MINUTE_LIMIT} precision={0} className="w-full" />
                                </Form.Item>
                                <Form.Item
                                    name="priceCredits"
                                    label="每次搜索消耗积分"
                                    rules={[
                                        {
                                            validator: (_, value) => (priceMicrocreditsFromCredits(value) === INVALID_PRICE ? Promise.reject(new Error(`请输入 0 到 ${MAX_PRICE_CREDITS.toLocaleString("zh-CN")} 之间的积分`)) : Promise.resolve()),
                                        },
                                    ]}
                                    extra={creditsEnabled ? "只对搜到结果的搜索扣用户积分，会乘用户分组倍率；搜索失败、没有结果或复用结果不扣。0 表示免费，网页读取不扣积分。" : "当前未开启积分功能，搜索暂不扣费；开启后按这里的价格扣积分。"}
                                >
                                    <InputNumber min={0} max={MAX_PRICE_CREDITS} precision={6} step={0.01} className="w-full" />
                                </Form.Item>
                            </div>
                        </SettingsSectionCard>
                    ) : null}

                    {ready ? (
                        <SettingsSectionCard className="admin-ark-section" icon={<Search className="size-4" aria-hidden="true" />} title="3. 测试搜索" description="用当前表单里的配置实际搜一次，不会保存配置。">
                            <div className="admin-web-search-test">
                                <div className="admin-web-search-test-row">
                                    <Input value={testQuery} maxLength={200} aria-label="测试关键词" placeholder="输入测试关键词" onChange={(event) => setTestQuery(event.target.value)} onPressEnter={() => void runTest()} />
                                    <Button icon={<Search className="size-4" />} loading={testing} disabled={!testQuery.trim() || saving} onClick={() => void runTest()}>
                                        测试搜索
                                    </Button>
                                </div>
                                {testError ? (
                                    <div className="admin-ark-inline-alert" role="alert">
                                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                                        <span>{testError}</span>
                                    </div>
                                ) : null}
                                {testResult ? (
                                    testResult.results.length ? (
                                        <ol className="admin-web-search-results" aria-label="测试搜索结果">
                                            {testResult.results.map((item) => (
                                                <li key={item.url}>
                                                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                                                        {item.title}
                                                        <ExternalLink className="size-3.5" aria-hidden="true" />
                                                    </a>
                                                    <span>{item.siteName || hostname(item.url)}</span>
                                                    {item.snippet ? <p>{item.snippet}</p> : null}
                                                </li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className="admin-web-search-empty" role="status">
                                            搜索服务可以访问，但这个关键词没有结果，换一个关键词再试。
                                        </p>
                                    )
                                ) : null}
                            </div>
                        </SettingsSectionCard>
                    ) : null}

                    <SettingsSectionCard
                        className="admin-ark-section"
                        icon={<BookOpenText className="size-4" aria-hidden="true" />}
                        title="网页读取增强（可选）"
                        description="网页读取不需要配置：服务端会直接读取公开网页。很多页面靠脚本渲染或会拒绝服务器访问，配置读取服务后，直接读不到正文的网页会交给它再读一次；只有这部分网页会用到读取服务。"
                        status={<AdminStatusBadge label={draft.readerProvider ? "已启用" : "未启用"} tone={draft.readerProvider ? "success" : "neutral"} />}
                    >
                        <div className="admin-ark-form-grid">
                            <Form.Item name="readerProvider" label="读取服务">
                                <Select<WebReaderProvider> ariaLabel="网页读取增强服务" options={READERS} />
                            </Form.Item>
                            {draft.readerProvider === "deepseek" ? (
                                <>
                                    <Form.Item
                                        name="readerApiKey"
                                        label={readerKeyKept ? `DeepSeek API Key（${configuredSecretText}）` : readerSharesKey ? "DeepSeek API Key（可选）" : "DeepSeek API Key"}
                                        extra={
                                            readerKeyKept
                                                ? "读取服务和地址不变时留空可保留原密钥。"
                                                : readerSharesKey
                                                  ? "留空时共用上面搜索服务的 DeepSeek API Key。"
                                                  : "在 DeepSeek 开放平台创建；搜索服务也选 DeepSeek 时可以留空，共用同一个 Key。只有读到正文才计费，读不到不收费；不支持 PDF 和 Office 文件。"
                                        }
                                    >
                                        <Input.Password autoComplete="new-password" placeholder={readerKeyKept ? "留空保留原密钥" : readerSharesKey ? "留空共用搜索服务的 Key" : "仅保存在服务端"} />
                                    </Form.Item>
                                    <Form.Item name="readerBaseUrl" label="自定义接口地址（可选）" extra="使用官方地址时留空；仅在走代理或私有网关时填写完整接口地址。">
                                        <Input autoComplete="off" placeholder={DEEPSEEK_FETCH_URL} />
                                    </Form.Item>
                                </>
                            ) : draft.readerProvider === "jina" ? (
                                <>
                                    <Form.Item
                                        name="readerApiKey"
                                        label={readerKeyKept ? `Jina API Key（${configuredSecretText}）` : "Jina API Key（可选）"}
                                        extra={readerKeyKept ? "读取服务和地址不变时留空可保留原密钥。" : "不填也能用，但所有用户共享服务器的匿名额度（约每分钟 20 次）；填写后额度更高。自建开源版不需要。能读脚本渲染的页面和 PDF。"}
                                    >
                                        <Input.Password autoComplete="new-password" placeholder={readerKeyKept ? "留空保留原密钥" : "仅保存在服务端"} />
                                    </Form.Item>
                                    <Form.Item
                                        name="readerBaseUrl"
                                        label="读取服务地址（可选）"
                                        extra="留空使用 Jina 云端 r.jina.ai。自建开源版（ghcr.io/jina-ai/reader:oss）填它的 HTTP 地址；内网地址需加入 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS，并且读取服务本身不能访问内网。"
                                    >
                                        <Input autoComplete="off" placeholder="https://r.jina.ai" />
                                    </Form.Item>
                                </>
                            ) : null}
                        </div>
                        {draft.readerProvider ? (
                            <div className="admin-web-search-test">
                                <div className="admin-web-search-test-row">
                                    <Input value={readerUrl} maxLength={2000} aria-label="测试网页地址" placeholder="输入要读取的网页地址" onChange={(event) => setReaderUrl(event.target.value)} onPressEnter={() => void runReaderTest()} />
                                    <Button icon={<BookOpenText className="size-4" />} loading={readerTesting} disabled={!readerUrl.trim() || saving} onClick={() => void runReaderTest()}>
                                        测试读取
                                    </Button>
                                </div>
                                {readerError ? (
                                    <div className="admin-ark-inline-alert" role="alert">
                                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                                        <span>{readerError}</span>
                                    </div>
                                ) : null}
                                {readerResult ? (
                                    <div className="admin-web-search-reader" role="status">
                                        <strong>{readerResult.title || hostname(readerResult.url)}</strong>
                                        <span>{`读到 ${readerResult.chars.toLocaleString("zh-CN")} 字`}</span>
                                        {readerResult.excerpt ? <p>{readerResult.excerpt}</p> : null}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </SettingsSectionCard>
                </Form>
            </div>
        </AdminPageFrame>
    );
}

function hostname(value: string) {
    try {
        return new URL(value).hostname;
    } catch {
        return value;
    }
}

function toFormValues(setting: AdminWebSearchSetting): WebSearchForm {
    return {
        enabled: setting.enabled,
        provider: setting.provider || undefined,
        baseUrl: setting.baseUrl || "",
        apiKey: "",
        maxResults: setting.maxResults || 5,
        engine: setting.engine || "search_std",
        dailyLimit: setting.dailyLimit || DEFAULT_DAILY_LIMIT,
        perMinuteLimit: setting.perMinuteLimit || DEFAULT_PER_MINUTE_LIMIT,
        priceCredits: setting.priceMicrocredits / 1_000_000,
        readerProvider: setting.readerProvider || "",
        readerBaseUrl: setting.readerBaseUrl || "",
        readerApiKey: "",
    };
}

function isPerMinuteLimit(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PER_MINUTE_LIMIT;
}

/** 表单里的积分换成微积分；空值或越界返回 INVALID_PRICE，由校验拦下，绝不当作免费保存。 */
function priceMicrocreditsFromCredits(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PRICE_CREDITS) return INVALID_PRICE;
    const microcredits = Math.round(value * 1_000_000);
    return Number.isSafeInteger(microcredits) ? microcredits : INVALID_PRICE;
}

function normalizePayload(values: Partial<WebSearchForm>): AdminWebSearchSettingInput {
    const maxResults = Number(values.maxResults);
    const dailyLimit = Number(values.dailyLimit);
    const readerProvider: WebReaderProvider = values.readerProvider === "deepseek" || values.readerProvider === "jina" ? values.readerProvider : "";
    return {
        enabled: Boolean(values.enabled),
        provider: values.provider || "",
        baseUrl: values.baseUrl?.trim() || "",
        apiKey: values.apiKey?.trim() || "",
        maxResults: Number.isInteger(maxResults) && maxResults >= 1 && maxResults <= 10 ? maxResults : 5,
        engine: values.provider === "zhipu" ? values.engine || "search_std" : "",
        dailyLimit: Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 10000 ? dailyLimit : DEFAULT_DAILY_LIMIT,
        // 空值或越界时按默认值展示；保存前由表单校验拦下，不会把非法输入静默存成默认值。
        perMinuteLimit: isPerMinuteLimit(values.perMinuteLimit) ? values.perMinuteLimit : DEFAULT_PER_MINUTE_LIMIT,
        priceMicrocredits: priceMicrocreditsFromCredits(values.priceCredits),
        readerProvider,
        readerBaseUrl: readerProvider ? values.readerBaseUrl?.trim().replace(/\/+$/, "") || "" : "",
        readerApiKey: readerProvider ? values.readerApiKey?.trim() || "" : "",
    };
}

function hasChanges(values: Partial<WebSearchForm>, setting: AdminWebSearchSetting) {
    const draft = normalizePayload(values);
    const saved = normalizePayload(toFormValues(setting));
    return (
        draft.apiKey !== "" ||
        draft.readerApiKey !== "" ||
        draft.enabled !== saved.enabled ||
        draft.provider !== saved.provider ||
        draft.baseUrl !== saved.baseUrl ||
        draft.maxResults !== saved.maxResults ||
        draft.engine !== saved.engine ||
        draft.dailyLimit !== saved.dailyLimit ||
        draft.perMinuteLimit !== saved.perMinuteLimit ||
        draft.priceMicrocredits !== saved.priceMicrocredits ||
        draft.readerProvider !== saved.readerProvider ||
        draft.readerBaseUrl !== saved.readerBaseUrl
    );
}

/** 已保存的密钥只在服务和地址都不变时沿用，与服务端规则一致。 */
function searchKeyKept(draft: AdminWebSearchSettingInput, setting: AdminWebSearchSetting) {
    return setting.hasApiKey && draft.provider === setting.provider && draft.baseUrl === setting.baseUrl;
}

function readerSavedKeyKept(draft: AdminWebSearchSettingInput, setting: AdminWebSearchSetting) {
    return setting.readerHasApiKey && draft.readerProvider === setting.readerProvider && draft.readerBaseUrl === setting.readerBaseUrl;
}

function endpointOrigin(value: string) {
    try {
        const parsed = new URL(value);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return "";
    }
}

/** DeepSeek 读取没填密钥时沿用 DeepSeek 搜索的密钥，前提是两者发往同一服务地址（与服务端规则一致）。 */
function deepseekReaderSharesSearchKey(draft: AdminWebSearchSettingInput, setting: AdminWebSearchSetting) {
    if (draft.readerProvider !== "deepseek" || draft.provider !== "deepseek" || !(draft.apiKey || searchKeyKept(draft, setting))) return false;
    const origin = endpointOrigin(draft.baseUrl || DEEPSEEK_SEARCH_URL);
    return Boolean(origin) && origin === endpointOrigin(draft.readerBaseUrl || DEEPSEEK_FETCH_URL);
}

/** 启用或测试时要求配置完整；只是保存关闭状态时允许留空。 */
function validateDraft(draft: AdminWebSearchSettingInput, setting: AdminWebSearchSetting, requireReady: boolean) {
    if (!requireReady) return "";
    if (!draft.provider) return "请选择搜索服务";
    if (draft.provider === "searxng") return draft.baseUrl ? "" : "请填写 SearXNG 地址";
    if (!draft.apiKey && !searchKeyKept(draft, setting)) return "请填写搜索服务的 API Key";
    return "";
}

/** 读取增强与搜索开关无关，选了 DeepSeek 就必须有可用的密钥。 */
function validateReaderDraft(draft: AdminWebSearchSettingInput, setting: AdminWebSearchSetting) {
    if (draft.readerProvider !== "deepseek" || draft.readerApiKey || readerSavedKeyKept(draft, setting) || deepseekReaderSharesSearchKey(draft, setting)) return "";
    return "请填写 DeepSeek API Key；搜索服务也选 DeepSeek 时可以留空，共用同一个 Key";
}

function isAdminWebSearchSetting(value: unknown): value is AdminWebSearchSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<AdminWebSearchSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        typeof setting.provider === "string" &&
        typeof setting.baseUrl === "string" &&
        typeof setting.hasApiKey === "boolean" &&
        typeof setting.maxResults === "number" &&
        typeof setting.dailyLimit === "number" &&
        isPerMinuteLimit(setting.perMinuteLimit) &&
        typeof setting.priceMicrocredits === "number" &&
        Number.isSafeInteger(setting.priceMicrocredits) &&
        setting.priceMicrocredits >= 0 &&
        typeof setting.readerProvider === "string" &&
        typeof setting.readerHasApiKey === "boolean"
    );
}
