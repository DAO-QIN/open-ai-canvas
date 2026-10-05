import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, normalizeVideoValue, videoCapabilityForResolution, videoDurationAllowed, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

describe("968API SD video defaults and selection", () => {
    for (const [protocol, seconds, images, audios] of [
        ["api968-sd20", 15, 9, 3],
        ["api968-sdc2", 15, 9, 3],
        ["api968-sd25", 30, 14, 10],
        ["api968-sd25-15", 15, 9, 0],
        ["api968-sdmini", 8, 9, 3],
    ] as const) {
        test(`${protocol} fills capabilities when selecting the protocol`, () => {
            const definition: ModelProtocolDefinition = { value: protocol, capability: "video", enabled: true, label: protocol, create: "POST /v1/videos/generations", contentType: "application/json", media: "url" };
            const draft = initialChannelModelValues(null, [definition]);
            draft.priceTiers[0].unitPrice = 6;
            const selected = changeChannelModelCapability({ ...draft, capability: "video", protocol }, [definition]);
            expect(selected.capabilityConfig?.video).toMatchObject({ duration: { default: seconds }, defaultResolution: "720p", defaultRatio: "16:9", references: { maxImages: images, maxAudios: audios, maxVideos: 0 } });
            expect(selected.priceTiers[0].unitPrice).toBe(6);
        });
    }
    test("resolution changes clamp sdmini duration without modifying saved capability", () => {
        const profile = defaultModelCapabilityConfig("api968-sdmini", "sdmini").video!;
        expect(videoDurationAllowed(profile, 13, "720")).toBe(false);
        expect(videoDurationAllowed(profile, 15, "480p")).toBe(true);
        expect(videoDurationAllowed(profile, 13)).toBe(false);
        expect(normalizeVideoValue(profile, { resolution: "720", seconds: "15", ratio: "16:9" })).toEqual({ resolution: "720p", seconds: "12", ratio: "16:9" });
        expect(normalizeVideoValue(profile, { resolution: "480", seconds: "15" }).seconds).toBe("15");
        expect(videoDurationOptions(profile, "720p").at(-1)).toBe(12);
        expect(videoDurationOptions(profile, "480p").at(-1)).toBe(15);
        expect(videoDurationOptions(videoCapabilityForResolution(profile, "480p")).at(-1)).toBe(15);
        expect(profile.duration.maxByResolution).toEqual({ "480p": 15, "720p": 12 });
        expect(profile.duration.max).toBe(15);
    });
});
