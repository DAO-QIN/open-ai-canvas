import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/settings?section=usage" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { MemoryRouter } = await import("react-router");
const { default: UsageDashboardPane } = await import("../../src/pages/settings/usage-dashboard-pane");
const { ProfilePane } = await import("../../src/pages/settings/profile-pane");
const { apiClient } = await import("../../src/services/api/request");
const { defaultFeatureAvailability, useUserStore } = await import("../../src/stores/use-user-store");
import type { ReactNode } from "react";
import type { LocalUser } from "../../src/services/api/auth";
import type { CreditUsageReport } from "../../src/services/api/wallet";

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const user: LocalUser = {
    id: "usage-user",
    username: "creator",
    displayName: "Creator",
    role: "user",
    status: "active",
    avatarMode: "default",
    avatarPreset: "spirit-v1-01",
    createdAt: "2026-09-12T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
};

const report: CreditUsageReport = {
    from: "2025-10-29",
    to: "2026-10-28",
    days: 365,
    timezoneOffset: 480,
    daily: [
        { date: "2026-10-01", totalMicrocredits: 34_000_000, agentMicrocredits: 30_000_000, count: 9, agentCount: 6 },
        { date: "2026-10-02", totalMicrocredits: 14_000_000, agentMicrocredits: 0, count: 3, agentCount: 0 },
    ],
    categories: [
        { capability: "video", totalMicrocredits: 30_000_000, agentMicrocredits: 25_000_000, count: 3, agentCount: 2 },
        { capability: "image", totalMicrocredits: 18_000_000, agentMicrocredits: 5_000_000, count: 9, agentCount: 4 },
    ],
    // 与 categories 对得上：图片 = Nano Banana Pro + 名称缺失的 seedream-4。
    models: [
        { model: "veo-3", name: "Veo 3", capability: "video", totalMicrocredits: 30_000_000, agentMicrocredits: 25_000_000, count: 3, agentCount: 2 },
        { model: "nano-banana-pro", name: "Nano Banana Pro", capability: "image", totalMicrocredits: 12_000_000, agentMicrocredits: 5_000_000, count: 6, agentCount: 4 },
        { model: "seedream-4", name: "", capability: "image", totalMicrocredits: 6_000_000, agentMicrocredits: 0, count: 3, agentCount: 0 },
    ],
};

type MockConfig = { url: string; params?: Record<string, unknown> };
type MockResponse = { data: unknown; status: number };

const originalRequest = apiClient.request;
const calls: string[] = [];
let respond: (config: MockConfig) => MockResponse = () => {
    throw new Error("mock not configured");
};
apiClient.request = (async (config: MockConfig) => {
    calls.push(config.url);
    return respond(config);
}) as typeof apiClient.request;

afterEach(() => {
    calls.length = 0;
    useUserStore.setState({ user: null, features: defaultFeatureAvailability });
});
afterAll(() => {
    apiClient.request = originalRequest;
});

const ok = (data: unknown): MockResponse => ({ data: { code: 0, data, msg: "ok" }, status: 200 });
const tick = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
    });
const normalize = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((node) => normalize(node.textContent));
// AntD 会在两个汉字的按钮文字之间插入空格，按钮按去掉空白后的文字匹配。
const button = (root: ParentNode, text: string) => Array.from(root.querySelectorAll("button")).find((item) => (item.textContent || "").replace(/\s/g, "") === text)!;
const radio = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((item) => normalize(item.textContent) === text)!;

async function mount(node: ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <ConfigProvider theme={{ token: { motion: false } }}>
                        <App>{node}</App>
                    </ConfigProvider>
                </MemoryRouter>
            </QueryClientProvider>,
        ),
    );
    await tick();
    return {
        host,
        async unmount() {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}

async function press(target: Element, key: string, times = 1) {
    for (let index = 0; index < times; index += 1) {
        await act(async () => {
            target.dispatchEvent(new dom.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as Event);
        });
    }
}

const live = (host: HTMLElement) => normalize(host.querySelector('.usage-chart [aria-live="polite"]')?.textContent);

test("看板展示统计、整年热力图与构成，可切换口径和视图，并用键盘与悬停逐项查看", async () => {
    useUserStore.getState().setUser(user);
    let usageParams: Record<string, unknown> | undefined;
    respond = (config) => {
        if (config.url === "/wallet/usage") {
            usageParams = config.params;
            return ok(report);
        }
        throw new Error(`Unexpected API: ${config.url}`);
    };
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("wallet:open", onOpen);
    const view = await mount(<UsageDashboardPane />);
    const { host } = view;
    try {
        expect(usageParams).toEqual({ tzOffset: -new Date().getTimezoneOffset() });
        expect(normalize(host.querySelector("h2")?.textContent)).toBe("用量看板");
        expect(normalize(host.querySelector(".usage-scope-identity strong")?.textContent)).toBe("Creator · 最近 365 天");
        expect(normalize(host.querySelector(".usage-scope-identity strong + span")?.textContent)).toBe("2025年10月29日 – 2026年10月28日");
        expect(texts(host, ".usage-stat-label")).toEqual(["总消耗", "单日峰值", "周均消耗", "活跃天数", "最长连续活跃"]);
        expect(texts(host, ".usage-stat-value")).toEqual(["48积分", "34积分", "0.92积分", "2天", "2天"]);
        expect(texts(host, ".usage-stat-hint")).toEqual(["共 12 笔", "10月1日 周四", "按 52 周折算", "占全年 0.5%", "今天还没有消耗"]);

        expect(host.querySelectorAll("[data-day]")).toHaveLength(365);
        expect(host.querySelectorAll(".usage-heatmap .usage-cell.is-padding")).toHaveLength(6);
        expect(host.querySelector('[data-day="337"]')?.getAttribute("data-level")).toBe("4");
        expect(host.querySelector('[data-day="338"]')?.getAttribute("data-level")).toBe("1");
        expect(host.querySelector('[data-day="0"]')?.getAttribute("data-level")).toBe("0");
        expect(texts(host, ".usage-months span")[0]).toBe("11月");
        expect(texts(host, ".usage-breakdown-name")).toEqual(["视频", "图片"]);
        expect(texts(host, ".usage-breakdown-share")).toEqual(["62.5%", "37.5%"]);
        expect(normalize(host.querySelector(".usage-panel-footer")?.textContent)).toContain("365 天中有 2 天产生消耗");

        // 悬停单日：提示框与读屏文本同步。
        const october2 = host.querySelector('[data-day="338"]')!;
        await act(async () => {
            october2.dispatchEvent(new (dom.PointerEvent ?? dom.MouseEvent)("pointermove", { bubbles: true }) as unknown as Event);
        });
        expect(live(host)).toBe("10月2日 周五，14 积分 · 3 笔");
        expect(normalize(host.querySelector(".usage-tooltip")?.textContent)).toBe("10月2日 周五14 积分 · 3 笔");
        expect(october2.getAttribute("data-active")).toBe("true");

        // 切到 Agent 用量。
        await act(async () => radio(host, "Agent 用量").click());
        expect(radio(host, "Agent 用量").getAttribute("aria-checked")).toBe("true");
        expect(host.querySelector(".usage-tooltip")).toBeNull();
        expect(texts(host, ".usage-stat-label")[0]).toBe("Agent 总消耗");
        expect(texts(host, ".usage-stat-value")).toEqual(["30积分", "30积分", "0.58积分", "1天", "1天"]);
        expect(texts(host, ".usage-breakdown-share")).toEqual(["83.3%", "16.7%"]);
        expect(host.querySelector('[data-day="338"]')?.getAttribute("data-level")).toBe("0");

        // 每日热力图：End 到今天，左移 4 周、下移 1 天到 10 月 1 日。
        const scroller = host.querySelector(".usage-chart-scroll")!;
        await press(scroller, "End");
        expect(live(host)).toBe("10月28日 周三，无消耗");
        await press(scroller, "ArrowLeft", 4);
        await press(scroller, "ArrowDown");
        expect(live(host)).toBe("10月1日 周四，30 积分 · 6 笔");
        expect(normalize(host.querySelector(".usage-tooltip")?.textContent)).toContain("30 积分 · 6 笔");
        await press(scroller, "Escape");
        expect(host.querySelector(".usage-tooltip")).toBeNull();
        expect(live(host)).toBe("");

        // 每周柱状图。
        await act(async () => radio(host, "每周").click());
        expect(host.querySelector(".usage-chart")?.getAttribute("data-view")).toBe("weekly");
        expect(host.querySelectorAll(".usage-bar")).toHaveLength(53);
        await press(scroller, "End");
        expect(live(host)).toBe("10月26日 – 10月28日，本周无消耗");
        await press(scroller, "ArrowLeft", 4);
        expect(live(host)).toBe("9月28日 – 10月4日，30 积分 · 6 笔");
        expect(normalize(host.querySelector(".usage-panel-footer")?.textContent)).toContain("每列为一周");

        // 累计曲线。
        await act(async () => radio(host, "累计").click());
        expect(host.querySelector(".usage-area-line")?.getAttribute("d")).toStartWith("M ");
        await press(scroller, "End");
        expect(live(host)).toBe("10月28日 周三，累计 30 积分，当日无消耗");
        expect(normalize(host.querySelector(".usage-panel-footer")?.textContent)).toContain("截至今天累计消耗 30 积分");

        await act(async () => button(host, "消耗明细").click());
        expect(opened).toEqual([{ tab: "history" }]);
        expect(calls.filter((url) => url === "/wallet/usage")).toHaveLength(1);
    } finally {
        window.removeEventListener("wallet:open", onOpen);
        await view.unmount();
    }
});

test("消耗构成可按模型查看：前台名称、类型标签、平均每笔与占比，跟随统计口径切换", async () => {
    useUserStore.getState().setUser(user);
    respond = (config) => {
        if (config.url !== "/wallet/usage") throw new Error(`Unexpected API: ${config.url}`);
        return ok(report);
    };
    const view = await mount(<UsageDashboardPane />);
    const { host } = view;
    const meta = () => Array.from(host.querySelectorAll(".usage-model-row")).map((row) => texts(row, ".usage-model-meta > *").join("|"));
    try {
        expect(radio(host, "按类型").getAttribute("aria-checked")).toBe("true");
        expect(host.querySelector(".usage-model-list")).toBeNull();

        await act(async () => radio(host, "按模型").click());
        expect(radio(host, "按模型").getAttribute("aria-checked")).toBe("true");
        expect(host.querySelector(".usage-breakdown-list")).toBeNull();
        expect(normalize(host.querySelector("#usage-breakdown-title + p")?.textContent)).toBe("按模型汇总最近 365 天的积分消耗，并给出平均每笔消耗。");
        expect(host.querySelector(".usage-model-list")?.getAttribute("aria-label")).toBe("模型消耗排行");
        expect(texts(host, ".usage-model-label")).toEqual(["Veo 3", "Nano Banana Pro", "seedream-4"]);
        expect(texts(host, ".usage-model-tag")).toEqual(["视频", "图片", "图片"]);
        expect(meta()).toEqual(["3 笔|平均每笔 10|30 积分", "6 笔|平均每笔 2|12 积分", "3 笔|平均每笔 2|6 积分"]);
        expect(texts(host, ".usage-model-share")).toEqual(["62.5%", "25%", "12.5%"]);
        // 条长按最多的模型归一；名称与编码不同时悬停显示编码。
        expect(Array.from(host.querySelectorAll<HTMLElement>(".usage-model-bar i")).map((bar) => [bar.dataset.capability, parseFloat(bar.style.width)])).toEqual([
            ["video", 100],
            ["image", 40],
            ["image", 20],
        ]);
        expect(Array.from(host.querySelectorAll(".usage-model-label")).map((label) => label.getAttribute("title"))).toEqual(["veo-3", "nano-banana-pro", null]);

        await act(async () => radio(host, "Agent 用量").click());
        expect(host.querySelector(".usage-model-list")?.getAttribute("aria-label")).toBe("Agent 模型消耗排行");
        expect(texts(host, ".usage-model-label")).toEqual(["Veo 3", "Nano Banana Pro"]);
        expect(meta()).toEqual(["2 笔|平均每笔 12.5|25 积分", "4 笔|平均每笔 1.25|5 积分"]);
        expect(texts(host, ".usage-model-share")).toEqual(["83.3%", "16.7%"]);

        await act(async () => radio(host, "按类型").click());
        expect(host.querySelector(".usage-model-list")).toBeNull();
        expect(texts(host, ".usage-breakdown-share")).toEqual(["83.3%", "16.7%"]);
        expect(calls.filter((url) => url === "/wallet/usage")).toHaveLength(1);
    } finally {
        await view.unmount();
    }
});

test("加载失败时提示原因，重试成功后展示数据", async () => {
    useUserStore.getState().setUser(user);
    let fail = true;
    respond = (config) => {
        if (config.url !== "/wallet/usage") throw new Error(`Unexpected API: ${config.url}`);
        return fail ? { data: { code: 50301, msg: "统计服务暂时不可用" }, status: 503 } : ok(report);
    };
    const view = await mount(<UsageDashboardPane />);
    try {
        expect(normalize(view.host.textContent)).toContain("用量数据加载失败");
        expect(normalize(view.host.textContent)).toContain("统计服务暂时不可用");
        expect(view.host.querySelector(".usage-stats")).toBeNull();
        fail = false;
        await act(async () => button(view.host, "重试").click());
        await tick();
        expect(texts(view.host, ".usage-stat-value")[0]).toBe("48积分");
        expect(calls.filter((url) => url === "/wallet/usage")).toHaveLength(2);
    } finally {
        await view.unmount();
    }
});

test("刷新失败保留已加载的看板；触屏点按选中格子；读屏表格给出按月汇总", async () => {
    useUserStore.getState().setUser(user);
    let fail = false;
    respond = (config) => {
        if (config.url !== "/wallet/usage") throw new Error(`Unexpected API: ${config.url}`);
        return fail ? { data: { code: 42901, msg: "请求次数已达上限" }, status: 429 } : ok(report);
    };
    const view = await mount(<UsageDashboardPane />);
    const { host } = view;
    try {
        const rows = Array.from(host.querySelectorAll(".usage-chart table tbody tr")).map((row) => texts(row, "th, td").join("|"));
        expect(rows).toHaveLength(13);
        expect(rows[0]).toBe("2025年10月|0|0|0");
        expect(rows.find((row) => row.startsWith("2026年10月"))).toBe("2026年10月|48|12|2");

        const october2 = host.querySelector('[data-day="338"]')!;
        await act(async () => {
            october2.dispatchEvent(new (dom.PointerEvent ?? dom.MouseEvent)("pointerdown", { bubbles: true, pointerType: "touch" } as never) as unknown as Event);
            october2.dispatchEvent(new (dom.PointerEvent ?? dom.MouseEvent)("pointerleave", { bubbles: false, pointerType: "touch" } as never) as unknown as Event);
        });
        expect(live(host)).toBe("10月2日 周五，14 积分 · 3 笔");

        fail = true;
        await act(async () => button(host, "刷新").click());
        await tick();
        expect(normalize(host.textContent)).toContain("刷新失败，显示的是上一次的数据");
        expect(normalize(host.textContent)).not.toContain("用量数据加载失败");
        expect(texts(host, ".usage-stat-value")[0]).toBe("48积分");
    } finally {
        await view.unmount();
    }
});

test("没有消耗时统计为零，热力图全空，构成区给出说明", async () => {
    useUserStore.getState().setUser(user);
    respond = (config) => {
        if (config.url !== "/wallet/usage") throw new Error(`Unexpected API: ${config.url}`);
        return ok({ ...report, daily: [], categories: [], models: [] });
    };
    const view = await mount(<UsageDashboardPane />);
    try {
        expect(texts(view.host, ".usage-stat-value")).toEqual(["0积分", "0积分", "0积分", "0天", "0天"]);
        expect(view.host.querySelectorAll('.usage-heatmap [data-level="0"]')).toHaveLength(365);
        expect(normalize(view.host.querySelector(".usage-empty-note")?.textContent)).toBe("最近 365 天还没有积分消耗，开始创作后这里会展示各类型的占比。");
        expect(normalize(view.host.querySelector(".usage-panel-footer")?.textContent)).toContain("最近 365 天还没有积分消耗");
        await act(async () => radio(view.host, "按模型").click());
        expect(normalize(view.host.querySelector(".usage-empty-note")?.textContent)).toBe("最近 365 天还没有积分消耗，开始创作后这里会列出各模型的消耗。");
    } finally {
        await view.unmount();
    }
});

test("个人信息概览读取余额与用量，可跳转积分中心和看板；关闭积分功能时只显示加入时间", async () => {
    useUserStore.getState().setUser(user);
    respond = (config) => {
        if (config.url === "/auth/profile") return ok({ user, hasPassword: true, emailEnabled: false, linuxdoEnabled: false });
        if (config.url === "/wallet")
            return ok({
                account: { userId: user.id, availableMicrocredits: 1_288_000_000, reservedMicrocredits: 0, version: 1, createdAt: user.createdAt, updatedAt: user.updatedAt },
                entries: [],
                total: 0,
                page: 1,
                pageSize: 1,
                policy: { signupBonusMicrocredits: 0, checkinBonusMicrocredits: 0, checkedInToday: false },
            });
        if (config.url === "/wallet/usage") return ok(report);
        throw new Error(`Unexpected API: ${config.url}`);
    };
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("wallet:open", onOpen);
    let usageOpened = 0;
    const view = await mount(<ProfilePane onOpenUsage={() => usageOpened++} />);
    try {
        const { host } = view;
        expect(texts(host, ".profile-stat-label")).toEqual(["可用积分", "近 30 天消耗", "活跃天数", "加入时间"]);
        expect(texts(host, ".profile-stat-value")).toEqual(["1,288", "48", "2天", "2026年9月12日"]);
        expect(normalize(host.querySelectorAll(".profile-stat")[3]?.textContent)).toMatch(/已加入 [\d,]+ 天$/);
        const avatar = host.querySelector<HTMLImageElement>(".profile-avatar-preview img")!;
        expect(host.querySelector<HTMLImageElement>(".profile-cover-image")?.getAttribute("src")).toBe(avatar.getAttribute("src"));
        await act(async () => host.querySelector<HTMLButtonElement>('.profile-stat.is-action[title="查看用量看板"]')!.click());
        expect(usageOpened).toBe(1);
        await act(async () => host.querySelector<HTMLButtonElement>('.profile-stat.is-action[title="打开积分中心"]')!.click());
        expect(opened).toEqual([{}]);
    } finally {
        window.removeEventListener("wallet:open", onOpen);
        await view.unmount();
    }

    calls.length = 0;
    useUserStore.setState({ features: { ...defaultFeatureAvailability, creditsEnabled: false } });
    const withoutCredits = await mount(<ProfilePane />);
    try {
        expect(texts(withoutCredits.host, ".profile-stat-label")).toEqual(["加入时间"]);
        expect(calls).not.toContain("/wallet");
        expect(calls).not.toContain("/wallet/usage");
    } finally {
        await withoutCredits.unmount();
    }
});
