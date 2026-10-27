import { expect, test } from "bun:test";
import { assistantAppearance, DEFAULT_CANVAS_APPEARANCE, agentAvatarClipForState } from "../src/lib/canvas/agent-appearance";

test("shared assistant retires a sprite choice without changing identity", () => {
    const value={...DEFAULT_CANVAS_APPEARANCE, agentName:"阿Q", avatarType:"sprite" as const, defaultPetId:"old", spriteResourceId:"old-resource"};
    const result=assistantAppearance(value);
    expect(result.avatarType).toBe("bundle");expect(result.agentName).toBe("阿Q");
    expect(result.defaultPetId).toBe("");expect(result.spriteResourceId).toBe("");
    expect(value.spriteResourceId).toBe("old-resource");
});

test("global bundle and Live2D settings remain independent from former personal choices", () => {
    const value={...DEFAULT_CANVAS_APPEARANCE, avatarBundleResourceId:"new-bundle", avatarClipStates:{idle:"rest", running:"work"}};
    const result=assistantAppearance(value);
    expect(result.avatarBundleResourceId).toBe("new-bundle");
    expect(agentAvatarClipForState(result,"running",{version:1,width:480,height:432,clips:{rest:"rest.mp4",work:"work.mp4"}})).toBe("work");
    expect(assistantAppearance({...value,avatarType:"live2d",live2dResourceId:"model",live2dEntry:"main.model3.json"}).live2dResourceId).toBe("model");
});

test("omitted empty legacy fields do not make a saved assistant draft dirty", () => {
    const server={...DEFAULT_CANVAS_APPEARANCE};
    const draft=assistantAppearance(server);
    expect(JSON.stringify(draft)).toBe(JSON.stringify(assistantAppearance(server)));
    expect(assistantAppearance(draft)).toEqual(draft);
});
