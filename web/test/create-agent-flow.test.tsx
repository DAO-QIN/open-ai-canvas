import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationAgentQuestion, CreationMessage } from "../src/pages/create/creation-types";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
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
const { renderToStaticMarkup } = await import("react-dom/server");
const { CreationMessageView } = await import("../src/pages/create/creation-workspace-messages");
const { CreationAgentQuestionCard, creationAgentChoiceAnswer, creationAgentFlowBlocks, creationAgentFormAnswer } = await import("../src/pages/create/creation-agent-flow");
const { useUserStore } = await import("../src/stores/use-user-store");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const at = "2026-10-20T10:00:00Z";
const actions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };
const reply: CreationMessage = {
    id: "run:assistant",
    role: "assistant",
    mode: "agent",
    agentRunId: "run",
    content: "我先查一下可用模型。\n\n方案已准备好。",
    createdAt: at,
    status: "done",
    agentSteps: [
        { kind: "reasoning", id: "reasoning-1", text: "先确认 creation_media_read 的素材", streaming: false, durationSeconds: 6 },
        { kind: "text", id: "text-1", text: "我先查一下可用模型。", streaming: false },
        { kind: "tool", id: "tool-1", toolName: "model_list", status: "completed", label: "已查询可用模型", count: 2 },
        { kind: "review", id: "review" },
        { kind: "text", id: "text-2", text: "方案已准备好。", streaming: false },
    ],
};

async function mount(node: React.ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return {
        host,
        render: (next: React.ReactNode) => act(async () => root.render(next)),
        unmount: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("详细偏好按时间线展示思考、工具、正文和方案落点，思考默认收起并显示时长", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={reply} outputPreference="detailed" agentReview={<section data-review="true">重要信息</section>} {...actions} />);
    for (const phrase of ["思考了 6 秒", "已查询可用模型", "×2", "我先查一下可用模型", "方案已准备好", "重要信息"]) expect(markup).toContain(phrase);
    const order = ["思考了 6 秒", "我先查一下可用模型", "已查询可用模型", "重要信息", "方案已准备好"].map((phrase) => markup.indexOf(phrase));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    // 思考已结束时默认收起，正文里的工具调用名不会原样出现。
    expect(markup).not.toContain("creation_media_read");
    expect(markup.match(/data-review="true"/g)).toHaveLength(1);
});

test("思考可展开查看，工具名替换成可读名称", async () => {
    const view = await mount(<CreationMessageView item={reply} outputPreference="detailed" {...actions} />);
    try {
        const toggle = Array.from(view.host.querySelectorAll("button")).find((button) => button.textContent?.includes("思考了 6 秒"))!;
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        await act(async () => toggle.click());
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(view.host.querySelector(".creation-agent-thinking-body")?.textContent).toContain("「查看创作素材」");
    } finally {
        await view.unmount();
    }
});

test("思考输出中展示进行中状态并自动展开，末尾不再叠加处理中提示", async () => {
    const streaming: CreationMessage = { ...reply, status: "streaming", agentSteps: [{ kind: "reasoning", id: "reasoning-1", text: "正在分析参考图", streaming: true }] };
    const view = await mount(<CreationMessageView item={streaming} outputPreference="concise" {...actions} />);
    try {
        expect(view.host.textContent).toContain("思考中");
        expect(view.host.querySelector(".creation-agent-thinking-body")?.textContent).toContain("正在分析参考图");
        expect(view.host.textContent).not.toContain("正在思考…");
        await view.render(
            <CreationMessageView
                item={{
                    ...streaming,
                    agentSteps: [
                        { kind: "reasoning", id: "reasoning-1", text: "正在分析参考图", streaming: false, durationSeconds: 2 },
                        { kind: "tool", id: "tool-1", toolName: "model_list", status: "completed", label: "已查询可用模型", count: 1 },
                    ],
                }}
                outputPreference="detailed"
                {...actions}
            />,
        );
        expect(view.host.querySelector(".creation-agent-status")?.textContent).toContain("正在思考");
    } finally {
        await view.unmount();
    }
});

test("简洁偏好在本轮结束后把连续两步以上的过程收成一行，正文与方案照常展示", () => {
    const steps = reply.agentSteps!;
    const item: CreationMessage = { ...reply, agentSteps: [steps[0], steps[2], steps[1], steps[3], steps[4]] };
    const markup = renderToStaticMarkup(<CreationMessageView item={item} outputPreference="concise" agentReview={<section>重要信息</section>} {...actions} />);
    expect(markup).toContain("思考了 6 秒 · 执行了 2 步");
    expect(markup).toContain("我先查一下可用模型");
    expect(markup).toContain("重要信息");
    expect(markup).not.toContain("已查询可用模型");
    // 详细偏好或仍在运行时逐条展示；正在输出的思考不会被收起。
    expect(renderToStaticMarkup(<CreationMessageView item={item} outputPreference="detailed" {...actions} />)).toContain("已查询可用模型");
    expect(creationAgentFlowBlocks([{ ...steps[0], streaming: true }, steps[2]], { collapsed: false, fold: true }).map((block) => block.kind)).toEqual(["step", "step"]);
    expect(creationAgentFlowBlocks(reply.agentSteps!, { collapsed: true, fold: false }).map((block) => (block.kind === "step" ? block.step.kind : "fold"))).toEqual(["review"]);
});

test("结束后有消耗时在回复末尾显示本轮积分，关闭积分功能时不显示", async () => {
    const item = { ...reply, agentSpentCredits: 12.5 };
    expect(renderToStaticMarkup(<CreationMessageView item={item} outputPreference="detailed" {...actions} />)).toContain("本轮消耗 12.5 积分");
    expect(renderToStaticMarkup(<CreationMessageView item={{ ...item, status: "streaming" }} outputPreference="detailed" {...actions} />)).not.toContain("本轮消耗");
    const features = useUserStore.getState().features;
    useUserStore.setState({ features: { ...features, creditsEnabled: false } });
    const view = await mount(<CreationMessageView item={item} outputPreference="detailed" {...actions} />);
    try {
        expect(view.host.textContent).not.toContain("本轮消耗");
    } finally {
        await view.unmount();
        useUserStore.setState({ features });
    }
});

const choice: CreationAgentQuestion = {
    kind: "choice",
    question: "海报用在哪里？",
    options: [
        { label: "朋友圈", detail: "竖版" },
        { label: "电梯广告", detail: "横版" },
    ],
    allowFreeform: true,
};

test("提问卡可直接选择并继续，发送选项文字；其他想法发送输入内容", async () => {
    const answers: string[] = [];
    const view = await mount(<CreationAgentQuestionCard question={choice} pending onAnswer={async (answer) => (answers.push(answer), true)} />);
    try {
        const submit = () => view.host.querySelector<HTMLButtonElement>(".creation-agent-choice-submit")!;
        expect(submit().disabled).toBe(true);
        await act(async () => view.host.querySelectorAll<HTMLInputElement>("input[type=radio]")[1].click());
        expect(submit().disabled).toBe(false);
        await act(async () => submit().click());
        expect(answers).toEqual(["电梯广告"]);
        expect(view.host.textContent).toContain("已提交，正在继续");
        expect(submit().disabled).toBe(true);
    } finally {
        await view.unmount();
    }
    const other = await mount(<CreationAgentQuestionCard question={choice} pending onAnswer={async (answer) => (answers.push(answer), true)} />);
    try {
        await act(async () => other.host.querySelectorAll<HTMLInputElement>("input[type=radio]")[2].click());
        // 选了"其他想法"但还没写内容时不能继续。
        expect(other.host.querySelector(".creation-agent-choice-custom")).not.toBeNull();
        expect(other.host.querySelector<HTMLButtonElement>(".creation-agent-choice-submit")!.disabled).toBe(true);
    } finally {
        await other.unmount();
    }
    expect(creationAgentChoiceAnswer(choice, 2, "  做成地铁灯箱 ")).toBe("做成地铁灯箱");
    expect(creationAgentChoiceAnswer(choice, 0, "忽略")).toBe("朋友圈");
    expect(creationAgentChoiceAnswer(choice, null, "")).toBe("");
});

test("提交失败保留选择可重试；不在等待回答时收成已回复摘要", async () => {
    let attempts = 0;
    const view = await mount(<CreationAgentQuestionCard question={choice} pending onAnswer={async () => (attempts++, false)} />);
    try {
        await act(async () => view.host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
        await act(async () => view.host.querySelector<HTMLButtonElement>(".creation-agent-choice-submit")!.click());
        expect(attempts).toBe(1);
        expect(view.host.querySelector<HTMLButtonElement>(".creation-agent-choice-submit")!.disabled).toBe(false);
        await view.render(<CreationAgentQuestionCard question={choice} pending={false} onAnswer={async () => true} />);
        expect(view.host.querySelector(".creation-agent-choice-submit")).toBeNull();
        expect(view.host.textContent).toContain("已回复");
        expect(view.host.textContent).toContain("海报用在哪里");
    } finally {
        await view.unmount();
    }
});

test("表单回答按推荐值预填，写成逐行的自然语言", () => {
    const form: CreationAgentQuestion = {
        kind: "form",
        question: "确认画幅与风格",
        options: [],
        fields: [
            {
                id: "ratio",
                title: "画幅",
                type: "single_select",
                required: true,
                options: [
                    { id: "9:16", label: "竖屏", recommended: true },
                    { id: "16:9", label: "横屏" },
                ],
            },
            { id: "style", title: "风格", type: "multi_select", allowCustom: true, options: [{ label: "写实" }, { label: "插画" }] },
        ],
    };
    expect(creationAgentFormAnswer(form, { ratio: "9:16", style: ["写实"] }, "主体放大", { style: "胶片感" })).toBe("画幅：竖屏\n风格：写实、胶片感\n补充说明：主体放大");
    const markup = renderToStaticMarkup(<CreationAgentQuestionCard question={form} pending onAnswer={async () => true} />);
    expect(markup).toContain("已按推荐预填");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>竖屏/);
});

test("消息视图在可回答时渲染交互提问卡，旧调用方仍保留只读列表", () => {
    const item: CreationMessage = {
        ...reply,
        agentSteps: [
            { kind: "text", id: "text-1", text: "先确认一下：", streaming: false },
            { kind: "question", id: "question" },
        ],
        agentQuestion: choice,
    };
    const interactive = renderToStaticMarkup(<CreationMessageView item={item} outputPreference="detailed" questionPending onAnswerQuestion={async () => true} {...actions} />);
    expect(interactive).toContain("需要你选择");
    expect(interactive).toContain("其他想法");
    const legacy = renderToStaticMarkup(<CreationMessageView item={item} outputPreference="detailed" {...actions} />);
    expect(legacy).toContain("请在输入框回复");
});
