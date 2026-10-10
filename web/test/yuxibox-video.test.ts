import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";

describe("YuxiBox SD video protocol selection", () => {
    for (const [protocol, seconds, images, media] of [
        ["yuxibox-sd20", 15, 9, 3],
        ["yuxibox-sd25", 30, 30, 10],
        ["yuxibox-sd25-per-request", 30, 30, 10],
    ] as const) {
        test(`${protocol} replaces prior capabilities and preserves billing`, () => {
            const definition: ModelProtocolDefinition = { value: protocol, capability: "video", enabled: true, label: protocol, create: "POST /v1/videos", contentType: "application/json", media: "url" };
            const draft = initialChannelModelValues(null, [definition]);
            draft.priceTiers[0].unitPrice = 6;
            draft.priceTiers[0].billingMode = "per_second";
            const selected = changeChannelModelCapability({ ...draft, capability: "video", protocol }, [definition]);
            expect(selected.capabilityConfig?.video).toMatchObject({
                duration: { default: seconds },
                defaultResolution: "720p",
                resolutions: ["720p"],
                defaultRatio: "16:9",
                ratios: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
                references: { promptMaxChars: 16000, maxImages: images, maxAudios: media, maxVideos: media, maxImageBytes: 0, maxVideoBytes: 0, maxAudioBytes: 0 },
                generateAudio: { supported: false },
                watermark: { supported: false },
            });
            expect(selected.priceTiers[0].unitPrice).toBe(6);
            expect(selected.priceTiers[0].billingMode).toBe("per_second");
            expect(videoDurationAllowed(selected.capabilityConfig!.video!, 5)).toBe(true);
        });
    }
    test("2.0 presents discrete durations while 2.5 presents all 4–30 seconds", () => {
        const sd20 = defaultModelCapabilityConfig("yuxibox-sd20").video!;
        expect(videoDurationOptions(sd20)).toEqual([5, 10, 15]);
        expect(videoDurationAllowed(sd20, 6)).toBe(false);
        expect(normalizeVideoValue(sd20, { seconds: "6", ratio: "16:9", resolution: "1080p" })).toEqual({ seconds: "15", ratio: "16:9", resolution: "720p" });
        const sd25 = defaultModelCapabilityConfig("yuxibox-sd25").video!;
        expect(videoDurationOptions(sd25)).toEqual(Array.from({ length: 27 }, (_, i) => i + 4));
        expect(videoDurationAllowed(sd25, 31)).toBe(false);
    });
});
