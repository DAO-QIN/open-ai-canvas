import { getPublicAppearance, type PublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, useAppearanceStore } from "@/stores/use-appearance-store";

const APPEARANCE_BOOTSTRAP_TIMEOUT_MS = 4_000;
let refreshing: Promise<PublicAppearance | undefined> | undefined;
let bootstrapping: Promise<PublicAppearance> | undefined;

// A failed refresh must keep the last saved identity rather than restore defaults.
export function refreshPublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const previous = useAppearanceStore.getState().appearance;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
        try {
            const appearance = await fetchAppearance(controller.signal);
            if (useAppearanceStore.getState().appearance !== previous) return undefined;
            return commitPublicAppearance(appearance);
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    })().finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export async function resolvePublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
    try {
        return await fetchAppearance(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

export function bootstrapAppearance(fetchAppearance?: (signal: AbortSignal) => Promise<PublicAppearance>) {
    if (bootstrapping) return bootstrapping;
    const previous = useAppearanceStore.getState().appearance;
    useAppearanceStore.setState({ loadFailed: false });
    bootstrapping = resolvePublicAppearance(fetchAppearance)
        .then((appearance) => {
            const current = useAppearanceStore.getState();
            if (current.appearance !== previous && current.resolved) return current.appearance;
            return commitPublicAppearance(appearance);
        })
        .catch((error: unknown) => {
            const current = useAppearanceStore.getState();
            if (current.resolved) return current.appearance;
            useAppearanceStore.setState({ loadFailed: true });
            throw error;
        })
        .finally(() => {
            bootstrapping = undefined;
        });
    return bootstrapping;
}
