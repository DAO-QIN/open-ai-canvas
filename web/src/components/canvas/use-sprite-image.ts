import { useEffect, useState } from "react";

type CachedImage = { promise: Promise<string>; objectURL?: string; refs: number; release?: ReturnType<typeof setTimeout>; controller: AbortController };
const images = new Map<string, CachedImage>();

function acquire(url: string) {
    let cached = images.get(url);
    if (!cached) {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 30000);
        const entry: CachedImage = { refs: 0, controller, promise: Promise.resolve("") };
        entry.promise = fetch(url, { credentials: "include", signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("精灵图集读取失败，请检查资源和登录状态");
                const blob = await response.blob();
                if (blob.size > 16 * 1024 * 1024 || !["image/png", "image/webp"].includes(blob.type)) throw new Error("精灵图集格式或大小无效");
                entry.objectURL = URL.createObjectURL(blob);
                return entry.objectURL;
            })
            .catch((error) => {
                if (images.get(url) === entry) images.delete(url);
                if (controller.signal.aborted) throw new Error("精灵图集加载超时，请重试");
                throw error;
            })
            .finally(() => clearTimeout(deadline));
        images.set(url, entry);
        cached = entry;
    }
    clearTimeout(cached.release);
    cached.refs++;
    return cached;
}

export function useSpriteImage(url: string) {
    const [result, setResult] = useState({ url: "", src: "", error: "" });
    useEffect(() => {
        let disposed = false;
        const image = acquire(url);
        image.promise.then(
            (src) => {
                if (!disposed) setResult({ url, src, error: "" });
            },
            (cause) => {
                if (!disposed) setResult({ url, src: "", error: cause instanceof Error ? cause.message : "精灵图集读取失败" });
            },
        );
        return () => {
            disposed = true;
            if (--image.refs === 0)
                image.release = setTimeout(() => {
                    if (image.refs) return;
                    image.controller.abort();
                    if (image.objectURL) URL.revokeObjectURL(image.objectURL);
                    if (images.get(url) === image) images.delete(url);
                }, 30000);
        };
    }, [url]);
    return result.url === url ? result : { url, src: "", error: "" };
}
