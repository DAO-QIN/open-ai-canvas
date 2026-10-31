import { startTransition, useEffect, useState } from "react";

/**
 * 首屏之外的大块内容晚一步挂载：enabled 之后等浏览器空闲（最多等 timeout 毫秒）再返回 true，
 * 并放进过渡里分片渲染，不和切页后的第一帧抢主线程。就绪后保持为 true。
 * 没有 requestIdleCallback 的浏览器（Safari）退回短定时器。
 */
export function useIdleReady(enabled: boolean, timeout = 1200) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!enabled || ready) return;
        const reveal = () => startTransition(() => setReady(true));
        if (typeof window.requestIdleCallback === "function") {
            const id = window.requestIdleCallback(reveal, { timeout });
            return () => window.cancelIdleCallback(id);
        }
        const timer = window.setTimeout(reveal, 200);
        return () => window.clearTimeout(timer);
    }, [enabled, ready, timeout]);

    return ready;
}
