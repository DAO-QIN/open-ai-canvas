import type { CanvasAppearance } from "./agent-appearance";
import type { PetAppearance, PetPreference } from "@/services/api/appearance";

export const DEFAULT_PET_PREFERENCE: PetPreference = { modelId: "system", scale: 100, locked: false, hidden: false, revision: 0 };
export function effectivePet(canvas: CanvasAppearance, catalog: PetAppearance[], modelId: string): CanvasAppearance {
    const pet = catalog.find((p) => p.published && p.id === modelId);
    return pet ? { ...canvas, ...pet } : canvas;
}
/** Fit every model in the same square stage without stretching wide or tall sprites. */
export function petAvatarSize(pet: Pick<CanvasAppearance, "avatarType" | "sprite">, size: number) {
    const ratio = pet.avatarType === "sprite" && pet.sprite ? pet.sprite.frameWidth / pet.sprite.frameHeight : pet.avatarType === "live2d" ? 0.75 : 1;
    return { width: Math.min(size, size * ratio), height: Math.min(size, size / ratio) };
}
export function petMenuPosition(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }) {
    const width = Math.min(288, viewport.width - 24),
        height = Math.min(352, viewport.height - 24);
    const right = rect.left + rect.width / 2 > viewport.width / 2;
    const bottom = rect.top + rect.height / 2 > viewport.height / 2;
    return {
        left: Math.max(12, Math.min(viewport.width - width - 12, right ? rect.left - width + 36 : rect.left + rect.width - 36)),
        top: Math.max(12, Math.min(viewport.height - height - 12, bottom ? rect.top - height + Math.min(rect.height * 0.45, 72) : rect.top + rect.height - Math.min(rect.height * 0.45, 72))),
        width,
        height,
        right,
        bottom,
    };
}
export function sanitizePetPreference(value: Partial<PetPreference>): PetPreference {
    return {
        modelId: typeof value.modelId === "string" && value.modelId.length <= 64 ? value.modelId : "system",
        scale: Math.max(50, Math.min(150, Math.round((Number(value.scale) || 100) / 5) * 5)),
        locked: !!value.locked,
        hidden: !!value.hidden,
        revision: Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 ? Number(value.revision) : 0,
    };
}
