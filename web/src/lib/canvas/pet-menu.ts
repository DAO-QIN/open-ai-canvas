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
    const width = Math.min(416, viewport.width - 24),
        height = Math.min(352, viewport.height - 24);
    const right = rect.left + rect.width / 2 > viewport.width / 2;
    const bottom = rect.top + rect.height / 2 > viewport.height / 2;
    return {
        left: Math.max(12, Math.min(viewport.width - width - 12, rect.left + rect.width / 2 - width / 2)),
        top: Math.max(12, Math.min(viewport.height - height - 12, rect.top + rect.height / 2 - 208)),
        width,
        height,
        right,
        bottom,
    };
}
export function petRingSector(index: number, thumbnail = false) {
    const center = 208, inner = thumbnail ? 148 : 72, outer = thumbnail ? 204 : 140;
    const middle = thumbnail ? -150 + index * 24 : -144 + index * 36;
    const start = middle - (thumbnail ? 10 : 16), end = middle + (thumbnail ? 10 : 16);
    const point = (radius: number, angle: number) => ({ x: center + radius * Math.cos(angle * Math.PI / 180), y: center + radius * Math.sin(angle * Math.PI / 180) });
    const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start);
    const left = Math.min(a.x,b.x,c.x,d.x), top = Math.min(a.y,b.y,c.y,d.y);
    const width = Math.max(a.x,b.x,c.x,d.x)-left, height = Math.max(a.y,b.y,c.y,d.y)-top;
    const p = (value: {x:number;y:number}) => `${(value.x-left).toFixed(3)} ${(value.y-top).toFixed(3)}`;
    const path = `M ${p(a)} A ${outer} ${outer} 0 0 1 ${p(b)} L ${p(c)} A ${inner} ${inner} 0 0 0 ${p(d)} Z`;
    const label = point(thumbnail ? 176 : 106, middle);
    return { left, top, width, height, path, label: {x:label.x-left,y:label.y-top} };
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
