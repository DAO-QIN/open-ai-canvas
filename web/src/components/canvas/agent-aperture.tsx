import { useId, type CSSProperties } from "react";
import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { AGENT_APERTURE_BLADE_OPACITY, AGENT_APERTURE_GEOMETRY, agentApertureMode } from "@/lib/canvas/agent-aperture";
import { cn } from "@/lib/utils";
import "./agent-aperture.css";

/**
 * 影绘光圈：六片叶片拼满的圆形 Agent 形象，没有底座和外圈。
 * 颜色跟随 currentColor（深色主题为白色金属，浅色主题为黑色），状态色光只从缝隙和光孔透出。
 */
export function AgentAperture({
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
    const id = `agent-aperture-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
    const { radius, hole, blades, seams } = AGENT_APERTURE_GEOMETRY;
    return (
        <svg
            className={cn("agent-aperture", className)}
            data-mode={agentApertureMode(state)}
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
                <linearGradient id={`${id}-metal`} x1="0" y1="6" x2="0" y2="94" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="currentColor" />
                    <stop offset="0.55" stopColor="currentColor" stopOpacity={0.88} />
                    <stop offset="1" stopColor="currentColor" stopOpacity={0.58} />
                </linearGradient>
                <radialGradient id={`${id}-glow`} cx="50" cy="50" r={radius} gradientUnits="userSpaceOnUse">
                    <stop className="agent-aperture-glow-stop" offset="0" />
                    <stop className="agent-aperture-glow-stop" offset="0.55" stopOpacity={0.35} />
                    <stop className="agent-aperture-glow-stop" offset="1" stopOpacity={0} />
                </radialGradient>
                <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
                    <circle cx="50" cy="50" r={radius} fill="#fff" />
                    <path className="agent-aperture-spin" d={seams} stroke="#000" strokeWidth={2.4} fill="none" />
                    <circle className="agent-aperture-hole" cx="50" cy="50" r={hole} fill="#000" />
                </mask>
            </defs>
            <g className="agent-aperture-body">
                <circle className="agent-aperture-glow" cx="50" cy="50" r={radius} fill={`url(#${id}-glow)`} />
                <g mask={`url(#${id}-mask)`}>
                    <g className="agent-aperture-spin agent-aperture-blades">
                        {blades.map((d, index) => (
                            <path key={index} d={d} fill={`url(#${id}-metal)`} fillOpacity={AGENT_APERTURE_BLADE_OPACITY[index]} style={{ "--agent-aperture-blade": index } as CSSProperties} />
                        ))}
                    </g>
                </g>
            </g>
        </svg>
    );
}
