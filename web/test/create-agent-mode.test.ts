import { expect, test } from "bun:test";
import * as creationModes from "../src/pages/create/creation-types";
const { defaultCreationMode, modeLabels } = creationModes;

test("新建首页会话默认交给阿Q（Agent），保留旧文本消息的标签", () => {
    expect(defaultCreationMode).toBe("agent");
    expect(modeLabels.text).toBe("文本");
    expect(modeLabels.agent).toBe("Agent");
});

test("创作类型菜单：Agent 模式、图片、视频、音乐、音频五项，只有名称不带说明；音乐和音频都走音频能力；Agent 走文本能力", () => {
    const { creationComposerModeOptions, creationComposerModeKey } = creationModes;
    expect(creationComposerModeOptions.map((item) => item.key)).toEqual(["agent", "image", "video", "music", "audio"]);
    expect(creationComposerModeOptions.map((item) => item.label)).toEqual(["Agent 模式", "图片生成", "视频生成", "音乐生成", "音频生成"]);
    expect(creationComposerModeOptions.some((item) => "description" in item)).toBe(false);
    expect(creationComposerModeOptions.filter((item) => item.mode === "audio").map((item) => item.audioKind)).toEqual(["music", "speech"]);
    expect(creationComposerModeKey("audio", "music")).toBe("music");
    expect(creationComposerModeKey("audio", "speech")).toBe("audio");
    expect(creationComposerModeKey("text", "speech")).toBe("agent");
    expect(creationComposerModeKey("video", "music")).toBe("video");
    expect((creationModes as any).creationModelCapability?.("agent")).toBe("text");
    expect((creationModes as any).creationModelCapability?.("image")).toBe("image");
    expect((creationModes as any).creationModelCapability?.("audio")).toBe("audio");
});
