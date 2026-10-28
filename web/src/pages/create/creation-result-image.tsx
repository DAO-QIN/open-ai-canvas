import { useEffect, useState } from "react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";

/** Preview failures only reload the existing asset, never resubmit generation. */
export function CreationResultImage({ url, alt, square = false, ratio = "1", previewLabel, onPreview, onReload }: {
    url: string;
    alt: string;
    square?: boolean;
    ratio?: string;
    previewLabel?: string;
    onPreview?: (url: string) => void;
    onReload?: () => Promise<string>;
}) {
    const [source, setSource] = useState(url);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        setSource(url);
        setStatus("loading");
    }, [url]);
    useEffect(() => {
        if (status !== "loading") return;
        const timer = setTimeout(() => setStatus("error"), 25_000);
        return () => clearTimeout(timer);
    }, [source, attempt, status]);
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
    const image = source ? <img key={`${source}:${attempt}`} src={source} alt={alt} decoding="async" onLoad={() => setStatus("ready")} onError={() => setStatus("error")} /> : null;
    return (
        <span className={`creation-result-image${square ? " is-square" : ""} is-${status}`} style={{ aspectRatio: square ? "1" : status === "ready" ? undefined : ratio }}>
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
