import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationMessage } from "../src/pages/create/creation-types";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationMessageView } = await import("../src/pages/create/creation-workspace-messages");
const { CreationResultImage } = await import("../src/pages/create/creation-result-image");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const at = "2026-10-20T10:00:00Z";
const reply: CreationMessage = { id: "run:assistant", role: "assistant", mode: "agent", agentRunId: "run", content: "已经收到的正文必须立即完整显示，不再逐字播放。", createdAt: at, status: "streaming", agentTextStreaming: true };
const imageTask: CreationMessage = { id: "task-image", role: "assistant", mode: "image", agentRunId: "run", content: "主图", createdAt: at, status: "pending", taskIds: ["image"] };
const actions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };

test("真实正文增量立即显示，计划或媒体任务出现不会折叠正在输出的回复", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<CreationMessageView item={reply} outputPreference="concise" {...actions} />));
        expect(host.querySelector(".ai-message-markdown")?.textContent).toContain(reply.content);
        await act(async () => root.render(<CreationMessageView item={{ ...reply, content: `${reply.content}这是新到的增量。` }} agentTasks={[imageTask]} outputPreference="concise" {...actions} />));
        expect(host.querySelector(".ai-message-markdown")?.textContent).toContain(`${reply.content}这是新到的增量。`);
        expect(host.textContent).not.toContain("查看完整回复");
        expect(host.querySelector(".creation-agent-output-summary")?.textContent).toContain("1 项生成中");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("文字先结束时仍可阅读，整轮完成才按偏好折叠并保留手动展开", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const finalText: CreationMessage = { ...reply, agentTextStreaming: false };
    try {
        await act(async () => root.render(<CreationMessageView item={finalText} agentTasks={[imageTask]} outputPreference="concise" {...actions} />));
        const toggle = () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("完整回复"))!;
        expect(host.querySelector(".ai-message-markdown")?.textContent).toContain(reply.content);
        expect(host.querySelector(".ai-message-markdown-streaming")).toBeNull();
        expect(toggle()).toBeUndefined();
        await act(async () => root.render(<CreationMessageView item={{ ...finalText, status: "done" }} agentTasks={[{ ...imageTask, status: "done" }]} outputPreference="concise" {...actions} />));
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        await act(async () => toggle().click());
        expect(host.querySelector(".ai-message-markdown")?.textContent).toContain(reply.content);
        expect(host.querySelector(".ai-message-markdown-streaming")).toBeNull();
        await act(async () => root.render(<CreationMessageView item={{ ...finalText, status: "done" }} agentTasks={[{ ...imageTask, status: "done" }]} outputPreference="detailed" {...actions} />));
        await act(async () => root.render(<CreationMessageView item={{ ...finalText, status: "done" }} agentTasks={[{ ...imageTask, status: "done" }]} outputPreference="concise" {...actions} />));
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(host.querySelector(".ai-message-markdown")?.textContent).toContain(reply.content);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("等待媒体时展示真实任务状态而非思考，工具反馈与正文不暴露内部推理", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<CreationMessageView item={{ ...reply, agentTextStreaming: false, agentActivity: "已查询创作素材", reasoning: "不应展示的内部推理" }} agentTasks={[imageTask]} outputPreference="detailed" {...actions} />));
        expect(host.querySelector(".creation-message-content")?.textContent).toContain("1 项媒体任务生成中");
        expect(host.textContent).not.toContain("正在思考");
        expect(host.textContent).not.toContain("不应展示的内部推理");
        expect(host.querySelector(".ai-message-markdown-streaming")).toBeNull();
        await act(async () => root.render(<CreationMessageView item={{ ...reply, agentTextStreaming: false, agentActivity: "已查询创作素材" }} outputPreference="detailed" {...actions} />));
        expect(host.querySelector(".creation-message-content")?.textContent).toContain("已查询创作素材");
        await act(async () => root.render(<CreationMessageView item={{ ...reply, status: "done", agentTextStreaming: false, agentActivity: "已查询创作素材" }} outputPreference="detailed" {...actions} />));
        expect(host.querySelector(".creation-message-content")?.textContent).not.toContain("已查询创作素材");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("单图完成后去掉交付计数和通用处理动画，具体工具工作仍可展示", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const completed = { ...imageTask, status: "done" as const, resultUrls: ["/result.png"], batchTotal: 1, batchCompletedCount: 1 };
    try {
        await act(async () => root.render(<CreationMessageView item={{ ...reply, agentTextStreaming: false, content: "" }} agentTasks={[completed]} outputPreference="concise" {...actions} />));
        expect(host.textContent).toContain("图片已生成");
        for (const text of ["项交付", "成功 1/1", "正在处理请求", "批量下载"]) expect(host.textContent).not.toContain(text);
        await act(async () => root.render(<CreationMessageView item={{ ...reply, agentTextStreaming: false, agentActivity: "正在整理创作方案" }} agentTasks={[completed]} outputPreference="concise" {...actions} />));
        expect(host.textContent).toContain("正在整理创作方案");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("图片加载失败后刷新原素材地址，成功后才允许预览", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let reloads = 0;
    let preview = "";
    try {
        await act(async () => root.render(<CreationResultImage url="/expired.png" alt="生成结果 1" onPreview={(url) => { preview = url; }} onReload={async () => { reloads++; return "/renewed.png"; }} />));
        expect(host.textContent).toContain("图片加载中");
        expect(host.querySelector<HTMLButtonElement>(".creation-result-image-open")!.disabled).toBe(true);
        await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("error")));
        expect(host.querySelector(".creation-result-image")?.classList.contains("is-error")).toBe(true);
        expect(host.textContent).toContain("图片暂时无法显示");
        await act(async () => host.querySelector<HTMLButtonElement>(".creation-result-image-state button")!.click());
        expect(reloads).toBe(1);
        expect(host.querySelector("img")!.getAttribute("src")).toBe("/renewed.png");
        await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("load")));
        expect(host.querySelector(".creation-result-image-state")).toBeNull();
        await act(async () => host.querySelector<HTMLButtonElement>(".creation-result-image-open")!.click());
        expect(preview).toBe("/renewed.png");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
