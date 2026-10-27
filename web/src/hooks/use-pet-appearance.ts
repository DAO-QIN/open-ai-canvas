import { assistantAppearance, DEFAULT_CANVAS_APPEARANCE } from "@/lib/canvas/agent-appearance";
import { useAppearanceStore } from "@/stores/use-appearance-store";

/** All assistant surfaces follow the same site setting, without a personal pet request. */
export function usePetAppearance() {
    const settings = useAppearanceStore((s) => s.appearance);
    const resolved = useAppearanceStore((s) => s.resolved);
    return { appearance: assistantAppearance(settings.canvas || DEFAULT_CANVAS_APPEARANCE), resolved };
}
