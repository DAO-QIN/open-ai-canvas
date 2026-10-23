import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioSettingsPanel } from "../src/components/audio-settings-panel";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { canvasThemes } from "../src/lib/canvas-theme";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { readNodeGenerationSpec, specFromConfig, synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const theme = Object.values(canvasThemes)[0];
const config = {
    ...defaultConfig,
    interfaceType: "doubao-streaming-tts",
    model: "seed-audio-1.0",
    audioModel: "seed-audio-1.0",
    channels: [createModelChannel({ id: "doubao", models: ["seed-audio-1.0"], interfaceType: "doubao-streaming-tts" })],
    audioVoice: "",
    audioSpeed: "",
};

describe("canvas audio settings", () => {
    test("renders Doubao voice input and prompt guidance without unsupported controls", () => {
        const html = renderToStaticMarkup(<AudioSettingsPanel config={config} theme={theme} onConfigChange={() => {}} />);
        expect(html).toContain('aria-label="豆包音色 ID"');
        expect(html).toContain("豆包提示词写法");
        expect(html).toContain("@Audio1");
        expect(html).toContain("1x 为正常语速");
        expect(html).not.toContain('aria-label="声音指令"');
    });

    test("keeps explicit empty node voice instead of inheriting global voice", () => {
        const global = { ...config, audioVoice: "global-speaker" };
        const node = { id: "audio", type: CanvasNodeType.Audio, metadata: { audioVoice: "" } } as CanvasNodeData;
        expect(buildNodeConfig(global, node, "audio", { capability: "audio" }).audioVoice).toBe("");
        expect(buildNodeConfig(global, { ...node, metadata: {} }, "audio", { capability: "audio" }).audioVoice).toBe("global-speaker");
        const edited = synchronizeGenerationSpec({ ...node, metadata: { audioVoice: "old-speaker" } }, { audioVoice: "" });
        expect(readNodeGenerationSpec(edited)?.options.audioVoice).toBe("");
        expect(buildNodeConfig(global, edited, "audio", { capability: "audio" }).audioVoice).toBe("");
        expect(specFromConfig("audio", "你好", config).options.audioVoice).toBe("");
    });

    test("keeps Gemini TTS defaults and its supported controls", () => {
        const gemini = { ...defaultConfig, model: "gemini-tts", audioModel: "gemini-tts", channels: [createModelChannel({ id: "gemini", models: ["gemini-tts"], interfaceType: "kacang-gemini-tts" })], audioVoice: "alloy", audioFormat: "mp3" };
        const html = renderToStaticMarkup(<AudioSettingsPanel config={gemini} theme={theme} onConfigChange={() => {}} />);
        expect(html).toContain('aria-label="声音指令"');
        expect(html).toContain("24kHz 单声道 WAV");
        expect(html).not.toContain('aria-label="自定义语速"');
        expect(html).not.toContain('aria-label="豆包音色 ID"');
    });

    test("keeps Suno music settings separate from speech controls", () => {
        const suno = { ...defaultConfig, model: "suno", audioModel: "suno", channels: [createModelChannel({ id: "suno", models: ["suno"], interfaceType: "kacang-suno" })] };
        const html = renderToStaticMarkup(<AudioSettingsPanel config={suno} theme={theme} onConfigChange={() => {}} />);
        expect(html).toContain('aria-label="音乐类型"');
        expect(html).toContain("歌曲");
        expect(html).toContain("纯音乐");
        expect(html).not.toContain("2 首音乐");
        expect(html).not.toContain("卡藏");
        expect(html).not.toContain("渠道");
        expect(html).not.toContain('aria-label="渠道音色 ID"');
        expect(html).not.toContain('aria-label="自定义语速"');
        expect(html).not.toContain('aria-label="声音指令"');
    });
});
