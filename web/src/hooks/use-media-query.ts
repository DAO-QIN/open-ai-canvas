import { useCallback, useSyncExternalStore } from "react";

/** 手机布局断点：与 CSS 里的 @media (max-width: 720px) 保持一致。 */
export const PHONE_LAYOUT_QUERY = "(max-width: 720px)";

export function useMediaQuery(query: string) {
    const subscribe = useCallback((notify: () => void) => {
        const media = window.matchMedia(query);
        media.addEventListener("change", notify);
        return () => media.removeEventListener("change", notify);
    }, [query]);
    return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
