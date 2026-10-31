// 创作页背景层，都挂进工作区舞台插槽、铺过透明顶栏，都是纯装饰。空态首屏：缓慢漂移的方格画在 canvas 上，底色和顶部柔光仍是 CSS（creation-backdrops.css）。
// 对话中取最新一组结果的颜色。

import { useEffect, useRef } from "react";

import { WorkspaceStageBackdrop } from "@/components/layout/workspace-stage-backdrop";
import { currentUiScale } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { usableResultUrl } from "./creation-result-urls";
import type { CreationMessage } from "./creation-types";
import "./creation-backdrops.css";

/**
 * 对话里最新一张已完成的结果图，用作背景色。资源图走 `variant=thumbnail`（缩略图未就绪时后端回退原图），
 * 不额外请求签名地址；没有可用结果时返回空串。
 */
export function latestCreationResultImage(messages: readonly CreationMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "assistant" || message.mode === "video" || message.mode === "audio" || message.status === "error" || message.status === "cancelled") continue;
        const keys = message.resultStorageKeys || [];
        for (const key of keys) {
            const id = resourceIdFromStorageKey(key);
            if (id) return `${resourceFileUrl(id)}?variant=thumbnail`;
        }
        for (const url of message.resultUrls || []) {
            const usable = usableResultUrl(url);
            if (usable) return usable;
        }
    }
    return "";
}

/**
 * 对话中背景：结果图放大、重度模糊、低透明度，往下渐隐；换一组结果时淡入新的颜色。
 * 和空态方格一样挂进舞台插槽，从舞台顶端铺起：顶栏和下面的对话是同一块颜色，顶栏不会只剩一道没上色的黑条。
 */
export function CreationAmbientBackdrop({ url }: { url: string }) {
    if (!url) return null;
    return (
        <WorkspaceStageBackdrop>
            <div className="creation-ambient" aria-hidden="true">
                <img key={url} src={url} alt="" decoding="async" />
            </div>
        </WorkspaceStageBackdrop>
    );
}

/**
 * 空态首屏背景（参考 kunrouai.com）：方格向左上缓慢漂移，指针所在的格子亮起，移开后约 0.3 秒淡出。
 * `paused`（首屏已滚出视口）时淡出并停帧；页面隐藏时停帧；「减少动态效果」下方格不动、格子直接亮灭；触屏不跟随指针。
 */
export function CreationGridBackdrop({ paused = false }: { paused?: boolean }) {
    return (
        <WorkspaceStageBackdrop>
            <CreationGridCanvas paused={paused} />
        </WorkspaceStageBackdrop>
    );
}

function CreationGridCanvas({ paused }: { paused: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gridRef = useRef<CreationGrid | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const grid = startCreationGrid(canvas, context);
        gridRef.current = grid;
        return () => {
            gridRef.current = null;
            grid.stop();
        };
    }, []);

    useEffect(() => {
        gridRef.current?.setPaused(paused);
    }, [paused]);

    return <canvas ref={canvasRef} className={cn("creation-grid", paused && "is-paused")} aria-hidden="true" />;
}

type CreationGrid = { setPaused: (paused: boolean) => void; stop: () => void };

/** 漂移速度（样式像素 / 秒）。格子边长、线和悬停格的颜色与透明度都由 CSS 给。 */
const GRID_DRIFT_PER_SECOND = 26;
/** 悬停格亮起 / 淡出的指数速率：约 0.3 秒走完。 */
const GRID_HOVER_RATE = 10;
/**
 * 帧间隔（ms）：只有漂移时每秒约 30 帧（线条按设备像素对齐，一帧最多走 1 个像素，和 60 帧看不出差别）；
 * 指针在动或格子在亮灭时约 60 帧。两帧之间用定时器睡到间隔快满再等下一次刷新，高刷屏也不会每个刷新周期都唤醒主线程。
 */
const GRID_IDLE_FRAME_MS = 1000 / 30;
const GRID_ACTIVE_FRAME_MS = 1000 / 60;
const GRID_FRAME_SLACK_MS = 4;
const GRID_POINTER_ACTIVE_MS = 500;
/**
 * 四周淡出：椭圆中心在宽 50%、高 34%（标题和输入框之间），半径为宽 72%、高 78%，透明度按这几档从中心降到 0。
 * 画在画布里（每帧最后用 destination-in 乘一次），不用 CSS 遮罩：遮罩会让画布每帧多一次主线程绘制，开销翻倍。
 */
const GRID_VIGNETTE = {
    x: 0.5,
    y: 0.34,
    rx: 0.72,
    ry: 0.78,
    stops: [
        [0, 1],
        [0.3, 0.82],
        [0.6, 0.45],
        [0.84, 0.14],
        [1, 0],
    ],
} as const;

function startCreationGrid(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): CreationGrid {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cells = new Map<string, { col: number; row: number; alpha: number }>();
    const vignette = document.createElement("canvas");
    const vignetteContext = vignette.getContext("2d");
    // 在屏幕像素里画（getBoundingClientRect 已含桌面端 90% 缩放），样式里的尺寸乘上缩放再用。
    let left = 0;
    let top = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let cell = 44;
    let speed = GRID_DRIFT_PER_SECOND;
    let offset = 0;
    let line = "";
    let hover = "";
    let lineAlpha = 0;
    let hoverAlpha = 0;
    let pointer: { x: number; y: number } | null = null;
    let pointerMovedAt = -Infinity;
    let cellsSettled = true;
    let paused = false;
    let looping = false;
    let frame = 0;
    let timer = 0;
    let stillFrame = 0;
    let lastTime = 0;

    const readStyle = () => {
        const style = getComputedStyle(canvas);
        const number = (name: string, fallback: number) => {
            const value = Number.parseFloat(style.getPropertyValue(name));
            return Number.isFinite(value) ? value : fallback;
        };
        const scale = currentUiScale();
        cell = Math.max(16, number("--creation-grid-cell", 44)) * scale;
        speed = GRID_DRIFT_PER_SECOND * scale;
        line = style.color;
        hover = style.getPropertyValue("--creation-grid-hover").trim() || line;
        lineAlpha = number("--creation-grid-line-alpha", 0.1);
        hoverAlpha = number("--creation-grid-hover-alpha", 0.07);
    };

    // 淡出用的透明度图只有画布的 1/4 大小，放大时插值，渐变依然平滑。
    const buildVignette = () => {
        if (!vignetteContext) return;
        const w = Math.max(2, Math.ceil(width / 4));
        const h = Math.max(2, Math.ceil(height / 4));
        vignette.width = w;
        vignette.height = h;
        const cx = w * GRID_VIGNETTE.x;
        const cy = h * GRID_VIGNETTE.y;
        const rx = w * GRID_VIGNETTE.rx;
        const squash = (h * GRID_VIGNETTE.ry) / rx;
        // 圆形渐变沿 y 方向缩放成椭圆，再铺满整张图。
        vignetteContext.setTransform(1, 0, 0, squash, 0, cy * (1 - squash));
        const gradient = vignetteContext.createRadialGradient(cx, cy, 0, cx, cy, rx);
        for (const [at, alpha] of GRID_VIGNETTE.stops) gradient.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
        vignetteContext.fillStyle = gradient;
        vignetteContext.fillRect(0, (-cy * (1 - squash)) / squash, w, h / squash);
    };

    const measure = () => {
        const rect = canvas.getBoundingClientRect();
        ratio = Math.min(2, window.devicePixelRatio || 1);
        left = rect.left;
        top = rect.top;
        width = rect.width;
        height = rect.height;
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        buildVignette();
        readStyle();
    };

    const draw = (dt: number) => {
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        if (!width || !height) return;
        // 线宽取整数个设备像素，线心对齐像素格：漂移时线条不会忽明忽暗。
        const lineWidth = Math.max(1, Math.round(ratio));
        const snap = (value: number) => (Math.round(value * ratio - lineWidth / 2) + lineWidth / 2) / ratio;
        let hovered = "";
        if (pointer) {
            const col = Math.floor((pointer.x - offset) / cell);
            const row = Math.floor((pointer.y - offset) / cell);
            hovered = `${col}:${row}`;
            if (!cells.has(hovered)) cells.set(hovered, { col, row, alpha: 0 });
        }
        const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * GRID_HOVER_RATE);
        cellsSettled = true;
        context.fillStyle = hover;
        for (const [key, item] of cells) {
            const target = key === hovered ? 1 : 0;
            item.alpha += (target - item.alpha) * blend;
            if (!target && item.alpha < 0.01) {
                cells.delete(key);
                continue;
            }
            if (Math.abs(target - item.alpha) > 0.01) cellsSettled = false;
            const x = snap(item.col * cell + offset);
            const y = snap(item.row * cell + offset);
            context.globalAlpha = item.alpha * hoverAlpha;
            context.fillRect(x, y, snap((item.col + 1) * cell + offset) - x, snap((item.row + 1) * cell + offset) - y);
        }
        context.globalAlpha = lineAlpha;
        context.strokeStyle = line;
        context.lineWidth = lineWidth / ratio;
        context.beginPath();
        const start = ((offset % cell) + cell) % cell;
        for (let x = start; x <= width; x += cell) {
            const position = snap(x);
            context.moveTo(position, 0);
            context.lineTo(position, height);
        }
        for (let y = start; y <= height; y += cell) {
            const position = snap(y);
            context.moveTo(0, position);
            context.lineTo(width, position);
        }
        context.stroke();
        context.globalAlpha = 1;
        if (vignetteContext) {
            context.globalCompositeOperation = "destination-in";
            context.drawImage(vignette, 0, 0, width, height);
            context.globalCompositeOperation = "source-over";
        }
    };

    const schedule = (interval: number) => {
        if (!looping || frame) return;
        window.clearTimeout(timer);
        const delay = Math.max(0, lastTime + interval - GRID_FRAME_SLACK_MS - performance.now());
        timer = window.setTimeout(() => {
            timer = 0;
            if (looping && !frame) frame = window.requestAnimationFrame(step);
        }, delay);
    };

    const step = (now: number) => {
        frame = 0;
        if (!looping) return;
        // 切回标签页或卡顿后不一次跳一大段。
        const dt = Math.min(Math.max(0, now - lastTime) / 1000, 0.05);
        lastTime = now;
        offset -= speed * dt;
        draw(dt);
        schedule(!cellsSettled || now - pointerMovedAt < GRID_POINTER_ACTIVE_MS ? GRID_ACTIVE_FRAME_MS : GRID_IDLE_FRAME_MS);
    };

    const halt = () => {
        looping = false;
        window.cancelAnimationFrame(frame);
        window.cancelAnimationFrame(stillFrame);
        window.clearTimeout(timer);
        frame = 0;
        stillFrame = 0;
        timer = 0;
    };

    const run = () => {
        halt();
        if (paused || document.hidden) return;
        draw(0);
        if (reducedMotion.matches) return;
        looping = true;
        lastTime = performance.now();
        schedule(GRID_ACTIVE_FRAME_MS);
    };

    // 指针一动：漂移中就把下一帧提前到 60 帧的间隔，方格不动时（减少动态效果）只补画一帧。
    const react = () => {
        pointerMovedAt = performance.now();
        if (paused || document.hidden) return;
        if (looping) {
            schedule(GRID_ACTIVE_FRAME_MS);
            return;
        }
        if (stillFrame) return;
        stillFrame = window.requestAnimationFrame(() => {
            stillFrame = 0;
            draw(0);
        });
    };

    // 位置用尺寸变化时量好的值，指针移动时不强制重排；舞台挪动（收起侧栏、关掉通知条）都会改尺寸，触发重新测量。
    const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        const x = event.clientX - left;
        const y = event.clientY - top;
        pointer = x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
        react();
    };
    const clearPointer = () => {
        pointer = null;
        react();
    };
    const onPointerOut = (event: PointerEvent) => {
        if (event.pointerType !== "touch" && !event.relatedTarget) clearPointer();
    };

    // 改尺寸会清空画布，立即补画，拖动窗口时不闪白。
    const resizeObserver = new ResizeObserver(() => {
        measure();
        draw(0);
    });
    // 切换明暗主题、皮肤只改根元素的 class / style / data-skin，重新取色后补一帧。
    const themeObserver = new MutationObserver(() => {
        readStyle();
        if (!looping && !paused) draw(0);
    });

    measure();
    resizeObserver.observe(canvas);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-skin"] });
    // 画布本身不接收指针，在捕获阶段读位置，输入框等内容拦截了事件也照样跟随。
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    document.addEventListener("pointerout", onPointerOut);
    window.addEventListener("blur", clearPointer);
    document.addEventListener("visibilitychange", run);
    reducedMotion.addEventListener("change", run);
    run();

    return {
        setPaused(next) {
            if (paused === next) return;
            paused = next;
            if (paused) pointer = null;
            run();
        },
        stop() {
            halt();
            resizeObserver.disconnect();
            themeObserver.disconnect();
            window.removeEventListener("pointermove", onPointerMove, { capture: true });
            document.removeEventListener("pointerout", onPointerOut);
            window.removeEventListener("blur", clearPointer);
            document.removeEventListener("visibilitychange", run);
            reducedMotion.removeEventListener("change", run);
            // 释放画布显存。
            canvas.width = 0;
            canvas.height = 0;
            vignette.width = 0;
            vignette.height = 0;
        },
    };
}
