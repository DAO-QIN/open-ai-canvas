import { describe, expect, test } from "bun:test";
import manifest from "../../plugin-packages/choosec-qwen-image/manifest.json";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { imageTierAvailable } from "../src/lib/image-size-presets";
import { imageParameterDefaults, imageParameterRequest, resolveImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { changeChannelModelProtocol, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";

const parameters = manifest.contributes.providers[0].imageParameters as ImageParameter[];
const definition: ModelProtocolDefinition = { value: "choosec-qwen-image", label: manifest.name, capability: "image", create: "POST /v1/images/generations", contentType: "application/json", media: "url", enabled: true, imageParameters: parameters };

describe("ChooseC Qwen image protocol", () => {
    test("uses documented image defaults without generic editing capabilities", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        expect(image).toMatchObject({
            references: { maxImages: 0, maxImageBytes: 0, maskSupported: false },
            size: { default: "1024x1024", values: [], allowCustom: true },
            quality: { default: "standard" },
            resolution: { supported: false },
            transparentBackground: { supported: false },
            outputFormat: { supported: false },
            maxOutputs: 10,
        });
        expect(imageParameterDefaults(image.parameters)).toEqual({ size: "1024x1024", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
    });

    test("selecting the protocol replaces incompatible settings and preserves price and availability", () => {
        const draft = initialChannelModelValues(null, [definition]);
        draft.capability = "image";
        draft.modelKey = "qwen-image-2.1-turbo";
        draft.enabled = false;
        draft.priceTiers[0].unitPrice = 19;
        const next = changeChannelModelProtocol(draft, definition.value, [definition]);
        expect(imageParameterDefaults(next.capabilityConfig?.image?.parameters)).toEqual({ size: "1024x1024", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
        expect(next.capabilityConfig?.image?.references.maxImages).toBe(0);
        expect(next.capabilityConfig?.image?.size.allowCustom).toBe(true);
        expect(next.capabilityConfig?.image?.size.presets?.some((preset) => preset.ratio === "9:16")).toBe(true);
        expect(next.priceTiers[0].unitPrice).toBe(19);
        expect(next.enabled).toBe(false);
        expect(defaultImageCapabilityConfig("openai-image").references.maxImages).toBe(16);
    });

    test("generation forwards defaults and rejects values outside the plugin contract", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        expect(imageParameterRequest(image, {}, true)).toEqual({ size: "1024x1024", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
        expect(() => imageParameterRequest(image, { count: "11" }, true)).toThrow();
        expect(imageParameterRequest(image, { size: "2048x2048", imageParameters: JSON.stringify({ style: "natural" }) }, true)).toMatchObject({ size: "2048x2048", style: "natural" });
        expect(imageTierAvailable(image, "2k")).toBe(true);
    });
});
