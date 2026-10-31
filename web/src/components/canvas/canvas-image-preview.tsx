import { useEffect, useState, type ReactNode } from "react";
import { Image as ImageIcon, LoaderCircle } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { resolveImageUrl } from "@/services/image-storage";
import { peekCachedResourceObjectUrl } from "@/services/resource-blob-cache";

type CanvasImagePreviewProps = {
    src?: string;
    storageKey?: string;
    /** 原图加载出来之前先显示的已加载图片（例如对话里的展示图）：打开预览不用空等，原图加载失败时也继续显示它。 */
    placeholderSrc?: string;
    alt?: string;
    onClose: () => void;
    /** 图片下方的操作区（例如创作页的图片工具条）；不传则只看图。 */
    footer?: ReactNode;
};

export function CanvasImagePreview({ src = "", storageKey, placeholderSrc = "", alt = "图片", onClose, footer }: CanvasImagePreviewProps) {
    const [resolvedSrc, setResolvedSrc] = useState(() => (storageKey ? peekCachedResourceObjectUrl(storageKey) : src));
    const [loading, setLoading] = useState(Boolean(src || storageKey));
    const [error, setError] = useState(false);
    const placeholderShown = Boolean(placeholderSrc) && (loading || error);

    useEffect(() => {
        let cancelled = false;
        // 本会话刚上传的图片直接用内存中的原图 Blob，打开预览不再等待服务器回传。
        const localSrc = storageKey ? peekCachedResourceObjectUrl(storageKey) : "";
        setResolvedSrc(storageKey ? localSrc : src);
        setLoading(Boolean(src || storageKey));
        setError(false);
        if (localSrc || (!src && !storageKey)) return () => {
            cancelled = true;
        };
        void resolveImageUrl(storageKey, src)
            .then((url) => {
                if (cancelled) return;
                if (!url) {
                    setLoading(false);
                    setError(true);
                    return;
                }
                setResolvedSrc(url);
            })
            .catch(() => {
                if (!cancelled) {
                    setLoading(false);
                    setError(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [src, storageKey]);

    if (!src && !storageKey) return null;

    return (
        <AppModal
            open
            flush
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] border"
                        style={{
                            borderColor: "var(--workspace-border)",
                            background: "color-mix(in srgb, var(--workspace-surface-strong) 72%, var(--workspace-surface))",
                            color: "var(--workspace-text-muted)",
                        }}
                    >
                        <ImageIcon className="size-4" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" title={alt}>{alt}</span>
                </div>
            }
            footer={null}
            centered
            width="min(1160px, calc(100vw - 32px))"
            onCancel={onClose}
            className="canvas-image-preview-modal"
        >
            <div
                className="canvas-image-preview-surface flex min-h-[min(72vh,680px)] items-center justify-center p-4 sm:p-6"
                style={{
                    background: "var(--workspace-surface)",
                }}
            >
                <div
                    className="canvas-image-preview-stage relative flex min-h-[min(62vh,560px)] w-full items-center justify-center overflow-hidden p-3 sm:p-5"
                    style={{
                        background: "var(--workspace-surface)",
                    }}
                >
                    {loading && !error && !placeholderSrc ? (
                        <div
                            className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                            style={{
                                borderColor: "var(--workspace-border)",
                                background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                            }}
                            role="status"
                            aria-label="图片加载中"
                        >
                            <div className="flex flex-col items-center gap-3" style={{ color: "var(--workspace-text-muted)" }}>
                                <span className="grid size-11 place-items-center rounded-full border bg-[var(--workspace-surface-strong)]" style={{ borderColor: "var(--workspace-border)" }}>
                                    <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                                </span>
                                <span className="text-xs font-medium">正在加载高清图片</span>
                            </div>
                        </div>
                    ) : null}
                    {error && !placeholderSrc ? (
                        <div
                            className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                            style={{
                                borderColor: "var(--workspace-border-strong)",
                                background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                                color: "var(--workspace-text-muted)",
                            }}
                            role="alert"
                        >
                            <div className="flex flex-col items-center gap-3 text-center">
                                <ImageIcon className="size-8 opacity-45" />
                                <div>
                                    <div className="text-sm font-medium">图片暂时无法显示</div>
                                    <div className="mt-1 text-xs opacity-70">请关闭预览后重试</div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {placeholderSrc ? (
                        // 占位图和原图叠在同一格里：原图加载完成那一帧直接换上，不淡入，避免中间露出底色。
                        <div className="grid w-full place-items-center">
                            {placeholderShown ? <img src={placeholderSrc} alt={alt} draggable={false} className="col-start-1 row-start-1 max-h-[min(66vh,620px)] max-w-full rounded-[var(--r-sm)] object-contain" /> : null}
                            {resolvedSrc && !error ? (
                                <img
                                    src={resolvedSrc}
                                    alt={alt}
                                    draggable={false}
                                    className={`col-start-1 row-start-1 max-h-[min(66vh,620px)] max-w-full rounded-[var(--r-sm)] object-contain ${loading ? "invisible" : ""}`}
                                    onLoad={() => {
                                        setLoading(false);
                                        setError(false);
                                    }}
                                    onError={() => {
                                        setLoading(false);
                                        setError(true);
                                    }}
                                />
                            ) : null}
                        </div>
                    ) : resolvedSrc ? (
                        <img
                            src={resolvedSrc}
                            alt={alt}
                            draggable={false}
                            className={`max-h-[min(66vh,620px)] max-w-full rounded-[var(--r-sm)] object-contain transition-opacity duration-200 motion-reduce:transition-none ${loading || error ? "opacity-0" : "opacity-100"}`}
                            onLoad={() => {
                                setLoading(false);
                                setError(false);
                            }}
                            onError={() => {
                                setLoading(false);
                                setError(true);
                            }}
                        />
                    ) : null}
                </div>
            </div>
            {footer ? <div className="canvas-image-preview-footer flex justify-center px-4 pb-4 sm:px-6 sm:pb-5" style={{ background: "var(--workspace-surface)" }}>{footer}</div> : null}
        </AppModal>
    );
}
