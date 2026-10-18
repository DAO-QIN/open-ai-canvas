import { expect, test } from "bun:test";
import { effectivePet, petMenuPosition, sanitizePetPreference } from "../src/lib/canvas/pet-menu";
import { DEFAULT_CANVAS_APPEARANCE } from "../src/lib/canvas/agent-appearance";
import type { PetAppearance } from "../src/services/api/appearance";

test("published personal choice preserves assistant identity and falls back after unpublish", () => {
    const base = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "阿Q" };
    const pet: PetAppearance = { id: "custom", name: "仅展示名称", published: true, avatarType: "orb", avatarHeight: 300, live2dResourceId: "", live2dEntry: "" };
    expect(effectivePet(base, [pet], pet.id).agentName).toBe("阿Q");
    expect(effectivePet(base, [pet], pet.id).avatarHeight).toBe(300);
    expect(effectivePet(base, [{ ...pet, published: false }], pet.id)).toBe(base);
    expect(effectivePet(base, [pet], "system")).toBe(base);
});
test("menu stays inside every viewport corner independently of pet dimensions", () => {
    for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
        { width: 320, height: 400 },
    ])
        for (const x of [0, viewport.width - 200])
            for (const y of [0, viewport.height - 200]) {
                const p = petMenuPosition({ left: x, top: y, width: 200, height: 200 }, viewport);
                expect(p.left).toBeGreaterThanOrEqual(12);
                expect(p.top).toBeGreaterThanOrEqual(12);
                expect(p.left + p.width).toBeLessThanOrEqual(viewport.width - 12);
                expect(p.top + p.height).toBeLessThanOrEqual(viewport.height - 12);
            }
});
test("corrupt cached settings cannot create oversized or non-finite pets", () => {
    expect(sanitizePetPreference({ scale: Infinity }).scale).toBe(150);
    expect(sanitizePetPreference({ scale: 55 }).scale).toBe(55);
    expect(sanitizePetPreference({ scale: 1 }).scale).toBe(50);
    expect(sanitizePetPreference({ scale: NaN }).scale).toBe(100);
});
