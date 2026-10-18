import { expect, test } from "bun:test";
import manifest from "../../plugin-packages/cangyuan-seedream/manifest.json";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { changeChannelModelProtocol, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

test("selecting Cangyuan Seedream resets capabilities and retains price", () => {
    const p = manifest.contributes.providers[0];
    const definition = { value: p.id, label: p.label, capability: "image", create: "POST /v1/images/generations", contentType: "application/json", media: "url", imageParameters: p.imageParameters } as ModelProtocolDefinition;
    const draft = initialChannelModelValues(null, [definition]);
    draft.capability = "image";
    draft.modelKey = "doubao-seedream-5-0-pro";
    draft.priceTiers[0].unitPrice = 19;
    const changed = changeChannelModelProtocol(draft, p.id, [definition]);
    expect(changed.capabilityConfig?.image).toMatchObject({ references: { maxImages: 10, maskSupported: false, maxImageBytes: 20 * 1024 * 1024 }, size: { default: "1:1" }, maxOutputs: 1, resolution: { supported: false }, quality: { supported: false }, transparentBackground: { supported: false } });
    expect(changed.capabilityConfig?.image?.parameters?.find((v) => v.name === "outputFormat")?.default).toBe("jpeg");
    expect(changed.priceTiers[0].unitPrice).toBe(19);
    expect(changed.capabilityConfig?.image?.size.values).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"]);
    expect(defaultImageCapabilityConfig(p.id).size.values).toContain("21:9");
});
