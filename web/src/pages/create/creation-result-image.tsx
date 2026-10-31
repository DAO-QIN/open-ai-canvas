import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";

/** Preview failures only reload the existing asset, never resubmit generation. */
export function CreationResultImage({ url, alt, square = false, ratio = "1", previewLabel, onPreview, onReload, onNaturalSize }: {
    url: string;
    alt: string;
    square?: boolean;
    ratio?: string;
    previewLabel?: string;
    onPreview?: (url: string) => void;
    onReload?: () => Promise<string>;
    /** 图片加载完成后报告实际像素（naturalWidth × naturalHeight）。 */
    onNaturalSize?: (width: number, height: number) => void;
}) {
    const [source, setSource] = useState(url);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);
    const frameRef = useRef<HTMLSpanElement>(null);
    // 图片懒加载：离视口远的图浏览器还没开始下载，进入视口前不计超时，免得翻回旧消息时误报「图片暂时无法显示」。
    const [inView, setInView] = useState(false);
    useEffect(() => {
        setSource(url);
        setStatus("loading");
    }, [url]);
    useEffect(() => {
        if (inView) return;
        const frame = frameRef.current;
        if (!frame || typeof IntersectionObserver === "undefined") {
            setInView(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setInView(true);
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, [inView]);
    useEffect(() => {
        if (status !== "loading" || !inView) return;
        const timer = setTimeout(() => setStatus("error"), 25_000);
        return () => clearTimeout(timer);
    }, [source, attempt, status, inView]);
    const reload = async () => {
        setStatus("loading");
        try {
            const next = onReload ? await onReload() : source;
            if (!next) throw new Error("Image unavailable");
            setSource(next);
            setAttempt((value) => value + 1);
        } catch {
            setStatus("error");
        }
    };
    const image = source ? (
        <img
            key={`${source}:${attempt}`}
            src={source}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={(event) => {
                setStatus("ready");
                onNaturalSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            }}
            onError={() => setStatus("error")}
        />
    ) : null;
    const [ratioWidth, ratioHeight = "1"] = ratio.split("/");
    const aspectRatio = Number(ratioWidth) / Number(ratioHeight);
    return (
        <span ref={frameRef} className={`creation-result-image${square ? " is-square" : ""} is-${status}`} data-media-state={status === "ready" ? "loaded" : status} aria-busy={status === "loading"} style={{ aspectRatio: square ? "1" : status === "ready" ? undefined : Number.isFinite(aspectRatio) && aspectRatio > 0 ? String(aspectRatio) : "1" }}>
            {onPreview ? (
                <button type="button" className="creation-result-image-open" disabled={status !== "ready"} aria-label={previewLabel || (alt === "生成结果 1" ? "预览生成图片" : `预览${alt}`)} onClick={() => onPreview(source)}>{image}</button>
            ) : image}
            {status !== "ready" ? (
                <span className="creation-result-image-state" role="status" aria-live="polite">
                    <ImageIcon aria-hidden="true" />
                    <span>{status === "error" ? "图片暂时无法显示" : "图片加载中…"}</span>
                    {status === "error" && onReload ? <button type="button" onClick={() => void reload()}><RefreshCw aria-hidden="true" />重新加载</button> : null}
                </span>
            ) : null}
        </span>
    );
}
