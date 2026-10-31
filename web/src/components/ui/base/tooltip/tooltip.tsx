import { Fragment, isValidElement, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Focusable, Tooltip as RACTooltip, TooltipTrigger, type Placement } from "react-aria-components";

import { clientRectScale } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";

/**
 * Tooltip — 气泡提示（自研，react-aria-components overlay）。
 *
 * - API 对齐 AntD Tooltip（title/placement/children），title 为空时不渲染浮层。
 * - 浮层定位、进出场、焦点管理由 RAC 承担（ADR-0008：复杂浮层以 RAC 为无障碍地基）。
 * - 浮层挂在抵消桌面端整体缩放的定位层里（见 tooltipLayer）；外层只负责定位，内层气泡承载视觉，
 *   className 作用在气泡上。
 * - 样式只吃语义 token：bg-surface-strong（light #fff / dark #2a2a2a）+ text-foreground +
 *   border-border hairline，无裸色；motion 走 RAC 动画类 + motion-reduce 关停。
 * - 启用的控件直接接收 RAC 事件、ref 和描述；非交互/禁用内容用 span 接收悬停。
 * - placement 映射 AntD → RAC（topLeft→top left …）。
 * 对标：AntD Tooltip；boardui base/tooltip。
 */

export type TooltipPlacement = "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";

const PLACEMENT_MAP: Record<TooltipPlacement, Placement> = {
    top: "top",
    topLeft: "top left",
    topRight: "top right",
    bottom: "bottom",
    bottomLeft: "bottom left",
    bottomRight: "bottom right",
    left: "left",
    right: "right",
};

/**
 * 所有提示共用的定位层，挂在 body 下。
 *
 * RAC 用 getBoundingClientRect 量触发器（标准 zoom 下是屏幕像素），再把结果原样写成浮层的 left/top/bottom；
 * 桌面端根元素 zoom 0.9 时这些样式像素还会再乘 0.9，提示按到视口左上角的距离等比偏向左上，右侧按钮偏出一百多像素，
 * 向上弹出的提示还会落到按钮下方。这一层按实测比例反向缩放，让样式像素等于屏幕像素，气泡再读同一比例缩回。
 *
 * - 层本身 absolute + inset 0、z-index auto：铺满视口、不建层叠上下文，提示照旧按 RAC 的 z-index 叠在页面上；层不接收指针。
 * - zoom 不能直接加在浮层上：元素和父级的有效缩放不同时，offsetParent 会变成父级（这里是高度为 0 的静态 overlay 容器），
 *   RAC 据此把向上弹出的 bottom 算成负数，提示落到屏幕外。
 * - 比例在每次打开时实测；窄屏、画布编辑器，以及按未缩放坐标返回 rect 的浏览器为 1，层不缩放。
 * - 用 UNSTABLE_portalContainer 指定挂载点：RAC 标注的替代品 UNSAFE_PortalProvider 只在 react-aria 里导出，
 *   而 react-aria 不是本项目的直接依赖。
 */
let tooltipLayer: HTMLDivElement | null = null;

/** 打开前创建（或复用）定位层，并按当前缩放校准。 */
function prepareTooltipLayer() {
    if (typeof document === "undefined") return undefined;
    if (!tooltipLayer?.isConnected) {
        tooltipLayer = document.createElement("div");
        tooltipLayer.setAttribute("data-tooltip-layer", "");
        Object.assign(tooltipLayer.style, { position: "absolute", inset: "0", pointerEvents: "none" });
        document.body.appendChild(tooltipLayer);
    }
    const scale = clientRectScale();
    if (scale === 1) tooltipLayer.style.removeProperty("zoom");
    else tooltipLayer.style.setProperty("zoom", String(1 / scale));
    tooltipLayer.style.setProperty("--tooltip-bubble-zoom", String(scale));
    return tooltipLayer;
}

export interface TooltipProps {
    title?: ReactNode;
    placement?: TooltipPlacement;
    /** 首次悬停延迟 ms（默认 500）。RAC 在一个提示刚关闭后的短窗口内切换相邻提示不再等待。 */
    delay?: number;
    /** 作用在气泡上。 */
    className?: string;
    children: ReactNode;
}

export function Tooltip({ title, placement = "top", delay = 500, className, children }: TooltipProps) {
    // Hook 必须在提前返回之前调用：title 由空变为非空时，Hook 数量不能变化。
    const triggerRef = useRef<HTMLSpanElement>(null);
    // 定位层在第一次打开时才创建。RAC 改打开状态和这里的 setLayer 发生在同一次事件里，React 合成一次渲染，浮层直接挂进层里。
    const [layer, setLayer] = useState<HTMLElement>();
    if (!title) return <>{children}</>;
    const child = isValidElement<{ disabled?: boolean; loading?: boolean; tabIndex?: number }>(children) ? children : null;
    const directTrigger =
        child && child.type !== Fragment && !child.props.disabled && !child.props.loading && (typeof child.type !== "string" || ["button", "a", "input", "select", "textarea", "summary"].includes(child.type) || child.props.tabIndex !== undefined);

    return (
        // 每次打开先按当前缩放校准定位层，RAC 随后在布局阶段测量浮层。
        <TooltipTrigger
            delay={delay}
            onOpenChange={(open) => {
                if (open) setLayer(prepareTooltipLayer());
            }}
        >
            {/*
             * RAC 1.21 的 TooltipTrigger 通过 context 下发 hover/focus 处理与 triggerRef，
             * 但外层包装元素或子元素重新渲染时容易丢失内部 ref 引用，导致浮层回退到 (0, 0)。
             * 这里给外层 span 绑定稳定的 triggerRef 并直接透传给 RACTooltip，
             * 确保气泡定位始终锚定在控件正上方，绝不飞至屏幕左上角。
             */}
            <span ref={triggerRef} className="inline-flex">
                {directTrigger ? (
                    <Focusable>{child as ComponentProps<typeof Focusable>["children"]}</Focusable>
                ) : (
                    <Focusable excludeFromTabOrder>
                        <span className="inline-flex">{children}</span>
                    </Focusable>
                )}
            </span>
            <RACTooltip triggerRef={triggerRef} placement={PLACEMENT_MAP[placement]} offset={8} UNSTABLE_portalContainer={layer} className="pointer-events-auto z-[var(--z-tooltip)] ra-pop-in">
                <div className={cn("max-w-64 rounded-md border border-border bg-surface-strong px-2 py-1 text-xs leading-relaxed text-foreground shadow-md [zoom:var(--tooltip-bubble-zoom,1)]", className)}>{title}</div>
            </RACTooltip>
        </TooltipTrigger>
    );
}
