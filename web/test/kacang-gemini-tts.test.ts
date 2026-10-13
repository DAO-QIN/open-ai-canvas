import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { audioFormatOptionsForConfig, audioVoiceOptionsForConfig, normalizeAudioFormatForConfig, normalizeAudioVoiceForConfig } from "../src/lib/audio-generation";
import { changeChannelModelCapability, initialChannelModelValues, channelModelCapabilityConfigForSave } from "../src/pages/admin/components/channel-model-editor-form";

const protocol = "kacang-gemini-tts";
const model = "gemini-3.8-flash-tts";
const definitions = [{ value: protocol, label: "卡藏 Gemini TTS", capability: "audio", create: "POST /v1beta/models/:generateContent", contentType: "application/json", media: "audio", enabled: true }] as any;
const config = { provider: "custom", model, audioModel: model, channels: [{ id: "tts", models: [model], modelCosts: [], interfaceType: protocol, apiKey: "", baseUrl: "" }] } as any;

describe("Kacang Gemini TTS defaults", () => {
    test("protocol selection populates speech parameters and preserves pricing", () => {
        const old = initialChannelModelValues({ modelKey: model, capability: "audio", protocol: "kacang-suno", enabled: false, priceTiers: [] } as any, definitions);
        const changed = changeChannelModelCapability({ ...old, protocol }, definitions);
        expect(changed.capabilityConfig?.audio).toEqual(defaultModelCapabilityConfig(protocol, model).audio);
        expect(changed.capabilityConfig?.audio?.speech).toMatchObject({ defaultVoice: "Kore", defaultInstructions: "自然、友好、清晰", outputFormat: "wav", sampleRate: 24000, channels: 1, inputMaxTokens: 8192, outputMaxTokens: 16384 });
        expect(changed.enabled).toBe(false);
        expect(changed.priceTiers[0].unitPrice).toBe(old.priceTiers[0].unitPrice);
        const saved = channelModelCapabilityConfigForSave(changed);
        const reopened = initialChannelModelValues({ modelKey: model, providerModelKey: model, capability: "audio", protocol, enabled: false, capabilityConfig: saved } as any, definitions);
        expect(reopened.capabilityConfig?.audio).toEqual(saved?.audio);
        expect(changeChannelModelCapability({ ...changed, protocol: "openai-audio" }, [{ ...definitions[0], value: "openai-audio" }]).capabilityConfig).toBeUndefined();
    });
    test("generation uses Kore and WAV when stale OpenAI settings remain", () => {
        expect(audioVoiceOptionsForConfig(config)).toHaveLength(30);
        expect(normalizeAudioVoiceForConfig(config, "alloy")).toBe("Kore");
        expect(normalizeAudioVoiceForConfig(config, "")).toBe("Kore");
        expect(normalizeAudioVoiceForConfig(config, "Puck")).toBe("Puck");
        expect(normalizeAudioVoiceForConfig(config, "my-explicit-voice-id")).toBe("my-explicit-voice-id");
        expect(normalizeAudioFormatForConfig(config, "mp3")).toBe("wav");
        expect(audioFormatOptionsForConfig(config)).toEqual([{ value: "wav", label: "WAV" }]);
    });
});
