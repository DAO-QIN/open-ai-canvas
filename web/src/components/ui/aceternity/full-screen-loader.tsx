import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandLogo, BrandLogoFrame } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";
import { STARTUP_STEPS, useStartupProgressStore, type StartupStep } from "@/stores/use-startup-progress-store";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
    action?: ReactNode;
    /** 不传时跟随启动进度；传 null 表示该加载与启动阶段无关，只显示等待信号。 */
    step?: StartupStep | null;
};

// 扫描显影与点阵涟漪共用一个周期，每次扫描开始时从标记中心发出一圈波。
const SCAN_CYCLE_MS = 2800;

export function FullScreenLoader({ label = "正在恢复工作区", detail = "同步账号、项目和创作环境", className, action, step }: FullScreenLoaderProps) {
    const trackedStep = useStartupProgressStore((state) => state.step);
    const activeStep = step === undefined ? trackedStep : step;
    const viewport = useViewportLabel();

    return (
        <div data-full-screen-loader role="status" aria-live="polite" aria-label={`${label}，${detail}`} className={cn("full-screen-loader", className)}>
            <LoaderRippleField />
            <div className="full-screen-loader-content">
                <div className="full-screen-loader-scene" aria-hidden="true">
                    <span className="full-screen-loader-crop is-tl" />
                    <span className="full-screen-loader-crop is-tr" />
                    <span className="full-screen-loader-crop is-bl" />
                    <span className="full-screen-loader-crop is-br" />
                    {viewport ? <span className="full-screen-loader-coord">{viewport}</span> : null}
                    <span className="full-screen-loader-mark is-dither">
                        <LoaderMark />
                    </span>
                    <span className="full-screen-loader-mark is-solid">
                        <LoaderMark />
                    </span>
                    <span className="full-screen-loader-beam" />
                </div>
                <div className="full-screen-loader-copy">
                    <strong>{label}</strong>
                    <span>{detail}</span>
                </div>
                {action ? <div className="full-screen-loader-action">{action}</div> : activeStep ? <LoaderSteps active={activeStep} /> : <LoadingSignal />}
            </div>
        </div>
    );
}

function useViewportLabel() {
    const read = () => (typeof window === "undefined" ? "" : `${window.innerWidth} × ${window.innerHeight}`);
    const [label, setLabel] = useState(read);
    useEffect(() => {
        const update = () => setLabel(read());
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    return label;
}

function LoaderMark() {
    return <BrandLogo className="full-screen-loader-logo-image" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />;
}

function LoaderSteps({ active }: { active: StartupStep }) {
    const activeIndex = STARTUP_STEPS.findIndex((item) => item.id === active);
    return (
        <ol className="full-screen-loader-steps" aria-hidden="true">
            {STARTUP_STEPS.map((item, index) => (
                <li key={item.id} data-state={index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"}>
                    <i />
                    {`0${index + 1} ${item.label}`}
                </li>
            ))}
        </ol>
    );
}

type RippleLayout = {
    width: number;
    height: number;
    originX: number;
    originY: number;
    // 标记与文案区域内压低点阵，避免和文字抢对比。
    sceneHalf: number;
    quiet: { left: number; top: number; right: number; bottom: number } | null;
};

function LoaderRippleField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const startedAt = performance.now();
        let layout: RippleLayout | null = null;
        let color = "";
        let colorReadAt = -Infinity;
        let frame = 0;

        const measure = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.max(1, Math.round(rect.width * dpr));
            canvas.height = Math.max(1, Math.round(rect.height * dpr));
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            const root = canvas.parentElement;
            const scene = root?.querySelector<HTMLElement>(".full-screen-loader-scene")?.getBoundingClientRect();
            const copy = root?.querySelector<HTMLElement>(".full-screen-loader-copy")?.getBoundingClientRect();
            const footer = root?.querySelector<HTMLElement>(".full-screen-loader-steps, .loading-signal, .full-screen-loader-action")?.getBoundingClientRect();
            const quietBottom = Math.max(copy?.bottom ?? 0, footer?.bottom ?? 0);
            const quietWidth = Math.max(copy?.width ?? 0, footer?.width ?? 0);
            const quietCenter = copy ? copy.left + copy.width / 2 - rect.left : rect.width / 2;
            layout = {
                width: rect.width,
                height: rect.height,
                originX: scene ? scene.left + scene.width / 2 - rect.left : rect.width / 2,
                originY: scene ? scene.top + scene.height / 2 - rect.top : rect.height * 0.45,
                sceneHalf: scene ? scene.width / 2 : 80,
                quiet: copy
                    ? {
                          left: quietCenter - quietWidth / 2 - 24,
                          right: quietCenter + quietWidth / 2 + 24,
                          top: copy.top - 12 - rect.top,
                          bottom: quietBottom + 12 - rect.top,
                      }
                    : null,
            };
        };

        const render = (now: number) => {
            if (!layout) return;
            if (now - colorReadAt > 500) {
                // fillStyle 直接接受计算后的颜色，主题切换时最多延迟半秒跟随。
                color = getComputedStyle(canvas).color;
                colorReadAt = now;
            }
            drawRippleField(context, layout, color, reduceMotion ? null : now - startedAt);
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
        };
    }, []);

    return <canvas ref={canvasRef} className="full-screen-loader-field" aria-hidden="true" />;
}

function drawRippleField(context: CanvasRenderingContext2D, layout: RippleLayout, color: string, elapsed: number | null) {
    const { width, height, originX, originY, sceneHalf, quiet } = layout;
    context.clearRect(0, 0, width, height);
    if (!width || !height || !color) return;
    context.fillStyle = color;
    const spacing = Math.max(14, Math.min(width, height) * 0.042);
    const maxDistance = Math.hypot(Math.max(originX, width - originX), Math.max(originY, height - originY));
    const waveWidth = spacing * 1.5;
    const speed = maxDistance / 2.9;
    const radii: number[] = [];
    if (elapsed !== null) {
        const current = Math.floor(elapsed / SCAN_CYCLE_MS);
        for (let wave = current - 2; wave <= current; wave++) {
            const radius = ((elapsed - wave * SCAN_CYCLE_MS) / 1000) * speed;
            if (wave >= 0 && radius >= 0) radii.push(radius);
        }
    }
    const startX = originX - Math.ceil(originX / spacing) * spacing;
    const startY = originY - Math.ceil(originY / spacing) * spacing;
    for (let y = startY; y < height + spacing; y += spacing) {
        for (let x = startX; x < width + spacing; x += spacing) {
            const dx = x - originX;
            const dy = y - originY;
            const distance = Math.hypot(dx, dy) || 1;
            const outsideScene = Math.max(Math.abs(dx), Math.abs(dy)) - sceneHalf;
            const sceneFade = smoothstep(spacing * 0.2, spacing * 1.6, outsideScene);
            if (sceneFade <= 0) continue;
            let energy = 0;
            for (const radius of radii) {
                const offset = (distance - radius) / waveWidth;
                if (offset > -3 && offset < 3) energy += Math.exp(-offset * offset) * Math.max(0, 1 - radius / maxDistance);
            }
            const vignette = Math.pow(Math.max(0, 1 - distance / maxDistance), 0.7);
            const quietFade = quiet ? 1 - 0.75 * (1 - smoothstep(0, spacing * 1.2, distanceOutsideRect(x, y, quiet))) : 1;
            const alpha = (0.12 + energy * 0.75) * vignette * sceneFade * quietFade;
            if (alpha < 0.01) continue;
            const push = energy * spacing * 0.3;
            context.globalAlpha = Math.min(1, alpha);
            context.beginPath();
            context.arc(originX + (dx / distance) * (distance + push), originY + (dy / distance) * (distance + push), spacing * 0.065 + energy * spacing * 0.085, 0, Math.PI * 2);
            context.fill();
        }
    }
    context.globalAlpha = 1;
}

function distanceOutsideRect(x: number, y: number, rect: { left: number; top: number; right: number; bottom: number }) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
}

function smoothstep(edge0: number, edge1: number, value: number) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function WorkspaceRouteLoader({ label = "正在打开页面" }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <span className="workspace-route-loader-mark">
                    <BrandLogoFrame className="workspace-route-loader-logo" logoClassName="size-4" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />
                </span>
                <LoadingSignal />
                <span>{label}</span>
            </div>
        </section>
    );
}

function LoadingSignal() {
    return (
        <span className="loading-signal" aria-hidden="true">
            <i />
            <i />
            <i />
        </span>
    );
}
