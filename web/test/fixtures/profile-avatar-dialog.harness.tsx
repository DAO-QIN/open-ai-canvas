import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
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
const { ProfilePane } = await import("../../src/pages/settings/profile-pane");
const { ProfileAvatarPicker } = await import("../../src/pages/settings/profile-avatar-picker");
const { apiClient } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
import type { LocalUser } from "../../src/services/api/auth";

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const tick = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
    });
const button = (text: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.replace(/\s/g, "") === text)!;
const select = (number: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="灵感伙伴 ${number}"]`)!;

test("48款同页展示，选择和取消不写入；失败保留草稿，重试保存全局生效", async () => {
    const originalRequest = apiClient.request;
    const previousUser = useUserStore.getState().user;
    let stored: LocalUser = { id: "avatar-dialog", username: "creator", displayName: "Creator", role: "user", status: "active", avatarMode: "default", avatarPreset: "spirit-v1-01" };
    useUserStore.getState().setUser(stored);
    let writes = 0;
    let failSave = true;
    apiClient.request = (async (config: { url: string; data?: { preset: string } }) => {
        if (config.url === "/auth/profile") return { data: { code: 0, data: { user: stored, hasPassword: true, emailEnabled: false, linuxdoEnabled: false } }, status: 200 };
        if (config.url === "/auth/profile/avatar/default") {
            writes++;
            if (failSave) return { data: { code: 50001, msg: "保存暂时失败，请重试" }, status: 500 };
            stored = { ...stored, avatarPreset: config.data!.preset };
            return { data: { code: 0, data: { user: stored } }, status: 200 };
        }
        throw new Error(`Unexpected API: ${config.url}`);
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <MemoryRouter>
                        <ConfigProvider theme={{ token: { motion: false } }}>
                            <App>
                                <ProfilePane />
                            </App>
                        </ConfigProvider>
                    </MemoryRouter>
                </QueryClientProvider>,
            ),
        );
        await tick();
        await act(async () => button("更换头像").click());
        expect(document.querySelectorAll(".profile-default-avatar-choice")).toHaveLength(48);
        expect(document.querySelector('input[accept="image/png,image/jpeg"]')).not.toBeNull();
        await act(async () => select("48").click());
        expect(select("48").getAttribute("aria-pressed")).toBe("true");
        expect(writes).toBe(0);
        expect(useUserStore.getState().user?.avatarPreset).toBe("spirit-v1-01");
        await act(async () => button("取消").click());
        await tick();
        await act(async () => button("更换头像").click());
        expect(select("01").getAttribute("aria-pressed")).toBe("true");
        await act(async () => select("48").click());
        await act(async () => button("保存头像").click());
        await tick();
        expect(writes).toBe(1);
        expect(document.body.textContent).toContain("保存暂时失败");
        expect(select("48").getAttribute("aria-pressed")).toBe("true");
        expect(useUserStore.getState().user?.avatarPreset).toBe("spirit-v1-01");
        failSave = false;
        await act(async () => button("保存头像").click());
        await tick();
        expect(writes).toBe(2);
        expect(useUserStore.getState().user?.avatarPreset).toBe("spirit-v1-48");
        await act(async () => button("更换头像").click());
        expect(select("48").getAttribute("aria-pressed")).toBe("true");
    } finally {
        await act(async () => root.unmount());
        client.clear();
        host.remove();
        apiClient.request = originalRequest;
        useUserStore.setState({ user: previousUser });
    }
});

test("上传预览不标选系统头像，旧头像保持显示且上传和调整裁剪入口可用", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let uploads = 0;
    let crops = 0;
    const props = {
        user: { id: "legacy", username: "creator", displayName: "Creator", role: "user", status: "active", avatarMode: "default", avatarPreset: "cat" } as LocalUser,
        source: "preset" as "preset" | "upload",
        preset: "cat",
        disabled: false,
        onSelect: () => {},
        onUpload: () => uploads++,
        onCrop: () => crops++,
        onPreviewError: () => {},
    };
    try {
        await act(async () => root.render(<ProfileAvatarPicker {...props} />));
        expect(host.querySelector(".profile-avatar-dialog-preview .lucide-cat")).not.toBeNull();
        expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
        await act(async () => button("上传图片").click());
        expect(uploads).toBe(1);
        await act(async () => root.render(<ProfileAvatarPicker {...props} source="upload" uploadPreview="blob:test-upload" />));
        expect(host.querySelector('img[alt="待保存的头像预览"]')?.getAttribute("src")).toBe("blob:test-upload");
        expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
        await act(async () => button("调整裁剪").click());
        expect(crops).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
