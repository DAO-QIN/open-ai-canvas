import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import type { ChannelModel } from "../src/services/api/wallet";
import { channelModelCapabilityConfigForSave, changeChannelModelProtocol, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";

const protocol = "kacang-gemini-tts";
const model = "gemini-3.8-flash-tts";
const definitions = ["openai-audio", protocol].map((value) => ({ value, label: value, capability: "audio", enabled: true })) as ModelProtocolDefinition[];

function existingModel(requestProtocol: string, capabilityConfig?: ChannelModel["capabilityConfig"]) {
    return { modelKey: model, providerModelKey: model, capability: "audio", protocol: requestProtocol, enabled: false, priceTiers: [], capabilityConfig } as unknown as ChannelModel;
}

describe("upstream image-contract merge preserves audio capabilities", () => {
    test("switching protocols applies Gemini TTS defaults without changing prices or availability", () => {
        const values = initialChannelModelValues(existingModel("openai-audio"), definitions);
        values.priceTiers[0].unitPrice = 42;
        values.priceTiers[0].costUnitPrice = 7;
        const changed = changeChannelModelProtocol(values, protocol, definitions);
        expect(changed.capabilityConfig?.audio).toEqual(defaultModelCapabilityConfig(protocol, model).audio);
        expect(changed.priceTiers).toEqual(values.priceTiers);
        expect(changed.enabled).toBe(false);
        expect(changed.capabilityConfig?.audio?.speech?.defaultVoice).toBe("Kore");
    });

    test("saved voice and instructions survive normalization, save and reopening", () => {
        const profile = structuredClone(defaultModelCapabilityConfig(protocol, model));
        profile.audio!.speech!.defaultVoice = "Puck";
        profile.audio!.speech!.defaultInstructions = "低沉、清晰，保留停顿";
        const values = initialChannelModelValues(existingModel(protocol, profile), definitions);
        const saved = channelModelCapabilityConfigForSave(values);
        const reopened = initialChannelModelValues(existingModel(protocol, saved), definitions);
        expect(saved?.audio).toEqual(profile.audio);
        expect(reopened.capabilityConfig?.audio).toEqual(profile.audio);
        expect(reopened.enabled).toBe(false);
    });

    test("switching back to an audio protocol without a declared capability removes stale speech defaults only", () => {
        const values = initialChannelModelValues(existingModel(protocol), definitions);
        const changed = changeChannelModelProtocol(values, "openai-audio", definitions);
        expect(changed.capabilityConfig).toBeUndefined();
        expect(changed.priceTiers).toEqual(values.priceTiers);
        expect(changed.enabled).toBe(values.enabled);
    });
});
