import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** 点阵涟漪的统一周期；圆环类加载动画（CSS）使用同一节奏。 */
export const RIPPLE_CYCLE_MS = 2600;

type DotRippleFieldProps = {
    className?: string;
    /** 固定点距（px）；不传时按视口短边自适应。 */
    spacing?: number;
    /** 点阵起点偏移（px）；不传时以涟漪中心对齐，传入时与 CSS 背景网格对齐。 */
    gridOffset?: number;
    /** 波纹未经过时的点透明度；为 0 时只画波纹，底层网格由页面自己绘制。 */
    baseAlpha?: number;
    /** 波纹把点向外推开的幅度（相对点距）。 */
    push?: number;
    /** 涟漪中心元素（父元素内的选择器）；不传时为画布中心。 */
    originSelector?: string;
    /** 父元素内需要压低点阵的区域，避免和文字抢对比。 */
    quietSelector?: string;
};

type Layout = {
    width: number;
    height: number;
    originX: number;
    originY: number;
    originHalf: number;
    quiet: { left: number; top: number; right: number; bottom: number } | null;
};

/**
 * 全屏点阵涟漪：每个周期从中心发出一圈波，经过的点变亮、外推再回落。
 * 同时把当前脉冲强度写到父元素的 --ripple-pulse，供中心标记做缩放和发光。
 * 页面隐藏时 requestAnimationFrame 自动暂停；减少动态效果时只画一帧静态点阵。
 */
export function DotRippleField({ className, spacing, gridOffset, baseAlpha = 0.13, push = 0.3, originSelector, quietSelector }: DotRippleFieldProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        const host = canvas?.parentElement;
        if (!canvas || !context || !host) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const startedAt = performance.now();
        let layout: Layout | null = null;
        let color = "";
        let colorReadAt = -Infinity;
        let frame = 0;

        const measure = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, Math.round(rect.width * dpr));
            canvas.height = Math.max(1, Math.round(rect.height * dpr));
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            const origin = originSelector ? host.querySelector<HTMLElement>(originSelector)?.getBoundingClientRect() : undefined;
            const quiet = quietSelector ? host.querySelector<HTMLElement>(quietSelector)?.getBoundingClientRect() : undefined;
            layout = {
                width: rect.width,
                height: rect.height,
                originX: origin ? origin.left + origin.width / 2 - rect.left : rect.width / 2,
                originY: origin ? origin.top + origin.height / 2 - rect.top : rect.height / 2,
                originHalf: origin ? Math.max(origin.width, origin.height) / 2 : 0,
                quiet: quiet ? { left: quiet.left - rect.left - 24, right: quiet.right - rect.left + 24, top: quiet.top - rect.top - 12, bottom: quiet.bottom - rect.top + 12 } : null,
            };
        };

        const render = (now: number) => {
            if (!layout) return;
            if (now - colorReadAt > 500) {
                // fillStyle 直接接受计算后的颜色，主题切换时最多延迟半秒跟随。
                color = getComputedStyle(canvas).color;
                colorReadAt = now;
            }
            const elapsed = reduceMotion ? null : now - startedAt;
            drawField(context, layout, color, elapsed, { spacing, gridOffset, baseAlpha, push });
            if (elapsed !== null) {
                const phase = (elapsed % RIPPLE_CYCLE_MS) / RIPPLE_CYCLE_MS;
                host.style.setProperty("--ripple-pulse", Math.exp(-phase * 9).toFixed(3));
            }
        };

        const observer = new ResizeObserver(() => {
            measure();
            render(performance.now());
        });
        observer.observe(canvas);
        measure();
        render(performance.now());

        if (!reduceMotion) {
            const loop = (now: number) => {
                render(now);
                frame = window.requestAnimationFrame(loop);
            };
            frame = window.requestAnimationFrame(loop);
        }
        return () => {
            observer.disconnect();
            window.cancelAnimationFrame(frame);
            host.style.removeProperty("--ripple-pulse");
        };
    }, [spacing, gridOffset, baseAlpha, push, originSelector, quietSelector]);

    return <canvas ref={canvasRef} className={cn("dot-ripple-field", className)} aria-hidden="true" />;
}

function drawField(context: CanvasRenderingContext2D, layout: Layout, color: string, elapsed: number | null, options: { spacing?: number; gridOffset?: number; baseAlpha: number; push: number }) {
    const { width, height, originX, originY, originHalf, quiet } = layout;
    context.clearRect(0, 0, width, height);
    if (!width || !height || !color) return;
    context.fillStyle = color;
    const step = options.spacing ?? Math.max(14, Math.min(width, height) * 0.042);
    const maxDistance = Math.hypot(Math.max(originX, width - originX), Math.max(originY, height - originY));
    const waveWidth = step * 1.5;
    const speed = maxDistance / 2.7;
    const radii: number[] = [];
    if (elapsed !== null) {
        const current = Math.floor(elapsed / RIPPLE_CYCLE_MS);
        for (let wave = Math.max(0, current - 2); wave <= current; wave++) radii.push(((elapsed - wave * RIPPLE_CYCLE_MS) / 1000) * speed);
    }
    if (!options.baseAlpha && !radii.length) return;
    const startX = options.gridOffset ?? originX - Math.ceil(originX / step) * step;
    const startY = options.gridOffset ?? originY - Math.ceil(originY / step) * step;
    const baseRadius = options.spacing ? 1.2 : step * 0.065;
    for (let y = startY; y < height + step; y += step) {
        for (let x = startX; x < width + step; x += step) {
            const dx = x - originX;
            const dy = y - originY;
            const distance = Math.hypot(dx, dy) || 1;
            const centerFade = originHalf ? smoothstep(originHalf * 1.1, originHalf * 2.2, distance) : 1;
            if (centerFade <= 0) continue;
            let energy = 0;
            for (const radius of radii) {
                const offset = (distance - radius) / waveWidth;
                if (offset > -3 && offset < 3) energy += Math.exp(-offset * offset) * Math.max(0, 1 - radius / maxDistance);
            }
            const vignette = Math.pow(Math.max(0, 1 - distance / maxDistance), 0.7);
            const quietFade = quiet ? 1 - 0.75 * (1 - smoothstep(0, step * 1.2, distanceOutside(x, y, quiet))) : 1;
            const alpha = (options.baseAlpha + energy * 0.75) * vignette * centerFade * quietFade;
            if (alpha < 0.01) continue;
            const shift = energy * step * options.push;
            context.globalAlpha = Math.min(1, alpha);
            context.beginPath();
            context.arc(originX + (dx / distance) * (distance + shift), originY + (dy / distance) * (distance + shift), baseRadius + energy * step * 0.085, 0, Math.PI * 2);
            context.fill();
        }
    }
    context.globalAlpha = 1;
}

function distanceOutside(x: number, y: number, rect: { left: number; top: number; right: number; bottom: number }) {
    return Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
}

function smoothstep(edge0: number, edge1: number, value: number) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
