import { useEffect, useRef, useState } from "react";

import type { CreationInspiration } from "@/lib/inspirations/catalog";

import { InspirationCover } from "./inspiration-detail-modal";
import "./inspiration-card-media.css";

/**
 * 封面 + 视频样片：鼠标悬停（或键盘聚焦）卡片时才加载并静音循环播放，离开即暂停回到封面。
 * 触屏没有悬停，不自动播放，避免耗流量；系统要求减少动态时也不播放。
 */
export function InspirationCardMedia({ item, hoverTarget = ".home-card-button" }: { item: CreationInspiration; hoverTarget?: string }) {
    const [active, setActive] = useState(false);
    const [playing, setPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const holderRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const card = holderRef.current?.closest(hoverTarget);
        if (!card || !item.video) return;
        const canHover = typeof window.matchMedia !== "function" || (window.matchMedia("(hover: hover)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        if (!canHover) return;
        const start = () => setActive(true);
        const stop = () => {
            setActive(false);
            setPlaying(false);
            videoRef.current?.pause();
        };
        card.addEventListener("pointerenter", start);
        card.addEventListener("pointerleave", stop);
        card.addEventListener("focus", start);
        card.addEventListener("blur", stop);
        return () => {
            card.removeEventListener("pointerenter", start);
            card.removeEventListener("pointerleave", stop);
            card.removeEventListener("focus", start);
            card.removeEventListener("blur", stop);
        };
    }, [hoverTarget, item.video]);

    useEffect(() => {
        const video = videoRef.current;
        if (!active || !video) return;
        video.currentTime = 0;
        void video.play().catch(() => setPlaying(false));
    }, [active]);

    return (
        <span ref={holderRef} className="inspiration-card-media">
            <InspirationCover image={item.image} />
            {item.video && active ? (
                <video
                    ref={videoRef}
                    className={playing ? "is-playing" : undefined}
                    src={item.video}
                    poster={item.image}
                    muted
                    loop
                    playsInline
                    preload="auto"
                    aria-hidden="true"
                    onPlaying={() => setPlaying(true)}
                    onError={() => setPlaying(false)}
                />
            ) : null}
        </span>
    );
}
