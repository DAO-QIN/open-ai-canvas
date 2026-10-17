import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ImageParameterFields, ImageParameterSchemaEditor, ImageParameterSizeEditor } from "../src/components/image-parameter-fields";
import manifest from "../../plugin-packages/choosec-qwen-image/manifest.json";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { imageTierAvailable } from "../src/lib/image-size-presets";
import { imageParameterDefaults, imageParameterRequest, resolveImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { changeChannelModelProtocol, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import { defaultConfig } from "../src/stores/use-config-store";
import { capabilitySpecFromChannelModel, mergeCapabilitySpecs } from "../src/pages/admin/logical-models/model-routing-capabilities";
import { projectLogicalCapability } from "../src/lib/user-session";
import type { ChannelModel } from "../src/services/api/wallet";

const parameters = manifest.contributes.providers[0].imageParameters as ImageParameter[];
const definition: ModelProtocolDefinition = { value: "choosec-qwen-image", label: manifest.name, capability: "image", create: "POST /v1/images/generations", contentType: "application/json", media: "url", enabled: true, imageParameters: parameters };

describe("ChooseC Qwen image protocol", () => {
    test("uses reference and 1K defaults without unverified 4K or mask controls", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        expect(image).toMatchObject({
            references: { maxImages: 10, maxImageBytes: 10 * 1024 * 1024, maskSupported: false },
            size: { default: "1024x1024", values: [], allowCustom: true },
            quality: { default: "standard" },
            resolution: { supported: true, values: ["1k"], default: "1k" },
            transparentBackground: { supported: false },
            outputFormat: { supported: false },
            maxOutputs: 10,
        });
        expect(imageParameterDefaults(image.parameters)).toEqual({ size: "1024x1024", imageResolution: "1k", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
        expect(image.size.presets?.every((preset) => preset.tier === "1k")).toBe(true);
    });

    test("selecting the protocol replaces incompatible settings and preserves price and availability", () => {
        const draft = initialChannelModelValues(null, [definition]);
        draft.capability = "image";
        draft.modelKey = "qwen-image-2.1-turbo";
        draft.enabled = false;
        draft.priceTiers[0].unitPrice = 19;
        const next = changeChannelModelProtocol(draft, definition.value, [definition]);
        expect(imageParameterDefaults(next.capabilityConfig?.image?.parameters)).toEqual({ size: "1024x1024", imageResolution: "1k", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
        expect(next.capabilityConfig?.image?.references.maxImages).toBe(10);
        expect(next.capabilityConfig?.image?.size.allowCustom).toBe(true);
        expect(next.capabilityConfig?.image?.resolution.values).toEqual(["1k"]);
        expect(next.capabilityConfig?.image?.size.presets?.some((preset) => preset.ratio === "9:16")).toBe(true);
        expect(next.priceTiers[0].unitPrice).toBe(19);
        expect(next.enabled).toBe(false);
        expect(defaultImageCapabilityConfig("openai-image").references.maxImages).toBe(16);
    });

    test("generation forwards defaults and rejects values outside the plugin contract", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        expect(imageParameterRequest(image, {}, true)).toEqual({ size: "1024x1024", imageResolution: "1k", quality: "standard", count: 1, style: "vivid", responseFormat: "url" });
        expect(() => imageParameterRequest(image, { count: "11" }, true)).toThrow();
        expect(imageParameterRequest(image, { size: "2048x2048", imageParameters: JSON.stringify({ style: "natural" }) }, true)).toMatchObject({ size: "2048x2048", style: "natural" });
        expect(imageTierAvailable(image, "2k")).toBe(false);
        expect(imageTierAvailable(image, "4k")).toBe(false);
    });

    test("consumer panel hides technical fields while admin and defaults retain them", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        const html = renderToStaticMarkup(createElement(ImageParameterFields, { profile: image, config: { ...defaultConfig, size: "1024x1024", imageResolution: "1k" }, onChange: () => {} }));
        expect(html).toContain("清晰度");
        expect(html).toContain("1K");
        expect(html).not.toContain("2K");
        expect(html).toContain("1024 × 1024");
        for (const label of ["画风", "响应格式", "图片质量", "vivid", "standard", "4K"]) expect(html).not.toContain(label);
        const admin = renderToStaticMarkup(createElement(ImageParameterSchemaEditor, { definitions: parameters, parameters: image.parameters!, onChange: () => {} }));
        expect(admin).toContain("前台展示画风");
        expect(admin).toContain("前台展示响应格式");
        expect(admin).toContain("vivid");
        const sizeEditor = renderToStaticMarkup(createElement(ImageParameterSizeEditor, { profile: image, definition: parameters.find((field) => field.name === "size")!, onChange: () => {} }));
        expect(sizeEditor).toMatch(/aria-pressed="true" title="1024x1024" aria-label="默认输出 1K · 1:1 1024x1024"/);
        expect(image.size.values).toEqual([]);
        expect(imageParameterRequest(image, {}, true)?.style).toBe("vivid");
    });

    test("channel visibility overrides survive resolving and reopening", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        image.parameters = image.parameters!.map((field) => (field.name === "style" ? { ...field, userVisible: true } : field));
        const reopened = resolveImageParameters(JSON.parse(JSON.stringify(image)), parameters, "qwen-image-2.1-turbo");
        const html = renderToStaticMarkup(createElement(ImageParameterFields, { profile: reopened, config: defaultConfig, onChange: () => {} }));
        expect(html).toContain("画风");
        expect(html).not.toContain("响应格式");
        expect(imageParameterRequest(reopened, {}, true)?.responseFormat).toBe("url");
    });

    test("public logical model projection retains hidden defaults and reference capability", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        const spec = capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image } } as ChannelModel)!;
        const merged = mergeCapabilitySpecs("image", [spec, spec]);
        const projected = projectLogicalCapability(merged, imageParameterDefaults(image.parameters)).image!;
        expect(projected.references.maxImages).toBe(10);
        expect(projected.resolution.values).toEqual(["1k"]);
        expect(projected.parameters?.find((field) => field.name === "style")?.userVisible).toBe(false);
        expect(imageParameterRequest(projected, {}, true)?.style).toBe("vivid");
        expect(projected.size.allowCustom).toBe(true);
        expect(imageParameterRequest(projected, { size: "1600x900" }, true)?.size).toBe("1600x900");
        const visible = { ...spec, imageParameters: spec.imageParameters!.map((field) => (field.name === "style" ? { ...field, userVisible: true } : field)) };
        expect(mergeCapabilitySpecs("image", [spec, visible]).imageParameters?.find((field) => field.name === "style")?.userVisible).not.toBe(false);
    });

    test("grouped size controls follow visibility without altering request defaults", () => {
        const image = resolveImageParameters(defaultImageCapabilityConfig(definition.value), parameters, "qwen-image-2.1-turbo");
        const noResolution = { ...image, parameters: image.parameters!.map((field) => (field.name === "imageResolution" ? { ...field, userVisible: false } : field)) };
        const config = { ...defaultConfig, size: "1024x1024", imageResolution: "1k" };
        const ratios = renderToStaticMarkup(createElement(ImageParameterFields, { profile: noResolution, config, onChange: () => {} }));
        expect(ratios).not.toContain("清晰度");
        expect(ratios).toContain("1024 × 1024");
        const noSize = { ...image, parameters: image.parameters!.map((field) => (field.name === "size" ? { ...field, userVisible: false } : field)) };
        const resolution = renderToStaticMarkup(createElement(ImageParameterFields, { profile: noSize, config, onChange: () => {} }));
        expect(resolution).toContain("清晰度");
        expect(resolution).not.toContain("宽高比");
        expect(imageParameterRequest(noResolution, {}, true)?.imageResolution).toBe("1k");
    });
});
