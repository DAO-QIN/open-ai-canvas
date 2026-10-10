import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, normalizeVideoValue, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

describe("XingAPI SD protocol defaults", () => {
    for (const [protocol, min, max, resolution, images, videos, audios] of [
        ["xingapi-sd-mini-480p", 5, 10, "480p", 9, 0, 3],
        ["xingapi-sd-mini-720p", 5, 15, "720p", 9, 0, 0],
        ["xingapi-sd-933", 4, 15, "720p", 9, 0, 3],
        ["xingapi-sd-933-v", 5, 15, "720p", 9, 3, 3],
        ["xingapi-sd25", 5, 30, "720p", 30, 10, 10],
    ] as const) {
        test(`${protocol} replaces stale capabilities on selection and preserves pricing`, () => {
            const definition: ModelProtocolDefinition = { value: protocol, capability: "video", enabled: true, label: protocol, create: "POST /v1/videos/generations", contentType: "application/json", media: "url" };
            const draft = initialChannelModelValues(null, [definition]);
            draft.priceTiers[0].unitPrice = 6;
            draft.priceTiers[0].billingMode = "fixed_request";
            const selected = changeChannelModelCapability({ ...draft, capability: "video", protocol }, [definition]);
            const profile = selected.capabilityConfig!.video!;
            expect(profile).toMatchObject({
                duration: { selection: "range", min, max, step: 1, default: 5 },
                defaultResolution: resolution,
                resolutions: [resolution],
                ratios: ["16:9", "9:16"],
                defaultRatio: "16:9",
                references: { promptMaxChars: 8000, maxImages: images, maxVideos: videos, maxAudios: audios, maxImageBytes: 0, maxVideoBytes: 0, maxAudioBytes: 0 },
                generateAudio: { supported: false },
                watermark: { supported: false },
            });
            expect(selected.priceTiers[0].unitPrice).toBe(6);
            expect(selected.priceTiers[0].billingMode).toBe("fixed_request");
            expect(videoDurationOptions(profile)).toEqual(Array.from({ length: max - min + 1 }, (_, index) => min + index));
            expect(normalizeVideoValue(profile, { seconds: "31", ratio: "1:1", resolution: "1080p" })).toEqual({ seconds: String(max), ratio: "16:9", resolution });
            expect(defaultModelCapabilityConfig(protocol).video).toEqual(profile);
        });
    }
});
