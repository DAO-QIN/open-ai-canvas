import { useId, type CSSProperties } from "react";
import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { AGENT_MOON_BAR, AGENT_MOON_RADIUS, AGENT_MOON_SPAN, AGENT_MOON_STRIPES, AGENT_MOON_TOP, agentMoonMode } from "@/lib/canvas/agent-moon";
import { cn } from "@/lib/utils";
import "./agent-moon.css";

/**
 * 渐变满月：横条纹由粗到细拼成一个圆，没有底座和外圈，条纹缓缓向下流动。
 * 条纹只是遮罩，底下固定一块自上而下渐暗的金属圆，所以条纹流动时明暗不跟着跑；
 * 颜色跟随 currentColor（深色主题白、浅色主题黑），缝隙里透出很淡的白光；
 * 背后一层与主题相反、完全羽化的衬底，加上条纹细描边，叠在亮图或复杂画面上也看得清。
 */
export function AgentMoon({
    size,
    state = "idle",
    reducedMotion = false,
    paused = false,
    className,
    style,
}: {
    size: number;
    state?: AgentAvatarState;
    reducedMotion?: boolean;
    paused?: boolean;
    className?: string;
    style?: CSSProperties;
}) {
    const id = `agent-moon-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
    return (
        <svg
            className={cn("agent-moon", className)}
            data-mode={agentMoonMode(state)}
            data-reduced-motion={reducedMotion || undefined}
            data-paused={paused || undefined}
            width={size}
            height={size}
            viewBox="0 0 100 100"
            aria-hidden="true"
            focusable="false"
            style={style}
        >
            <defs>
                <linearGradient id={`${id}-metal`} x1="0" y1={AGENT_MOON_TOP} x2="0" y2={AGENT_MOON_TOP + AGENT_MOON_SPAN} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="currentColor" />
                    <stop offset="0.55" stopColor="currentColor" stopOpacity={0.9} />
                    <stop offset="1" stopColor="currentColor" stopOpacity={0.62} />
                </linearGradient>
                <radialGradient id={`${id}-halo`} cx="50" cy="50" r={AGENT_MOON_RADIUS * 1.32} gradientUnits="userSpaceOnUse">
                    <stop className="agent-moon-halo-stop" offset="0" stopOpacity={0.72} />
                    <stop className="agent-moon-halo-stop" offset="0.62" stopOpacity={0.58} />
                    <stop className="agent-moon-halo-stop" offset="1" stopOpacity={0} />
                </radialGradient>
                <radialGradient id={`${id}-glow`} cx="50" cy="60" r={AGENT_MOON_RADIUS} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#fff" />
                    <stop offset="0.55" stopColor="#fff" stopOpacity={0.3} />
                    <stop offset="1" stopColor="#fff" stopOpacity={0} />
                </radialGradient>
                <mask id={`${id}-stripes`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                    {Array.from({ length: AGENT_MOON_STRIPES }, (_, index) => (
                        <g key={index} className="agent-moon-stripe" style={{ "--agent-moon-stripe": index } as CSSProperties}>
                            <rect className="agent-moon-bar" x="0" y={AGENT_MOON_TOP - AGENT_MOON_BAR / 2} width="100" height={AGENT_MOON_BAR} fill="#fff" />
                        </g>
                    ))}
                </mask>
            </defs>
            <g className="agent-moon-body">
                {/* 柔和衬底：从中心向外完全羽化，没有边缘，不是外圈；保证亮背景上条纹仍清楚。 */}
                <circle className="agent-moon-halo" cx="50" cy="50" r={AGENT_MOON_RADIUS * 1.32} fill={`url(#${id}-halo)`} />
                <circle className="agent-moon-glow" cx="50" cy="50" r={AGENT_MOON_RADIUS} fill={`url(#${id}-glow)`} />
                <g className="agent-moon-ink">
                    <circle cx="50" cy="50" r={AGENT_MOON_RADIUS} fill={`url(#${id}-metal)`} mask={`url(#${id}-stripes)`} />
                </g>
            </g>
        </svg>
    );
}
