import { describe, expect, mock, test } from "bun:test";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { audioChannelCapabilityConfig, channelModelCapabilityConfigForSave, changeChannelModelCapability, initialChannelModelValues } from "@/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import * as resources from "@/services/api/resources";

mock.module("@/services/api/resources", () => ({ ...resources, getResourceAccess: async (key: string) => ({ url: `https://media.example/${key.slice("resource:".length)}.mp3` }) }));
const { applyGenerationTaskResultToNodes, generationTaskOutputsApplied } = await import("@/lib/canvas/canvas-generation-task-sync");
const { resetGenerationTaskMetadata } = await import("@/lib/canvas/canvas-task-state");

const protocols: ModelProtocolDefinition[] = [{ value: "kacang-suno", capability: "audio", label: "卡藏 Suno 音乐", create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];

describe("Kacang Suno music", () => {
    test("protocol selection fills music defaults and keeps prices and disabled state", () => {
        const initial = initialChannelModelValues(null, protocols);
        initial.enabled = false;
        initial.priceTiers[0].unitPrice = 23;
        const selected = changeChannelModelCapability({ ...initial, capability: "audio", protocol: "kacang-suno", modelKey: "suno" }, protocols);
        expect(selected.capabilityConfig).toEqual({ version: 1, audio: { generationType: "music", taskCount: 1, outputCount: 2, streaming: false } });
        expect(selected.enabled).toBe(false);
        expect(selected.priceTiers[0].unitPrice).toBe(23);
        expect(channelModelCapabilityConfigForSave(selected)).toEqual(selected.capabilityConfig);
        expect(channelModelCapabilityConfigForSave({ ...selected, protocol: "openai-audio" })).toBeUndefined();
        expect(defaultModelCapabilityConfig("kacang-suno", "suno").audio).toEqual(selected.capabilityConfig?.audio);
        expect(audioChannelCapabilityConfig("openai-audio")).toBeUndefined();
    });

    test("saving a disabled unpriced music model retains its capability contract", () => {
        const selected = changeChannelModelCapability({ ...initialChannelModelValues(null, protocols), capability: "audio", protocol: "kacang-suno", modelKey: "suno", enabled: false }, protocols);
        selected.priceTiers[0].priceConfigured = false;
        selected.priceTiers[0].enabled = false;
        const profile = channelModelCapabilityConfigForSave(selected);
        expect(profile?.audio).toEqual({ generationType: "music", taskCount: 1, outputCount: 2, streaming: false });
        expect(selected.enabled).toBe(false);
        expect(selected.priceTiers[0].priceConfigured).toBe(false);
        expect(selected.priceTiers[0].enabled).toBe(false);
    });

    test("both tracks land once, retain separate resources, and preserve moved/renamed second track", async () => {
        const task: GenerationTask = {
            id: "music-task",
            type: "canvas_audio",
            status: "succeeded",
            prompt: "温柔钢琴，无人声",
            model: "suno",
            attempts: 1,
            createdAt: "",
            updatedAt: "",
            inputJson: JSON.stringify({ mode: "audio", metadata: { nodeId: "root" } }),
            resultJson: JSON.stringify({
                mode: "audio",
                audios: [
                    { dataUrl: "/api/resources/one/file", storageKey: "resource:one", durationMs: 10000 },
                    { dataUrl: "/api/resources/two/file", storageKey: "resource:two", durationMs: 12000 },
                ],
            }),
            outputs: [
                { outputIndex: 0, mediaType: "audio", materializedAssetId: "asset-one" },
                { outputIndex: 1, mediaType: "audio", materializedAssetId: "asset-two" },
            ],
        };
        const root: CanvasNodeData = { id: "root", title: "配乐", type: CanvasNodeType.Audio, width: 420, height: 180, position: { x: 10, y: 20 }, metadata: { taskId: task.id } };
        const first = await applyGenerationTaskResultToNodes([root], task);
        expect(first.nodes).toHaveLength(2);
        expect(first.nodes[0].metadata).toMatchObject({ storageKey: "resource:one", assetId: "asset-one", generationOutputCount: 2, generationOutputIndex: 0 });
        expect(first.nodes[1].metadata).toMatchObject({ storageKey: "resource:two", assetId: "asset-two", generationOutputIndex: 1 });
        const edited = { ...first.nodes[1], title: "我的第二首", position: { x: 3000, y: 2000 } };
        const replay = await applyGenerationTaskResultToNodes([first.nodes[0], edited], task);
        expect(replay.nodes).toHaveLength(2);
        expect(replay.nodes[1]).toEqual(edited);
        expect(generationTaskOutputsApplied(replay.nodes[0], task)).toBe(true);
        expect(generationTaskOutputsApplied(replay.nodes[1], task)).toBe(true);
        const replaySecond = await applyGenerationTaskResultToNodes(replay.nodes, task, edited.id);
        expect(replaySecond.nodes).toHaveLength(2);
        expect(replaySecond.nodes[1].metadata?.storageKey).toBe("resource:two");
        expect(resetGenerationTaskMetadata(edited.metadata || {}).generationOutputIndex).toBeUndefined();
    });
});
