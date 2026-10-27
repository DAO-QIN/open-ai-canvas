import type { AgentAvatarState } from "./agent-appearance";

/** 渐变满月的视觉状态：8 种运行状态归并成 7 种动效。 */
export type AgentMoonMode = "idle" | "working" | "waiting" | "approval" | "done" | "failed" | "sleep";

export function agentMoonMode(state: AgentAvatarState): AgentMoonMode {
    switch (state) {
        case "running":
            return "working";
        case "queued":
            return "waiting";
        case "waiting_approval":
            return "approval";
        case "completed":
            return "done";
        case "failed":
            return "failed";
        case "cancelled":
        case "rejected":
            return "sleep";
        default:
            return "idle";
    }
}

/** 圆半径与条纹数量：12 道条纹从圆顶流向圆底，越往下越细。 */
export const AGENT_MOON_RADIUS = 44;
export const AGENT_MOON_STRIPES = 12;
export const AGENT_MOON_TOP = 50 - AGENT_MOON_RADIUS;
export const AGENT_MOON_SPAN = AGENT_MOON_RADIUS * 2;
/** 圆顶处条纹最粗的厚度（viewBox 单位）。 */
export const AGENT_MOON_BAR = 7.75;

/** 条纹在流动进度 progress（0 = 圆顶，1 = 圆底）处的厚度；CSS 关键帧按此取样。 */
export function agentMoonStripeThickness(progress: number) {
    const clamped = Math.min(1, Math.max(0, progress));
    return 0.35 + 7.4 * Math.pow(1 - clamped, 1.3);
}
