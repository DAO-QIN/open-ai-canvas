import { expect, test } from "bun:test";
import * as creationModes from "../src/pages/create/creation-types";
const { defaultCreationMode, modeLabels } = creationModes;

test("新建首页会话默认交给阿Q（自动），保留旧文本消息的标签", () => {
    expect(defaultCreationMode).toBe("agent");
    expect(modeLabels.text).toBe("文本");
    expect(modeLabels.agent).toBe("自动");
});

test("创作类型菜单：自动、图片生成、视频生成、音频生成，每项带一句说明；自动走文本能力", () => {
    expect((creationModes as any).creationComposerModeOptions?.map((item: { key: string }) => item.key)).toEqual(["agent", "image", "video", "audio"]);
    expect(creationModes.creationComposerModeOptions.map((item) => item.label)).toEqual(["自动", "图片生成", "视频生成", "音频生成"]);
    expect(creationModes.creationComposerModeOptions.every((item) => item.description.length > 0 && item.description.length <= 8)).toBe(true);
    expect((creationModes as any).creationModelCapability?.("agent")).toBe("text");
    expect((creationModes as any).creationModelCapability?.("image")).toBe("image");
    expect((creationModes as any).creationModelCapability?.("audio")).toBe("audio");
});
