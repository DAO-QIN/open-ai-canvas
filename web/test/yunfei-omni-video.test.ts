import { describe, expect, test } from "bun:test";
import { FormStore } from "@rc-component/form/lib/hooks/useForm";
import { defaultModelCapabilityConfig, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelProtocol, channelModelCapabilityConfigForSave, initialChannelModelValues, replaceChannelModelFormValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

const definitions: ModelProtocolDefinition[] = ["yunfei-omni-flash-video", "rolldek-gemini-omni-video", "rolldek-veo-fast-video"].map((value) => ({
    value,
    capability: "video",
    enabled: true,
    label: value,
    create: "POST /v1/videos",
    contentType: "application/json",
    media: "url",
}));

describe("Yunfei omni-flash video defaults", () => {
    test("real form store resets incompatible values without changing prices or availability", () => {
        const form = new FormStore(() => {}).getForm();
        const values = initialChannelModelValues(null, definitions);
        values.modelKey = "omni-flash";
        values.capability = "video";
        values.enabled = false;
        values.priceTiers[0].unitPrice = 23;
        const roll = changeChannelModelProtocol(values, "rolldek-gemini-omni-video", definitions);
        replaceChannelModelFormValues(form, roll);
        expect(form.getFieldValue("capabilityConfig").video.duration.default).toBe(4);
        const changed = changeChannelModelProtocol(roll, "yunfei-omni-flash-video", definitions);
        replaceChannelModelFormValues(form, changed);
        const profile = form.getFieldValue("capabilityConfig").video;
        expect(profile.duration).toEqual({ selection: "enum", values: [10], default: 10 });
        expect(profile.ratios).toEqual(["16:9", "9:16"]);
        expect(profile.resolutions).toEqual(["720p"]);
        expect(profile.references).toMatchObject({ maxImages: 3, maxReferenceImages: 1, maxVideos: 1, maxAudios: 1 });
        expect(profile.generateAudio).toEqual({ supported: false, default: false });
        expect(profile.operations).toEqual(["text_to_video", "image_to_video", "reference_to_video", "audio_to_video"]);
        expect(form.getFieldValue("enabled")).toBe(false);
        expect(form.getFieldValue("priceTiers")[0].unitPrice).toBe(23);
        replaceChannelModelFormValues(form, changeChannelModelProtocol(changed, "rolldek-veo-fast-video", definitions));
        expect(form.getFieldValue("capabilityConfig").video.references.maxReferenceImages).toBeUndefined();
        replaceChannelModelFormValues(form, changeChannelModelProtocol(changed, "rolldek-gemini-omni-video", definitions));
        expect(form.getFieldValue("capabilityConfig").video.duration.values).toEqual([4, 6, 8, 10]);
    });
    test("save and reopen preserve configurable platform reference limits", () => {
        const values = changeChannelModelProtocol(initialChannelModelValues(null, definitions), "yunfei-omni-flash-video", definitions);
        values.modelKey = "omni-flash";
        values.capabilityConfig!.video!.references.maxReferenceImages = 2;
        values.capabilityConfig!.video!.references.maxImages = 4;
        const saved = channelModelCapabilityConfigForSave(values)!;
        const reopened = initialChannelModelValues({ ...values, capabilityConfig: JSON.parse(JSON.stringify(saved)) } as any, definitions);
        expect(reopened.capabilityConfig!.video).toEqual(saved.video);
        expect(videoDurationOptions(defaultModelCapabilityConfig("yunfei-omni-flash-video").video!)).toEqual([10]);
    });
});
