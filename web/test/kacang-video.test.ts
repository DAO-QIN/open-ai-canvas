import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, normalizeVideoValue, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

describe("Kacang video protocol defaults", () => {
    for (const [protocol, min, max, seconds, resolution, images, videos] of [
        ["kacang-gemini-omni-video", 3, 10, 3, "720p", 4, 1],
        ["kacang-grok-video-15", 4, 15, 8, "480p", 14, 0],
        ["kacang-kling-video-30", 1, 15, 5, "720p", 1, 0],
    ] as const) {
        test(`${protocol} replaces stale capability defaults and preserves prices/status`, () => {
            const definition: ModelProtocolDefinition = { value: protocol, capability: "video", enabled: true, label: protocol, create: "POST /v1/videos", contentType: "application/json", media: "url" };
            const draft = initialChannelModelValues(null, [definition]);
            draft.enabled = false;
            draft.priceTiers[0].unitPrice = 6;
            draft.priceTiers[0].billingMode = "fixed_request";
            const selected = changeChannelModelCapability({ ...draft, capability: "video", protocol }, [definition]);
            const profile = selected.capabilityConfig!.video!;
            expect(profile).toMatchObject({
                duration: { selection: "range", min, max, step: 1, default: seconds },
                defaultResolution: resolution,
                defaultRatio: "16:9",
                references: { promptMaxChars: 8000, maxImages: images, maxVideos: videos, maxAudios: 0, maxImageBytes: 0, maxVideoBytes: 0, maxAudioBytes: 0 },
                generateAudio: { supported: false, default: false },
                watermark: { supported: false, default: false },
            });
            expect(profile.resolutions).toEqual(protocol === "kacang-grok-video-15" ? ["480p", "720p", "1080p"] : ["720p"]);
            expect(selected.priceTiers[0].unitPrice).toBe(6);
            expect(selected.priceTiers[0].billingMode).toBe("fixed_request");
            expect(selected.enabled).toBe(false);
            expect(videoDurationOptions(profile)).toEqual(Array.from({ length: max - min + 1 }, (_, index) => min + index));
            expect(normalizeVideoValue(profile, { seconds: "31", ratio: "21:9", resolution: "2160p" })).toEqual({ seconds: String(max), ratio: "16:9", resolution });
            expect(defaultModelCapabilityConfig(protocol).video).toEqual(profile);
        });
    }
});
