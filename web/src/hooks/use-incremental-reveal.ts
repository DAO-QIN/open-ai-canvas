import { startTransition, useCallback, useEffect, useRef, useState } from "react";

/**
 * 下滑加载：列表数据已在本地，只是分批渲染。哨兵元素进入视口（含滚动容器裁剪）前 600px 时再多显示一批。
 * resetKey 变化（切换筛选、搜索）时回到第一批。没有 IntersectionObserver 的环境直接全部显示。
 */
export function useIncrementalReveal(total: number, step: number, resetKey: unknown) {
    const [count, setCount] = useState(step);
    const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
    const totalRef = useRef(total);
    totalRef.current = total;

    useEffect(() => {
        setCount(step);
    }, [resetKey, step]);

    useEffect(() => {
        if (!sentinel || count >= total) return;
        if (typeof IntersectionObserver === "undefined") {
            setCount(total);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                // 下一批在滚动中途渲染：放进过渡分片，滚动和点击不被一整批卡片卡住。
                if (entries.some((entry) => entry.isIntersecting)) startTransition(() => setCount((current) => Math.min(totalRef.current, current + step)));
            },
            { rootMargin: "0px 0px 600px 0px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [count, sentinel, step, total]);

    const sentinelRef = useCallback((node: HTMLElement | null) => setSentinel(node), []);
    return { count: Math.min(count, total), hasMore: count < total, sentinelRef };
}
