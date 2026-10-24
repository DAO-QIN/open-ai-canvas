import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig, videoDurationOptions } from "../src/lib/model-capabilities";
import { changeChannelModelCapability, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { assertVideoCapability } from "../src/services/api/video-validation";
import type { ReferenceVideo } from "../src/types/media";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasVideoPromptTools } from "../src/components/canvas/canvas-video-prompt-tools";

describe("Kling omni", () => {
    test("hides unsupported tail frames while keeping legacy controls", () => {
        const props = { frameOptions: [{ nodeId: "image", label: "参考图", title: "海面" }], onMetadataChange: () => {} };
        const current = renderToStaticMarkup(createElement(CanvasVideoPromptTools, { ...props, lastFrameSupported: false }));
        expect(current).toContain("首帧");
        expect(current).not.toContain("尾帧");
        expect(renderToStaticMarkup(createElement(CanvasVideoPromptTools, props))).toContain("尾帧");
    });
    const profile = () => defaultModelCapabilityConfig("kling-video-omni").video!;
    test("selecting the protocol replaces stale defaults and preserves price/status", () => {
        const definition: ModelProtocolDefinition = { value: "kling-video-omni", capability: "video", enabled: true, label: "可灵全能视频", create: "POST /v1/videos", contentType: "application/json", media: "url" };
        const draft = initialChannelModelValues(null, [definition]);
        draft.enabled = false;
        draft.priceTiers[0].unitPrice = 12;
        const selected = changeChannelModelCapability({ ...draft, capability: "video", protocol: definition.value }, [definition]);
        expect(selected.capabilityConfig!.video).toEqual(profile());
        expect(selected.enabled).toBe(false);
        expect(selected.priceTiers[0].unitPrice).toBe(12);
        expect(profile()).toMatchObject({
            duration: { min: 3, max: 30, step: 1, default: 5 },
            defaultRatio: "16:9",
            ratios: ["16:9", "9:16", "1:1", "21:9"],
            resolutions: ["720p", "1080p"],
            defaultResolution: "720p",
            references: { maxImages: 10, maxVideos: 5, maxAudios: 3, maxTotalItems: 15, maxTotalVideoDurationSeconds: 30, lastFrameSupported: false },
        });
        expect(videoDurationOptions(profile())).toEqual(Array.from({ length: 28 }, (_, i) => i + 3));
    });
    const video = (durationMs?: number) => ({ id: "v", name: "v", type: "video/mp4", dataUrl: "", url: "https://example.com/video.mp4", durationMs }) as ReferenceVideo;
    test("rejects missing duration and combined duration above the limit", () => {
        expect(() => assertVideoCapability(profile(), [], [video()], [], "5")).toThrow("读取视频时长");
        expect(() => assertVideoCapability(profile(), [], [video(15001), video(15000)], [], "5")).toThrow("30 秒");
        expect(() => assertVideoCapability(profile(), [], [video(15000), video(15000)], [], "5")).not.toThrow();
    });
    test("rejects tail frames, combined reference overflow and duration range", () => {
        const image = { id: "i", name: "i", type: "image/png", dataUrl: "" };
        expect(() => assertVideoCapability(profile(), [{ ...image, role: "last_frame" }], [], [], "5")).toThrow("尾帧");
        const audio = { id: "a", name: "a", type: "audio/mpeg", dataUrl: "" };
        expect(() => assertVideoCapability(profile(), Array(10).fill(image), Array(5).fill(video(1000)), [audio], "5")).toThrow("15 项");
        expect(() => assertVideoCapability(profile(), [], [], [], "2")).toThrow("时长");
    });
});
