import { expect, test } from "bun:test";
import { DEFAULT_CANVAS_APPEARANCE, agentAvatarClipForState, suggestedAgentAvatarClipStates } from "../src/lib/canvas/agent-appearance";
import { effectivePet } from "../src/lib/canvas/pet-menu";
import type { PetAppearance } from "../src/services/api/appearance";

test("personal catalog bundle retains its own resource and runtime state mappings", () => {
    const pet: PetAppearance = { id: "video", name: "动画", published: true, avatarType: "bundle", avatarHeight: 220, live2dResourceId: "", live2dEntry: "", avatarBundleResourceId: "personal-resource", avatarClipStates: { running: "work" } };
    const selected = effectivePet({ ...DEFAULT_CANVAS_APPEARANCE, avatarBundleResourceId: "system-resource" }, [pet], "video");
    expect(selected.avatarBundleResourceId).toBe("personal-resource");
    expect(agentAvatarClipForState(selected, "running", { version: 1, width: 480, height: 432, clips: { idle: "idle.mp4", work: "work.mp4" } })).toBe("work");
    expect(effectivePet(DEFAULT_CANVAS_APPEARANCE, [{ ...pet, published: false }], "video")).toBe(DEFAULT_CANVAS_APPEARANCE);
});

test("imported clips map every run state to an available animation", () => {
    const manifest = { version: 1 as const, width: 480, height: 432, clips: { Idle: "idle.mp4", WorkingLoop: "work.mp4", Wave: "wave.mp4" } };
    const states = suggestedAgentAvatarClipStates(manifest);
    expect(states.running).toBe("WorkingLoop");
    expect(states.completed).toBe("Wave");
    for (const clip of Object.values(states)) expect(Object.hasOwn(manifest.clips, clip)).toBe(true);
});
