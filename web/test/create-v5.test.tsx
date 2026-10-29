import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";

import type { ImageCapabilityConfig } from "../src/lib/model-capabilities";
import { creationAgentDirectContext } from "../src/pages/create/creation-agent-context";
import { creationAgentPreauthorizedCredits } from "../src/pages/create/creation-agent-estimate";
import { buildCreationAgentRunInput } from "../src/pages/create/creation-agent-request";
import { creationFileAccepted, creationMediaAspectRatio, creationSingleResultMode } from "../src/pages/create/creation-assets";
import { applyRecoveredCreationResult, creationConversationMode, reconcileCreationTaskMessages } from "../src/pages/create/creation-conversations";
import { creationHistoryFingerprint } from "../src/pages/create/creation-history-sync-cache";
import { creationImageSettingsForSource, expandedImageGeometry, regionEditDisplayPrompt } from "../src/pages/create/creation-image-tools";
import { creationLibraryDisabledReason } from "../src/pages/create/creation-library";
import { creationComposerModeOptions, modeLabels, type CreationConversation, type CreationMessage } from "../src/pages/create/creation-types";
import { CreationSurfaceSwitch } from "../src/pages/create/creation-workspace-empty";
import { normalizeCreationComposerPreferences } from "../src/stores/use-creation-preferences-store";

const message = (id: string, patch: Partial<CreationMessage> = {}): CreationMessage => ({ id, role: "assistant", content: "", createdAt: "2026-10-29T00:00:00Z", mode: "image", status: "done", ...patch });

const profile = (patch: Partial<ImageCapabilityConfig>): ImageCapabilityConfig => ({
    references: { promptMaxChars: 4000, maxImages: 4, maxImageBytes: 10 * 1024 * 1024, maskSupported: false },
    size: { parameter: "aspect_ratio", values: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"], default: "1:1", allowCustom: false },
    resolution: { supported: false, values: [], default: "auto" },
    quality: { supported: false, values: [], default: "auto" },
    transparentBackground: { supported: false, default: false },
    responseFormat: { supported: false },
    outputFormat: { supported: false },
    maxOutputs: 4,
    ...patch,
});

test("按预估授权：预估 × 1.2，四位小数，不超过本轮上限；拿不到预估时不预授权", () => {
    expect(creationAgentPreauthorizedCredits(10, 200)).toBe(12);
    expect(creationAgentPreauthorizedCredits(10, 5)).toBe(5);
    expect(creationAgentPreauthorizedCredits(0.33333, 200)).toBe(0.4);
    for (const estimate of [null, undefined, 0, -1, Number.NaN]) expect(creationAgentPreauthorizedCredits(estimate, 200)).toBe(0);
    expect(creationAgentPreauthorizedCredits(10, 0)).toBe(0);
});

test("预授权额度只在需要确认的模式下随请求发送，且不超过积分上限", () => {
    const base = {
        prompt: "做一张海报",
        idempotencyKey: "creation-v5-key-1",
        textSelection: { logicalModelId: "text-1" },
        permissionMode: "request_approval" as const,
        attachments: [],
        budget: { maxCredits: 50, maxGenerationTasks: 0, maxVideoSeconds: 30 },
    };
    expect(buildCreationAgentRunInput({ ...base, preauthorizedCredits: 12 }).budget?.autoApproveCredits).toBe(12);
    expect(buildCreationAgentRunInput({ ...base, preauthorizedCredits: 80 }).budget?.autoApproveCredits).toBe(50);
    expect(buildCreationAgentRunInput({ ...base, preauthorizedCredits: 0 }).budget).not.toHaveProperty("autoApproveCredits");
    expect(buildCreationAgentRunInput({ ...base, permissionMode: "auto", preauthorizedCredits: 12 }).budget).not.toHaveProperty("autoApproveCredits");
    expect(buildCreationAgentRunInput({ ...base, permissionMode: "read_only", preauthorizedCredits: 12 }).budget).not.toHaveProperty("autoApproveCredits");
});

test("创作历史摘要：内容相同摘要相同，任一字段变化摘要就变", () => {
    const input = { sourceConversationId: "c1", title: "海报", messages: [{ id: "m1", role: "user" as const, mode: "image" as const, content: "一张海报", createdAt: "2026-10-29T00:00:00Z" }] };
    expect(creationHistoryFingerprint(input)).toBe(creationHistoryFingerprint(JSON.parse(JSON.stringify(input))));
    expect(creationHistoryFingerprint({ ...input, title: "海报 2" })).not.toBe(creationHistoryFingerprint(input));
    expect(creationHistoryFingerprint({ ...input, messages: [{ ...input.messages[0], content: "一张海报。" }] })).not.toBe(creationHistoryFingerprint(input));
});

test("生成 | 画布：两个按钮，选中项 aria-pressed，禁用时都不可点", () => {
    const dom = new Window();
    try {
        dom.document.body.innerHTML = renderToStaticMarkup(<CreationSurfaceSwitch value="canvas" onChange={() => {}} />);
        const group = dom.document.querySelector(".creation-surface-switch");
        expect(group?.getAttribute("role")).toBe("group");
        const buttons = Array.from(dom.document.querySelectorAll("button"));
        expect(buttons.map((button) => button.textContent)).toEqual(["生成", "画布"]);
        expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
        dom.document.body.innerHTML = renderToStaticMarkup(<CreationSurfaceSwitch value="generate" disabled onChange={() => {}} />);
        expect(Array.from(dom.document.querySelectorAll("button")).every((button) => button.hasAttribute("disabled"))).toBe(true);
    } finally {
        dom.close();
    }
});

test("高清：按原图比例取最高档；比例 + 分辨率字段的模型改比例和分辨率", () => {
    const nano = profile({ resolution: { supported: true, values: ["1K", "2K", "4K"], default: "1K" } });
    expect(creationImageSettingsForSource(nano, { width: 1200, height: 900 }, "highest")).toEqual({ ratio: "4:3", imageResolution: "4K" });
    expect(creationImageSettingsForSource(nano, { width: 900, height: 1600 }, "highest")).toEqual({ ratio: "9:16", imageResolution: "4K" });
    // 扩图沿用当前档位，只改比例。
    expect(creationImageSettingsForSource(nano, { width: 1200, height: 900 }, "current", { imageResolution: "2K" })).toEqual({ ratio: "4:3" });
});

test("高清：像素尺寸的模型选同比例里最大的一档；扩图沿用当前档位", () => {
    const seedream = profile({ size: { parameter: "size", values: ["1024x1024", "1824x1024", "2048x2048", "2752x1536", "2880x2880", "3840x2160"], default: "2048x2048", allowCustom: false } });
    expect(creationImageSettingsForSource(seedream, { width: 1920, height: 1080 }, "highest")).toEqual({ ratio: "3840x2160" });
    expect(creationImageSettingsForSource(seedream, { width: 1000, height: 1000 }, "highest")).toEqual({ ratio: "2880x2880" });
    expect(creationImageSettingsForSource(seedream, { width: 1920, height: 1080 }, "current", { ratio: "2048x2048" })).toEqual({ ratio: "2752x1536" });
    // 读不出当前档位时取最低档，不擅自加价。
    expect(creationImageSettingsForSource(seedream, { width: 1920, height: 1080 }, "current")).toEqual({ ratio: "1824x1024" });
});

test("高清：只有质量档的模型把质量调到最高；工作流参数模型不改", () => {
    const gptImage = profile({
        size: { parameter: "size", values: ["auto", "1024x1024", "1536x1024", "1024x1536"], default: "auto", allowCustom: false },
        quality: { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" },
    });
    expect(creationImageSettingsForSource(gptImage, { width: 1000, height: 1500 }, "highest")).toEqual({ ratio: "1024x1536", quality: "high" });
    expect(creationImageSettingsForSource(gptImage, { width: 1000, height: 1500 }, "current")).toEqual({ ratio: "1024x1536" });
    expect(creationImageSettingsForSource(profile({ parameters: [] }), { width: 1000, height: 1500 }, "highest")).toEqual({});
    expect(creationImageSettingsForSource(gptImage, { width: 0, height: 1500 }, "highest")).toEqual({});
});

test("扩图底图：原图居中，四周各留 1/4，长边超过 2048 时整体缩小", () => {
    expect(expandedImageGeometry({ width: 1000, height: 500 })).toEqual({ width: 1500, height: 750, inner: { x: 250, y: 125, width: 1000, height: 500 } });
    const large = expandedImageGeometry({ width: 4000, height: 3000 });
    expect(Math.max(large.width, large.height)).toBeLessThanOrEqual(2048);
    expect(large.inner.width / large.width).toBeCloseTo(2 / 3, 2);
    expect(large.inner.x).toBe(Math.round((large.width - large.inner.width) / 2));
});

test("局部修改在对话里显示成一行，@区域N 去掉 @", () => {
    expect(regionEditDisplayPrompt("@区域1 换成一艘渔船\n\n@区域2 去掉路人 ")).toBe("局部修改：区域1 换成一艘渔船；区域2 去掉路人");
});

test("音频生成：类型菜单有入口，只收文字，不接参考素材", () => {
    expect(creationComposerModeOptions.map((item) => item.key)).toEqual(["agent", "image", "video", "audio"]);
    expect(creationComposerModeOptions.find((item) => item.key === "audio")?.label).toBe("音频生成");
    expect(modeLabels.audio).toBe("音频");
    expect(creationFileAccepted("audio", { type: "image/png", name: "a.png" })).toBe(false);
    expect(creationFileAccepted("audio", { type: "audio/mpeg", name: "a.mp3" })).toBe(false);
    expect(creationLibraryDisabledReason("audio", "audio")).toContain("不使用参考素材");
    expect(creationMediaAspectRatio("16:9", "audio")).toBe("4 / 1");
    expect(creationSingleResultMode("audio")).toBe(true);
    expect(creationSingleResultMode("image")).toBe(false);
});

test("音频偏好：记住音频模式和音频模型，丢弃未知的模型键", () => {
    expect(normalizeCreationComposerPreferences({ mode: "audio", models: { audioModel: "tts-1", imageModel: "image-1", foo: "x" } })).toEqual({ mode: "audio", models: { audioModel: "tts-1", imageModel: "image-1" } });
    expect(normalizeCreationComposerPreferences({ mode: "music" })).toEqual({});
});

test("音频消息：会话恢复成音频模式，结果按单个结果收口，不进阿Q 的普通创作上下文", () => {
    const user = message("audio-user", { role: "user", mode: "audio", content: "用温柔的女声读：欢迎光临" });
    const result = message("audio-result", { mode: "audio", status: "pending", taskIds: ["audio-task"] });
    const conversation: CreationConversation = { id: "c1", title: "配音", updatedAt: "2026-10-29T00:00:00Z", messages: [user, result] };
    expect(creationConversationMode(conversation)).toBe("audio");
    expect(applyRecoveredCreationResult(result, ["https://cdn.example/voice.mp3"], ["resource:voice"], 1)).toMatchObject({ status: "done", content: "音频已生成", resultStorageKeys: ["resource:voice"] });
    const task = {
        id: "audio-task",
        type: "canvas_audio",
        status: "succeeded" as const,
        prompt: "",
        attempts: 1,
        createdAt: "2026-10-29T00:00:01Z",
        updatedAt: "2026-10-29T00:00:05Z",
        creationResultUrls: ["https://cdn.example/voice.mp3"],
        creationResultStorageKeys: ["resource:voice"],
    };
    const [reconciled] = reconcileCreationTaskMessages({} as never, [conversation], [task]);
    expect(reconciled.messages[1]).toMatchObject({ status: "done", content: "音频已生成", resultStorageKeys: ["resource:voice"] });
    const image = message("image-user", { role: "user", mode: "image", content: "一张海报" });
    const context = creationAgentDirectContext({ messages: [user, result, image] });
    expect(context.entries.map((entry) => entry.messageId)).toEqual(["image-user"]);
});
