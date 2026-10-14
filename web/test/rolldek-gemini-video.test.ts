import { describe, expect, test } from "bun:test";
import { FormStore } from "@rc-component/form/lib/hooks/useForm";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, normalizeVideoValue, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelProtocol, channelModelCapabilityConfigForSave, initialChannelModelValues, replaceChannelModelFormValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

const definitions: ModelProtocolDefinition[] = ["rolldek-gemini-omni-video", "rolldek-veo-fast-video", "rolldek-wan-video"].map((value) => ({
    value,
    capability: "video",
    enabled: true,
    label: value,
    create: "POST /v1/videos",
    contentType: "application/json",
    media: "url",
}));

describe("RollDek Gemini and Veo defaults", () => {
    test("the real form store removes omitted Gemini fields when switching protocols", () => {
        const form = new FormStore(() => {}).getForm();
        const values = initialChannelModelValues(null, definitions);
        values.capability = "video";
        values.modelKey = "gemini-omni-1.1-flash";
        values.enabled = false;
        values.priceTiers[0].unitPrice = 23;
        const omni = changeChannelModelProtocol(values, "rolldek-gemini-omni-video", definitions);
        form.setFieldsValue(omni);
        const fast = changeChannelModelProtocol(omni, "rolldek-veo-fast-video", definitions);
        form.setFieldsValue(fast);
        expect(form.getFieldValue(["capabilityConfig", "video", "references", "maxReferenceImages"])).toBe(1);
        replaceChannelModelFormValues(form, fast);
        expect(form.getFieldValue(["capabilityConfig", "video", "references", "maxReferenceImages"])).toBeUndefined();
        expect(form.getFieldValue("capabilityConfig").video.references.maxImages).toBe(0);
        expect(form.getFieldValue("enabled")).toBe(false);
        expect(form.getFieldValue("priceTiers")[0].unitPrice).toBe(23);
        replaceChannelModelFormValues(form, changeChannelModelProtocol(fast, "rolldek-gemini-omni-video", definitions));
        expect(form.getFieldValue("capabilityConfig").video.references).toMatchObject({ maxImages: 3, maxReferenceImages: 1 });
        replaceChannelModelFormValues(form, changeChannelModelProtocol(omni, "rolldek-wan-video", definitions));
        expect(form.getFieldValue("capabilityConfig").video.references.maxReferenceImages).toBeUndefined();
    });
    test("selection replaces stale WAN values, saves and reopens without changing prices", () => {
        const before = initialChannelModelValues(null, definitions);
        before.modelKey = "gemini-omni-1.1-flash";
        before.capability = "video";
        before.enabled = false;
        before.priceTiers[0].unitPrice = 23;
        before.priceTiers[0].billingMode = "fixed_request";
        const changed = changeChannelModelProtocol(before, "rolldek-gemini-omni-video", definitions);
        expect(changed.priceTiers).toEqual(before.priceTiers);
        expect(changed.enabled).toBe(false);
        const profile = changed.capabilityConfig!.video!;
        expect(profile.references).toMatchObject({ maxImages: 3, maxReferenceImages: 1, maxVideos: 1, maxAudios: 1, maxImageBytes: 0, maxVideoBytes: 0, maxAudioBytes: 0 });
        expect(videoDurationOptions(profile)).toEqual([4, 6, 8, 10]);
        expect(profile.generateAudio).toEqual({ supported: false, default: false });
        expect(profile.watermark).toEqual({ supported: false, default: false });
        expect(normalizeVideoValue(profile, { seconds: "5", ratio: "1:1", resolution: "1080p" })).toMatchObject({ seconds: "4", ratio: "16:9", resolution: "720p" });
        profile.references.maxImages = 5;
        profile.references.maxReferenceImages = 2;
        profile.references.maxVideos = 2;
        const saved = channelModelCapabilityConfigForSave(changed)!;
        const reopened = initialChannelModelValues({ ...changed, capabilityConfig: JSON.parse(JSON.stringify(saved)) } as any, definitions);
        expect(reopened.capabilityConfig!.video!.references).toEqual(saved.video!.references);
        expect(normalizeModelCapabilityConfig(saved).video!.references.maxReferenceImages).toBe(2);
        const switched = changeChannelModelProtocol(changed, "rolldek-veo-fast-video", definitions);
        expect(switched.capabilityConfig!.video!.references.maxReferenceImages).toBeUndefined();
        expect(switched.capabilityConfig!.video!.references.maxImages).toBe(0);
        expect(switched.priceTiers).toEqual(before.priceTiers);
    });
    test("Veo Fast uses only its public example and does not inherit Gemini references", () => {
        const profile = defaultModelCapabilityConfig("rolldek-veo-fast-video").video!;
        expect(videoDurationOptions(profile)).toEqual([8]);
        expect(profile.duration.default).toBe(8);
        expect(profile.ratios).toEqual(["16:9"]);
        expect(profile.resolutions).toEqual(["720p"]);
        expect(profile.operations).toEqual(["text_to_video"]);
        expect(profile.references).toMatchObject({ maxImages: 0, maxVideos: 0, maxAudios: 0 });
        expect(profile.generateAudio).toEqual({ supported: false, default: false });
    });
});
