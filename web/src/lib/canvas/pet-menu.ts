import type { CanvasAppearance } from "./agent-appearance";
import type { PetAppearance, PetPreference } from "@/services/api/appearance";

export const DEFAULT_PET_PREFERENCE: PetPreference = { modelId: "system", scale: 100, locked: false, hidden: false, revision: 0 };
export function effectivePet(canvas: CanvasAppearance, catalog: PetAppearance[], modelId: string): CanvasAppearance {
    const pet = catalog.find((p) => p.published && p.id === modelId);
    return pet ? { ...canvas, ...pet } : canvas;
}
export function petMenuPosition(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }) {
    const width = Math.min(380, viewport.width - 24),
        height = Math.min(420, viewport.height - 24);
    const right = rect.left + rect.width / 2 > viewport.width / 2;
    const bottom = rect.top + rect.height / 2 > viewport.height / 2;
    return {
        left: Math.max(12, Math.min(viewport.width - width - 12, right ? rect.left - width + 100 : rect.left + rect.width - 100)),
        top: Math.max(12, Math.min(viewport.height - height - 12, bottom ? rect.top - height + 100 : rect.top + rect.height - 100)),
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
